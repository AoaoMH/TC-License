import { Router, Request, Response } from 'express';
import db, { writeLog } from '../db';
import { getPublicKeyPem, issueToken, newSecret, hashSecret, verifySignedRequest, generateCodeString } from '../crypto';
import { rateLimit } from '../middleware';

const router = Router();

const CODE_RE = /^(?:[A-Z0-9]{1,8}-)?[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MID_RE = /^[a-f0-9_-]{8,128}$/i;

function parseIdentity(req: Request): { product?: string; code: string; mid: string; deviceName: string } | null {
  const { product, code, machine_id, device_name } = req.body || {};
  if (typeof code !== 'string' || typeof machine_id !== 'string') return null;
  const c = code.trim().toUpperCase();
  const m = machine_id.trim().toLowerCase();
  if (!CODE_RE.test(c) || !MID_RE.test(m)) return null;
  const p = typeof product === 'string' && product.trim() ? product.trim().toLowerCase() : undefined;
  const dn = typeof device_name === 'string' ? device_name.trim().slice(0, 64) : '';
  return { product: p, code: c, mid: m, deviceName: dn };
}

function findCodeWithProduct(code: string): any {
  return db.prepare(`
    SELECT c.*,
           p.slug AS product_slug,
           p.name AS product_name,
           p.status AS product_status,
           p.version AS product_version,
           p.min_version AS product_min_version,
           p.announcement AS product_announcement,
           p.custom_data AS product_custom_data,
           p.max_devices AS product_max_devices,
           p.heartbeat_interval AS product_heartbeat_interval,
           p.allow_unbind AS product_allow_unbind,
           p.unbind_cooldown_sec AS product_unbind_cooldown_sec,
           p.unbind_penalty_sec AS product_unbind_penalty_sec,
           p.max_unbind_count AS product_max_unbind_count
    FROM codes c
    JOIN products p ON p.id = c.product_id
    WHERE c.code = ?
  `).get(code);
}

function checkBlacklist(productId: number, mid: string): { reason: string } | undefined {
  return db.prepare(`
    SELECT reason FROM blacklist
    WHERE machine_id = ? AND (product_id IS NULL OR product_id = ?)
    LIMIT 1
  `).get(mid, productId) as { reason: string } | undefined;
}

function parseCustomData(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function compareVersion(v1: string, v2: string): number {
  const a = String(v1 || '0').split('.').map(n => parseInt(n, 10) || 0);
  const b = String(v2 || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// --- 1. 获取产品 Ed25519 公钥 PEM ---
router.get('/pubkey', (req: Request, res: Response) => {
  const slug = String(req.query.product || '').trim().toLowerCase();
  const row = db.prepare('SELECT slug FROM products WHERE slug = ?').get(slug) as { slug: string } | undefined;
  if (!row) {
    res.status(404).json({ ok: false, error: 'unknown_product' });
    return;
  }
  res.type('text/plain').send(getPublicKeyPem(slug));
});

// --- 2. 客户端启动初始化 (检查项目状态、版本更新、公告、免费试用策略) ---
router.get('/init', rateLimit(60, 60 * 1000), (req: Request, res: Response) => {
  const slug = String(req.query.product || '').trim().toLowerCase();
  const clientVer = String(req.query.version || '').trim();
  const prod = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug) as any;
  if (!prod) {
    res.status(404).json({ ok: false, error: 'unknown_product' });
    return;
  }
  const updateRequired = clientVer ? compareVersion(clientVer, prod.min_version) < 0 : false;
  res.json({
    ok: true,
    product: {
      slug: prod.slug,
      name: prod.name,
      status: prod.status,
      version: prod.version,
      min_version: prod.min_version,
      update_required: updateRequired,
      announcement: prod.announcement,
      heartbeat_interval: prod.heartbeat_interval,
      allow_unbind: Boolean(prod.allow_unbind),
      trial_enabled: Boolean(prod.trial_enabled),
      trial_duration_sec: prod.trial_duration_sec,
      public_key: getPublicKeyPem(prod.slug),
    },
    server_time: Math.floor(Date.now() / 1000),
  });
});

// --- 3. 激活卡密 (支持激活后计时、防跨产品串码、多设备并发席位控制、下发私有配置) ---
router.post('/activate', rateLimit(25, 10 * 60 * 1000), (req: Request, res: Response) => {
  const p = parseIdentity(req);
  if (!p) {
    res.status(400).json({ ok: false, error: 'bad_request' });
    return;
  }

  const row = findCodeWithProduct(p.code);
  const now = Math.floor(Date.now() / 1000);

  if (!row) {
    writeLog({ code: p.code, machineId: p.mid, action: 'activate_fail_nocode', ip: req.ip });
    res.json({ ok: false, error: 'invalid_code' });
    return;
  }

  // 防跨产品串码校验
  if (p.product && p.product !== row.product_slug) {
    writeLog({ productId: row.product_id, code: p.code, machineId: p.mid, action: 'activate_fail_product_mismatch', detail: `req=${p.product}`, ip: req.ip });
    res.json({ ok: false, error: 'product_mismatch' });
    return;
  }

  // 检查产品服务状态
  if (row.product_status === 'disabled') {
    res.json({ ok: false, error: 'product_disabled' });
    return;
  }
  if (row.product_status === 'maintenance') {
    res.json({ ok: false, error: 'product_maintenance', announcement: row.product_announcement });
    return;
  }

  // 检查机器码黑名单
  const banned = checkBlacklist(row.product_id, p.mid);
  if (banned) {
    writeLog({ productId: row.product_id, code: p.code, machineId: p.mid, action: 'activate_fail_banned', detail: banned.reason, ip: req.ip });
    res.json({ ok: false, error: 'machine_banned', reason: banned.reason });
    return;
  }

  if (row.status === 'revoked') {
    writeLog({ productId: row.product_id, code: p.code, machineId: p.mid, action: 'activate_fail_revoked', ip: req.ip });
    res.json({ ok: false, error: 'revoked' });
    return;
  }

  // 计算到期时间：若尚未激活过且设置了 duration_sec，则从首次激活时刻开始倒计时
  let expiresAt: number | null = row.expires_at;
  let activatedAt: number = row.activated_at || now;
  if (!row.activated_at && !expiresAt && row.duration_sec > 0) {
    expiresAt = now + row.duration_sec;
  }

  if (expiresAt && expiresAt < now) {
    writeLog({ productId: row.product_id, code: p.code, machineId: p.mid, action: 'activate_fail_expired', ip: req.ip });
    res.json({ ok: false, error: 'expired', expires_at: expiresAt });
    return;
  }

  // 检查设备绑定席位 (code_bindings)
  const bindings = db.prepare('SELECT * FROM code_bindings WHERE code_id = ?').all(row.id) as Array<any>;
  const existingBinding = bindings.find(b => b.machine_id === p.mid);
  const maxDevices = row.max_devices ?? row.product_max_devices ?? 1;

  if (!existingBinding && bindings.length >= maxDevices) {
    // 兼容单机旧数据：如果 code_bindings 为空但 row.status === 'active' 且 row.machine_id 存在且不同
    writeLog({ productId: row.product_id, code: p.code, machineId: p.mid, action: 'activate_fail_bound_other', detail: `${bindings.length}/${maxDevices}`, ip: req.ip });
    res.json({ ok: false, error: 'bound_to_other', max_devices: maxDevices, bound_devices: bindings.length });
    return;
  }

  const secret = newSecret();
  const secretHash = hashSecret(secret);

  if (existingBinding) {
    db.prepare(`
      UPDATE code_bindings
      SET secret_hash = ?, device_name = CASE WHEN ? != '' THEN ? ELSE device_name END,
          ip = ?, last_seen_at = ?, kick = 0
      WHERE id = ?
    `).run(secretHash, p.deviceName, p.deviceName, req.ip || null, now, existingBinding.id);
  } else {
    db.prepare(`
      INSERT INTO code_bindings (code_id, machine_id, device_name, secret_hash, kick, ip, bound_at, last_seen_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
    `).run(row.id, p.mid, p.deviceName, secretHash, req.ip || null, now, now);
  }

  db.prepare(`
    UPDATE codes
    SET status = 'active',
        machine_id = ?,
        secret_hash = ?,
        activated_at = ?,
        expires_at = ?,
        last_seen_at = ?,
        kick = 0
    WHERE id = ?
  `).run(p.mid, secretHash, activatedAt, expiresAt, now, row.id);

  const token = issueToken(row.product_slug, {
    p: row.product_slug,
    c: p.code,
    m: p.mid,
    exp: expiresAt || 0,
    iat: now,
  });

  writeLog({ productId: row.product_id, code: p.code, machineId: p.mid, action: 'activate_ok', detail: p.deviceName, ip: req.ip });

  res.json({
    ok: true,
    token,
    secret,
    product: row.product_slug,
    code: p.code,
    expires_at: expiresAt || 0,
    is_permanent: !expiresAt,
    server_time: now,
    heartbeat_interval: row.product_heartbeat_interval || 60,
    version: row.product_version,
    announcement: row.product_announcement,
    custom_data: parseCustomData(row.product_custom_data),
  });
});

// --- 4. 机器码免费试用申请 (自动签发并绑定试用卡密，100%复用验证与心跳体系) ---
router.post('/trial', rateLimit(10, 10 * 60 * 1000), (req: Request, res: Response) => {
  const slug = String(req.body?.product || '').trim().toLowerCase();
  const mid = String(req.body?.machine_id || '').trim().toLowerCase();
  const deviceName = String(req.body?.device_name || 'Trial Device').trim().slice(0, 64);

  if (!slug || !MID_RE.test(mid)) {
    res.status(400).json({ ok: false, error: 'bad_request' });
    return;
  }

  const prod = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug) as any;
  if (!prod) {
    res.status(404).json({ ok: false, error: 'unknown_product' });
    return;
  }
  if (prod.status !== 'active') {
    res.json({ ok: false, error: `product_${prod.status}`, announcement: prod.announcement });
    return;
  }
  if (!prod.trial_enabled || prod.trial_duration_sec <= 0) {
    res.json({ ok: false, error: 'trial_disabled' });
    return;
  }

  const banned = checkBlacklist(prod.id, mid);
  if (banned) {
    res.json({ ok: false, error: 'machine_banned', reason: banned.reason });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const existingTrial = db.prepare(`
    SELECT mt.*, c.code, c.status, c.expires_at
    FROM machine_trials mt
    JOIN codes c ON c.id = mt.code_id
    WHERE mt.product_id = ? AND mt.machine_id = ?
  `).get(prod.id, mid) as any;

  if (existingTrial) {
    // 若试用卡仍在有效期内且未被吊销，重新签发凭证方便用户重连；否则拒绝重复试用
    if (existingTrial.status === 'active' && existingTrial.expires_at > now) {
      const secret = newSecret();
      const secretHash = hashSecret(secret);
      db.prepare('UPDATE code_bindings SET secret_hash = ?, last_seen_at = ?, ip = ? WHERE code_id = ? AND machine_id = ?')
        .run(secretHash, now, req.ip || null, existingTrial.code_id, mid);
      db.prepare('UPDATE codes SET secret_hash = ?, last_seen_at = ? WHERE id = ?')
        .run(secretHash, now, existingTrial.code_id);

      const token = issueToken(prod.slug, {
        p: prod.slug,
        c: existingTrial.code,
        m: mid,
        exp: existingTrial.expires_at,
        iat: now,
      });
      res.json({
        ok: true,
        is_trial: true,
        code: existingTrial.code,
        token,
        secret,
        product: prod.slug,
        expires_at: existingTrial.expires_at,
        server_time: now,
        heartbeat_interval: prod.heartbeat_interval || 60,
        custom_data: parseCustomData(prod.custom_data),
      });
      return;
    }

    writeLog({ productId: prod.id, code: existingTrial.code, machineId: mid, action: 'trial_fail_used', ip: req.ip });
    res.json({ ok: false, error: 'trial_already_used', expires_at: existingTrial.expires_at });
    return;
  }

  // 首次领取试用：生成 TRIAL 前缀激活码并立即激活绑定
  let trialCode = '';
  do {
    trialCode = generateCodeString('TRIAL');
  } while (db.prepare('SELECT 1 FROM codes WHERE code = ?').get(trialCode));

  const expiresAt = now + prod.trial_duration_sec;
  const secret = newSecret();
  const secretHash = hashSecret(secret);

  const insertResult = db.prepare(`
    INSERT INTO codes (
      product_id, code, batch_no, status, is_trial, duration_sec, max_devices,
      machine_id, secret_hash, expires_at, note, created_at, activated_at, last_seen_at
    ) VALUES (?, ?, 'TRIAL', 'active', 1, ?, 1, ?, ?, ?, '机器码免费试用', ?, ?, ?)
  `).run(prod.id, trialCode, prod.trial_duration_sec, mid, secretHash, expiresAt, now, now, now);

  const codeId = Number(insertResult.lastInsertRowid);

  db.prepare(`
    INSERT INTO code_bindings (code_id, machine_id, device_name, secret_hash, kick, ip, bound_at, last_seen_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `).run(codeId, mid, deviceName, secretHash, req.ip || null, now, now);

  db.prepare(`
    INSERT INTO machine_trials (product_id, machine_id, code_id, ip, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(prod.id, mid, codeId, req.ip || null, now);

  const token = issueToken(prod.slug, {
    p: prod.slug,
    c: trialCode,
    m: mid,
    exp: expiresAt,
    iat: now,
  });

  writeLog({ productId: prod.id, code: trialCode, machineId: mid, action: 'trial_issued', detail: `${prod.trial_duration_sec}s`, ip: req.ip });

  res.json({
    ok: true,
    is_trial: true,
    code: trialCode,
    token,
    secret,
    product: prod.slug,
    expires_at: expiresAt,
    server_time: now,
    heartbeat_interval: prod.heartbeat_interval || 60,
    custom_data: parseCustomData(prod.custom_data),
  });
});

// --- 5. 客户端自助解绑/换机 (/api/unbind) ---
router.post('/unbind', rateLimit(15, 10 * 60 * 1000), (req: Request, res: Response) => {
  const rawCode = String(req.body?.code || '').trim().toUpperCase();
  const rawMid = req.body?.machine_id ? String(req.body.machine_id).trim().toLowerCase() : '';
  const reqProduct = req.body?.product ? String(req.body.product).trim().toLowerCase() : undefined;

  if (!CODE_RE.test(rawCode)) {
    res.status(400).json({ ok: false, error: 'bad_request' });
    return;
  }

  const row = findCodeWithProduct(rawCode);
  if (!row) {
    res.json({ ok: false, error: 'invalid_code' });
    return;
  }
  if (reqProduct && reqProduct !== row.product_slug) {
    res.json({ ok: false, error: 'product_mismatch' });
    return;
  }
  if (row.is_trial) {
    res.json({ ok: false, error: 'trial_cannot_unbind' });
    return;
  }
  if (!row.product_allow_unbind) {
    res.json({ ok: false, error: 'unbind_disabled' });
    return;
  }
  if (row.status !== 'active') {
    res.json({ ok: false, error: 'not_active' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) {
    res.json({ ok: false, error: 'expired' });
    return;
  }

  // 检查换绑次数上限
  if (row.product_max_unbind_count > 0 && row.unbind_count >= row.product_max_unbind_count) {
    writeLog({ productId: row.product_id, code: row.code, machineId: rawMid || null, action: 'unbind_fail_limit', ip: req.ip });
    res.json({ ok: false, error: 'max_unbind_reached', max_unbinds: row.product_max_unbind_count });
    return;
  }

  // 检查换绑冷却时间
  const lastRef = row.last_unbind_at || row.activated_at || 0;
  if (row.product_unbind_cooldown_sec > 0 && now - lastRef < row.product_unbind_cooldown_sec) {
    const retryAfter = row.product_unbind_cooldown_sec - (now - lastRef);
    res.json({ ok: false, error: 'unbind_cooldown', retry_after_sec: retryAfter });
    return;
  }

  // 计算换绑扣时惩罚
  let newExpiresAt: number | null = row.expires_at;
  if (newExpiresAt && row.product_unbind_penalty_sec > 0) {
    newExpiresAt = newExpiresAt - row.product_unbind_penalty_sec;
    if (newExpiresAt <= now) {
      res.json({ ok: false, error: 'insufficient_time_for_penalty', penalty_sec: row.product_unbind_penalty_sec });
      return;
    }
  }

  // 执行解绑：若指定了已绑定的 machine_id 则仅解绑该设备，否则解绑该卡密下所有设备
  if (rawMid) {
    db.prepare('DELETE FROM code_bindings WHERE code_id = ? AND machine_id = ?').run(row.id, rawMid);
  } else {
    db.prepare('DELETE FROM code_bindings WHERE code_id = ?').run(row.id);
  }

  const remainingBindings = db.prepare('SELECT * FROM code_bindings WHERE code_id = ?').all(row.id) as Array<any>;
  const newUnbindCount = (row.unbind_count || 0) + 1;

  if (remainingBindings.length === 0) {
    db.prepare(`
      UPDATE codes
      SET machine_id = NULL, secret_hash = NULL, kick = 0,
          unbind_count = ?, last_unbind_at = ?, expires_at = ?
      WHERE id = ?
    `).run(newUnbindCount, now, newExpiresAt, row.id);
  } else {
    db.prepare(`
      UPDATE codes
      SET machine_id = ?, secret_hash = ?,
          unbind_count = ?, last_unbind_at = ?, expires_at = ?
      WHERE id = ?
    `).run(remainingBindings[0].machine_id, remainingBindings[0].secret_hash, newUnbindCount, now, newExpiresAt, row.id);
  }

  writeLog({
    productId: row.product_id,
    code: row.code,
    machineId: rawMid || null,
    action: 'client_unbind',
    detail: `count=${newUnbindCount}`,
    ip: req.ip,
  });

  res.json({
    ok: true,
    unbind_count: newUnbindCount,
    max_unbinds: row.product_max_unbind_count,
    expires_at: newExpiresAt || 0,
    server_time: now,
  });
});

// --- 6. 签名请求公共校验器 (Verify / Heartbeat) ---
function handleSignedRequest(
  req: Request,
  res: Response,
  onVerified: (row: any, binding: any | null, mid: string) => void
): void {
  const p = parseIdentity(req);
  if (!p) {
    res.status(400).json({ ok: false, error: 'bad_request' });
    return;
  }
  const { ts, nonce, sig } = req.body || {};

  const row = findCodeWithProduct(p.code);
  if (!row) {
    writeLog({ code: p.code, machineId: p.mid, action: 'signed_fail_nocode', ip: req.ip });
    res.json({ ok: false, error: 'invalid_code' });
    return;
  }

  if (p.product && p.product !== row.product_slug) {
    res.json({ ok: false, error: 'product_mismatch' });
    return;
  }

  const binding = db.prepare('SELECT * FROM code_bindings WHERE code_id = ? AND machine_id = ?')
    .get(row.id, p.mid) as any | undefined;

  const secretHash = binding ? binding.secret_hash : row.secret_hash;

  const err = verifySignedRequest({
    product: p.product || row.product_slug,
    code: p.code,
    mid: p.mid,
    ts,
    nonce,
    sig,
    secretHash,
  });

  if (err) {
    writeLog({ productId: row.product_id, code: p.code, machineId: p.mid, action: 'signed_fail_' + err, ip: req.ip });
    res.json({ ok: false, error: err });
    return;
  }

  onVerified(row, binding || null, p.mid);
}

// --- 7. Verify 签名校验接口 (同时刷新最新有效期的离线 Token 与私有远程配置) ---
router.post('/verify', rateLimit(120, 60 * 1000), (req: Request, res: Response) => {
  handleSignedRequest(req, res, (row, binding, mid) => {
    const now = Math.floor(Date.now() / 1000);

    if (checkBlacklist(row.product_id, mid)) {
      res.json({ ok: false, error: 'machine_banned' });
      return;
    }
    if (row.product_status !== 'active') {
      res.json({ ok: false, error: `product_${row.product_status}` });
      return;
    }

    const isBound = binding ? true : row.machine_id === mid;
    if (row.status !== 'active' || !isBound) {
      writeLog({ productId: row.product_id, code: row.code, machineId: mid, action: 'verify_fail', ip: req.ip });
      res.json({ ok: false, error: 'invalid' });
      return;
    }

    if (row.expires_at && row.expires_at < now) {
      res.json({ ok: false, error: 'expired', expires_at: row.expires_at });
      return;
    }

    // 签发包含最新到期时间的 Token（解决后台管理员延期后客户端缓存 Token 过期问题）
    const refreshedToken = issueToken(row.product_slug, {
      p: row.product_slug,
      c: row.code,
      m: mid,
      exp: row.expires_at || 0,
      iat: now,
    });

    res.json({
      ok: true,
      expires_at: row.expires_at || 0,
      server_time: now,
      token: refreshedToken,
      custom_data: parseCustomData(row.product_custom_data),
    });
  });
});

// --- 8. Heartbeat 心跳保活与远程实时控制 ---
router.post('/heartbeat', rateLimit(240, 60 * 1000), (req: Request, res: Response) => {
  handleSignedRequest(req, res, (row, binding, mid) => {
    const now = Math.floor(Date.now() / 1000);

    const isBound = binding ? true : row.machine_id === mid;
    if (!isBound) {
      writeLog({ productId: row.product_id, code: row.code, machineId: mid, action: 'heartbeat_fail_machine', ip: req.ip });
      res.json({ ok: false, error: 'invalid' });
      return;
    }

    let status = 'active';
    if (checkBlacklist(row.product_id, mid)) {
      status = 'banned';
    } else if (row.product_status !== 'active') {
      status = 'maintenance';
    } else if (row.status === 'revoked') {
      status = 'revoked';
    } else if (row.expires_at && row.expires_at < now) {
      status = 'expired';
    }

    // 检查远程踢下线 (支持单设备踢下线或整码踢下线)
    const shouldKick = (binding && binding.kick === 1) || row.kick === 1;
    if (shouldKick) {
      status = 'kick';
      if (binding) {
        db.prepare('UPDATE code_bindings SET kick = 0 WHERE id = ?').run(binding.id);
      }
      db.prepare('UPDATE codes SET kick = 0 WHERE id = ?').run(row.id);
      writeLog({ productId: row.product_id, code: row.code, machineId: mid, action: 'kick_delivered', ip: req.ip });
    }

    if (binding) {
      db.prepare('UPDATE code_bindings SET last_seen_at = ?, ip = ? WHERE id = ?')
        .run(now, req.ip || null, binding.id);
    }
    db.prepare('UPDATE codes SET last_seen_at = ? WHERE id = ?').run(now, row.id);

    res.json({
      ok: true,
      status,
      expires_at: row.expires_at || 0,
      server_time: now,
      announcement: row.product_announcement || '',
    });
  });
});

export default router;
