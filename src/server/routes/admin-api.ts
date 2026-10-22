import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import db, { writeLog } from '../db';
import { ADMIN_PASSWORD, ONLINE_WINDOW_SEC } from '../config';
import { getPublicKeyPem, generateCodeString, deleteKeyPair } from '../crypto';
import {
  rateLimit,
  createSession,
  isValidSession,
  destroySession,
  parseCookies,
  requireAdmin,
} from '../middleware';

const router = Router();

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,30}$/;

function adminLog(action: string, detail: string, req: Request, productId?: number | null, code?: string | null): void {
  writeLog({
    productId: productId ?? null,
    code: code ?? null,
    action: 'admin_' + action,
    detail,
    ip: req.ip,
  });
}

// --- 登录状态检查 (供前端 SPA 初始化调用) ---
router.get('/api/me', (req: Request, res: Response) => {
  const cookies = parseCookies(req);
  res.json({ ok: true, authenticated: isValidSession(cookies.sid) });
});

// --- 登录接口 (同时兼容 Form 表单重定向与 JSON AJAX 请求) ---
router.post(
  '/login',
  express.urlencoded({ extended: false, limit: '4kb' }),
  rateLimit(8, 10 * 60 * 1000),
  (req: Request, res: Response) => {
    const pw = String((req.body && req.body.password) || '');
    const a = Buffer.from(pw);
    const b = Buffer.from(ADMIN_PASSWORD);
    const ok = pw.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
    const wantsJson = req.headers.accept?.includes('application/json') || req.is('application/json');

    if (!ok) {
      adminLog('login_fail', '', req);
      if (wantsJson) {
        res.status(401).json({ ok: false, error: 'invalid_password' });
      } else {
        res.redirect('/admin/login?err=1');
      }
      return;
    }

    const sid = createSession();
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=${12 * 3600}${secure}`);
    adminLog('login_ok', '', req);

    if (wantsJson) {
      res.json({ ok: true });
    } else {
      res.redirect('/admin');
    }
  }
);

// --- 退出登录 ---
router.post('/logout', (req: Request, res: Response) => {
  const cookies = parseCookies(req);
  if (cookies.sid) destroySession(cookies.sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/admin; Max-Age=0');
  if (req.headers.accept?.includes('application/json') || req.is('application/json')) {
    res.json({ ok: true });
  } else {
    res.redirect('/admin/login');
  }
});

// --- 以下所有 /api/* 路由均需要管理员鉴权 ---
router.use('/api', requireAdmin);

// ---- 1. 仪表盘统计 ----
router.get('/api/stats', (_req: Request, res: Response) => {
  const now = Math.floor(Date.now() / 1000);
  const onlineThreshold = now - ONLINE_WINDOW_SEC;

  const codeStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) AS unused,
      SUM(CASE WHEN status = 'active' AND (expires_at IS NULL OR expires_at >= ?) THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked,
      SUM(CASE WHEN status = 'active' AND expires_at IS NOT NULL AND expires_at < ? THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) AS trial_count
    FROM codes
  `).get(now, now) as any;

  const onlineRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM code_bindings cb
    JOIN codes c ON c.id = cb.code_id
    WHERE c.status = 'active' AND cb.last_seen_at > ?
  `).get(onlineThreshold) as { cnt: number };

  const blacklistRow = db.prepare('SELECT COUNT(*) AS cnt FROM blacklist').get() as { cnt: number };

  const onlineDevices = db.prepare(`
    SELECT cb.*, c.code, c.expires_at, p.name AS product_name, p.slug AS product_slug
    FROM code_bindings cb
    JOIN codes c ON c.id = cb.code_id
    JOIN products p ON p.id = c.product_id
    WHERE c.status = 'active' AND cb.last_seen_at > ?
    ORDER BY cb.last_seen_at DESC
    LIMIT 50
  `).all(onlineThreshold);

  res.json({
    ok: true,
    stats: {
      total: codeStats.total || 0,
      unused: codeStats.unused || 0,
      active: codeStats.active || 0,
      revoked: codeStats.revoked || 0,
      expired: codeStats.expired || 0,
      trial_count: codeStats.trial_count || 0,
      online: onlineRow.cnt || 0,
      online_devices: onlineRow.cnt || 0,
      blacklisted: blacklistRow.cnt || 0,
    },
    online_list: onlineDevices,
  });
});

// ---- 2. 产品管理 ----
router.get('/api/products', (_req: Request, res: Response) => {
  const now = Math.floor(Date.now() / 1000);
  const onlineThreshold = now - ONLINE_WINDOW_SEC;
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM codes c WHERE c.product_id = p.id) AS code_count,
      (SELECT COUNT(*) FROM codes c WHERE c.product_id = p.id AND c.status = 'active') AS active_count,
      (SELECT COUNT(*) FROM code_bindings cb JOIN codes c ON c.id = cb.code_id
       WHERE c.product_id = p.id AND c.status = 'active' AND cb.last_seen_at > ?) AS online_count
    FROM products p
    ORDER BY p.id DESC
  `).all(onlineThreshold);
  res.json({ ok: true, products: rows });
});

router.post('/api/products', (req: Request, res: Response) => {
  const b = req.body || {};
  const slug = String(b.slug || '').trim().toLowerCase();
  const name = String(b.name || '').trim().slice(0, 100);
  if (!SLUG_RE.test(slug) || !name) {
    res.status(400).json({ ok: false, error: 'bad_request' });
    return;
  }
  if (db.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) {
    res.json({ ok: false, error: 'slug_exists' });
    return;
  }

  const status = ['active', 'maintenance', 'disabled'].includes(b.status) ? b.status : 'active';
  const version = String(b.version || '1.0.0').trim().slice(0, 32);
  const minVersion = String(b.min_version || '1.0.0').trim().slice(0, 32);
  const announcement = String(b.announcement || '').slice(0, 2000);
  const customData = typeof b.custom_data === 'string' ? b.custom_data : JSON.stringify(b.custom_data || {});
  const codePrefix = String(b.code_prefix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const maxDevices = Math.min(Math.max(parseInt(b.max_devices, 10) || 1, 1), 100);
  const heartbeatInterval = Math.min(Math.max(parseInt(b.heartbeat_interval, 10) || 60, 10), 3600);
  const allowUnbind = b.allow_unbind === undefined ? 1 : (b.allow_unbind ? 1 : 0);
  const unbindCooldownSec = Math.max(parseInt(b.unbind_cooldown_sec, 10) || 0, 0);
  const unbindPenaltySec = Math.max(parseInt(b.unbind_penalty_sec, 10) || 0, 0);
  const maxUnbindCount = Math.max(parseInt(b.max_unbind_count, 10) || 0, 0);
  const trialEnabled = b.trial_enabled ? 1 : 0;
  const trialDurationSec = Math.max(parseInt(b.trial_duration_sec, 10) || 3600, 60);
  const now = Math.floor(Date.now() / 1000);

  const info = db.prepare(`
    INSERT INTO products (
      slug, name, status, version, min_version, announcement, custom_data,
      code_prefix, max_devices, heartbeat_interval, allow_unbind,
      unbind_cooldown_sec, unbind_penalty_sec, max_unbind_count,
      trial_enabled, trial_duration_sec, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug, name, status, version, minVersion, announcement, customData,
    codePrefix, maxDevices, heartbeatInterval, allowUnbind,
    unbindCooldownSec, unbindPenaltySec, maxUnbindCount,
    trialEnabled, trialDurationSec, now
  );

  getPublicKeyPem(slug); // 触发生成 Ed25519 密钥对
  adminLog('create_product', slug, req, Number(info.lastInsertRowid));
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/api/products/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }

  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 100) : existing.name;
  const status = ['active', 'maintenance', 'disabled'].includes(b.status) ? b.status : existing.status;
  const version = b.version !== undefined ? String(b.version).trim().slice(0, 32) : existing.version;
  const minVersion = b.min_version !== undefined ? String(b.min_version).trim().slice(0, 32) : existing.min_version;
  const announcement = b.announcement !== undefined ? String(b.announcement).slice(0, 2000) : existing.announcement;
  const customData = b.custom_data !== undefined
    ? (typeof b.custom_data === 'string' ? b.custom_data : JSON.stringify(b.custom_data))
    : existing.custom_data;
  const codePrefix = b.code_prefix !== undefined
    ? String(b.code_prefix).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    : existing.code_prefix;
  const maxDevices = b.max_devices !== undefined
    ? Math.min(Math.max(parseInt(b.max_devices, 10) || 1, 1), 100)
    : existing.max_devices;
  const heartbeatInterval = b.heartbeat_interval !== undefined
    ? Math.min(Math.max(parseInt(b.heartbeat_interval, 10) || 60, 10), 3600)
    : existing.heartbeat_interval;
  const allowUnbind = b.allow_unbind !== undefined ? (b.allow_unbind ? 1 : 0) : existing.allow_unbind;
  const unbindCooldownSec = b.unbind_cooldown_sec !== undefined
    ? Math.max(parseInt(b.unbind_cooldown_sec, 10) || 0, 0)
    : existing.unbind_cooldown_sec;
  const unbindPenaltySec = b.unbind_penalty_sec !== undefined
    ? Math.max(parseInt(b.unbind_penalty_sec, 10) || 0, 0)
    : existing.unbind_penalty_sec;
  const maxUnbindCount = b.max_unbind_count !== undefined
    ? Math.max(parseInt(b.max_unbind_count, 10) || 0, 0)
    : existing.max_unbind_count;
  const trialEnabled = b.trial_enabled !== undefined ? (b.trial_enabled ? 1 : 0) : existing.trial_enabled;
  const trialDurationSec = b.trial_duration_sec !== undefined
    ? Math.max(parseInt(b.trial_duration_sec, 10) || 3600, 60)
    : existing.trial_duration_sec;

  db.prepare(`
    UPDATE products SET
      name = ?, status = ?, version = ?, min_version = ?, announcement = ?, custom_data = ?,
      code_prefix = ?, max_devices = ?, heartbeat_interval = ?, allow_unbind = ?,
      unbind_cooldown_sec = ?, unbind_penalty_sec = ?, max_unbind_count = ?,
      trial_enabled = ?, trial_duration_sec = ?
    WHERE id = ?
  `).run(
    name, status, version, minVersion, announcement, customData,
    codePrefix, maxDevices, heartbeatInterval, allowUnbind,
    unbindCooldownSec, unbindPenaltySec, maxUnbindCount,
    trialEnabled, trialDurationSec, id
  );

  adminLog('update_product', existing.slug, req, id);
  res.json({ ok: true });
});

router.get('/api/products/:id/pubkey', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(req.params.id, 10)) as any;
  if (!row) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  res.json({ ok: true, slug: row.slug, pem: getPublicKeyPem(row.slug) });
});

// 按产品全服加时补偿 (为该产品下所有未过期的有效计时卡密统一顺延时长)
router.post('/api/products/:id/compensate', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!prod) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  const hours = parseFloat(req.body?.hours) || (parseFloat(req.body?.days) || 0) * 24;
  const addSec = Math.round(hours * 3600);
  if (addSec <= 0) {
    res.status(400).json({ ok: false, error: 'bad_duration' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    UPDATE codes
    SET expires_at = expires_at + ?
    WHERE product_id = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at > ?
  `).run(addSec, id, now);

  adminLog('compensate_product', `${prod.slug} +${hours}h (affected=${result.changes})`, req, id);
  res.json({ ok: true, affected: Number(result.changes) });
});

router.delete('/api/products/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!row) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  const n = (db.prepare('SELECT COUNT(*) AS n FROM codes WHERE product_id = ?').get(row.id) as { n: number }).n;
  if (n > 0 && req.query.force !== '1') {
    res.json({ ok: false, error: 'has_codes', code_count: n });
    return;
  }
  db.prepare('DELETE FROM code_bindings WHERE code_id IN (SELECT id FROM codes WHERE product_id = ?)').run(row.id);
  db.prepare('DELETE FROM machine_trials WHERE product_id = ?').run(row.id);
  db.prepare('DELETE FROM codes WHERE product_id = ?').run(row.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(row.id);
  deleteKeyPair(row.slug);
  adminLog('delete_product', row.slug, req);
  res.json({ ok: true });
});

// ---- 3. 卡密查询、生成與批量运维 ----
router.get('/api/codes', (req: Request, res: Response) => {
  const { status, q, product_id, is_trial, batch_no } = req.query;
  const now = Math.floor(Date.now() / 1000);
  const onlineThreshold = now - ONLINE_WINDOW_SEC;

  let baseWhere = '';
  const conds: string[] = [];
  const params: any[] = [];

  if (status === 'expired') {
    conds.push("c.status = 'active' AND c.expires_at IS NOT NULL AND c.expires_at < ?");
    params.push(now);
  } else if (status && ['unused', 'active', 'revoked'].includes(String(status))) {
    conds.push('c.status = ?');
    params.push(String(status));
  }

  if (product_id) {
    conds.push('c.product_id = ?');
    params.push(parseInt(String(product_id), 10) || 0);
  }

  if (is_trial !== undefined && is_trial !== '') {
    conds.push('c.is_trial = ?');
    params.push(parseInt(String(is_trial), 10) ? 1 : 0);
  }

  if (batch_no && typeof batch_no === 'string') {
    conds.push('c.batch_no = ?');
    params.push(batch_no.trim());
  }

  if (q && typeof q === 'string' && q.trim()) {
    conds.push(`(
      c.code LIKE ? OR c.machine_id LIKE ? OR c.note LIKE ? OR c.batch_no LIKE ?
      OR EXISTS (SELECT 1 FROM code_bindings cb WHERE cb.code_id = c.id AND cb.machine_id LIKE ?)
    )`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like);
  }

  if (conds.length) {
    baseWhere = ' WHERE ' + conds.join(' AND ');
  }

  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM codes c ${baseWhere}`).get(...params) as { total: number };
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '500'), 10) || 500, 1), 1000);
  const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

  const sql = `
    SELECT c.*, p.name AS product_name, p.slug AS product_slug, p.max_devices AS product_max_devices
    FROM codes c
    JOIN products p ON p.id = c.product_id
    ${baseWhere}
    ORDER BY c.id DESC
    LIMIT ? OFFSET ?
  `;

  const rawCodes = db.prepare(sql).all(...params, limit, offset) as Array<any>;

  // 批量加载关联的设备绑定会话
  const codeIds = rawCodes.map(c => c.id);
  const bindingsMap = new Map<number, Array<any>>();
  if (codeIds.length > 0) {
    const placeholders = codeIds.map(() => '?').join(',');
    const allBindings = db.prepare(`
      SELECT id, code_id, machine_id, device_name, kick, ip, bound_at, last_seen_at
      FROM code_bindings
      WHERE code_id IN (${placeholders})
      ORDER BY last_seen_at DESC
    `).all(...codeIds) as Array<any>;

    for (const b of allBindings) {
      b.online = b.last_seen_at > onlineThreshold;
      const list = bindingsMap.get(b.code_id) || [];
      list.push(b);
      bindingsMap.set(b.code_id, list);
    }
  }

  const codes = rawCodes.map(c => {
    const bindings = bindingsMap.get(c.id) || [];
    const anyOnline = bindings.some(b => b.online) || (c.status === 'active' && (c.last_seen_at || 0) > onlineThreshold);
    return {
      ...c,
      secret_hash: undefined,
      online: anyOnline,
      bound_devices: bindings.length,
      effective_max_devices: c.max_devices ?? c.product_max_devices ?? 1,
      bindings,
    };
  });

  res.json({ ok: true, codes, total: totalRow.total || 0, now });
});

router.post('/api/codes', (req: Request, res: Response) => {
  const b = req.body || {};
  const productId = parseInt(b.product_id, 10);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
  if (!product) {
    res.status(400).json({ ok: false, error: 'unknown_product' });
    return;
  }

  const count = Math.min(Math.max(parseInt(b.count, 10) || 1, 1), 1000);
  // 支持按秒(duration_sec)、小时(hours)或天(days)指定有效时长，0 表示永久
  let durationSec = 0;
  if (b.duration_sec !== undefined) {
    durationSec = Math.max(parseInt(b.duration_sec, 10) || 0, 0);
  } else if (b.hours !== undefined && parseFloat(b.hours) > 0) {
    durationSec = Math.round(parseFloat(b.hours) * 3600);
  } else if (b.days !== undefined && parseFloat(b.days) > 0) {
    durationSec = Math.round(parseFloat(b.days) * 86400);
  }

  const prefix = b.prefix !== undefined ? String(b.prefix) : product.code_prefix;
  const maxDevices = b.max_devices ? Math.min(Math.max(parseInt(b.max_devices, 10), 1), 100) : null;
  const note = String(b.note || '').slice(0, 200);
  const now = Math.floor(Date.now() / 1000);
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const batchNo = String(b.batch_no || `B${dateStr}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`).slice(0, 32);

  const insert = db.prepare(`
    INSERT INTO codes (product_id, code, batch_no, status, is_trial, duration_sec, max_devices, expires_at, note, created_at)
    VALUES (?, ?, ?, 'unused', 0, ?, ?, NULL, ?, ?)
  `);

  const checkExist = db.prepare('SELECT 1 FROM codes WHERE code = ?');
  const created: string[] = [];

  for (let i = 0; i < count; i++) {
    let code: string;
    do {
      code = generateCodeString(prefix);
    } while (checkExist.get(code));
    insert.run(productId, code, batchNo, durationSec, maxDevices, note, now);
    created.push(code);
  }

  adminLog('create_codes', `${product.slug} x${count} (batch=${batchNo}, dur=${durationSec}s)`, req, productId);
  res.json({ ok: true, codes: created, batch_no: batchNo });
});

// ---- 批量操作接口 ----
router.post('/api/codes/batch', (req: Request, res: Response) => {
  const { ids, action, days, hours } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ ok: false, error: 'empty_ids' });
    return;
  }
  const cleanIds = ids.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n > 0);
  if (cleanIds.length === 0) {
    res.status(400).json({ ok: false, error: 'invalid_ids' });
    return;
  }

  const placeholders = cleanIds.map(() => '?').join(',');
  const now = Math.floor(Date.now() / 1000);

  if (action === 'revoke') {
    db.prepare(`UPDATE codes SET status = 'revoked' WHERE id IN (${placeholders})`).run(...cleanIds);
  } else if (action === 'restore') {
    db.prepare(`
      UPDATE codes
      SET status = CASE WHEN activated_at IS NOT NULL THEN 'active' ELSE 'unused' END
      WHERE id IN (${placeholders})
    `).run(...cleanIds);
  } else if (action === 'unbind') {
    db.prepare(`DELETE FROM code_bindings WHERE code_id IN (${placeholders})`).run(...cleanIds);
    db.prepare(`
      UPDATE codes
      SET status = 'unused', machine_id = NULL, secret_hash = NULL, kick = 0
      WHERE id IN (${placeholders})
    `).run(...cleanIds);
  } else if (action === 'kick') {
    db.prepare(`UPDATE code_bindings SET kick = 1 WHERE code_id IN (${placeholders})`).run(...cleanIds);
    db.prepare(`UPDATE codes SET kick = 1 WHERE id IN (${placeholders})`).run(...cleanIds);
  } else if (action === 'extend') {
    const addSec = Math.round(((parseFloat(hours) || 0) + (parseFloat(days) || 0) * 24) * 3600);
    if (addSec <= 0) {
      res.status(400).json({ ok: false, error: 'bad_duration' });
      return;
    }
    const rows = db.prepare(`SELECT id, status, duration_sec, expires_at FROM codes WHERE id IN (${placeholders})`).all(...cleanIds) as Array<any>;
    for (const r of rows) {
      if (r.status === 'unused' && !r.expires_at) {
        if (r.duration_sec > 0) {
          db.prepare('UPDATE codes SET duration_sec = duration_sec + ? WHERE id = ?').run(addSec, r.id);
        }
      } else {
        const base = r.expires_at && r.expires_at > now ? r.expires_at : now;
        db.prepare('UPDATE codes SET expires_at = ? WHERE id = ?').run(base + addSec, r.id);
      }
    }
  } else if (action === 'delete') {
    db.prepare(`DELETE FROM code_bindings WHERE code_id IN (${placeholders})`).run(...cleanIds);
    db.prepare(`DELETE FROM machine_trials WHERE code_id IN (${placeholders})`).run(...cleanIds);
    db.prepare(`DELETE FROM codes WHERE id IN (${placeholders})`).run(...cleanIds);
  } else {
    res.status(400).json({ ok: false, error: 'unknown_action' });
    return;
  }

  adminLog(`batch_${action}`, `count=${cleanIds.length}`, req);
  res.json({ ok: true, count: cleanIds.length });
});

function getCodeOr404(req: Request, res: Response): any | null {
  const row = db.prepare('SELECT * FROM codes WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!row) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return null;
  }
  return row;
}

router.post('/api/codes/:id/revoke', (req: Request, res: Response) => {
  const row = getCodeOr404(req, res);
  if (!row) return;
  db.prepare("UPDATE codes SET status = 'revoked' WHERE id = ?").run(row.id);
  adminLog('revoke', row.code, req, row.product_id, row.code);
  res.json({ ok: true });
});

router.post('/api/codes/:id/restore', (req: Request, res: Response) => {
  const row = getCodeOr404(req, res);
  if (!row) return;
  const bindCount = (db.prepare('SELECT COUNT(*) AS n FROM code_bindings WHERE code_id = ?').get(row.id) as { n: number }).n;
  const status = bindCount > 0 || row.machine_id ? 'active' : 'unused';
  db.prepare('UPDATE codes SET status = ? WHERE id = ?').run(status, row.id);
  adminLog('restore', row.code, req, row.product_id, row.code);
  res.json({ ok: true });
});

router.post('/api/codes/:id/unbind', (req: Request, res: Response) => {
  const row = getCodeOr404(req, res);
  if (!row) return;
  const targetMid = req.body?.machine_id ? String(req.body.machine_id).trim().toLowerCase() : null;

  if (targetMid) {
    db.prepare('DELETE FROM code_bindings WHERE code_id = ? AND machine_id = ?').run(row.id, targetMid);
    const remain = db.prepare('SELECT * FROM code_bindings WHERE code_id = ?').all(row.id) as Array<any>;
    if (remain.length === 0) {
      db.prepare("UPDATE codes SET status = 'unused', machine_id = NULL, secret_hash = NULL, kick = 0 WHERE id = ?").run(row.id);
    } else {
      db.prepare('UPDATE codes SET machine_id = ?, secret_hash = ? WHERE id = ?')
        .run(remain[0].machine_id, remain[0].secret_hash, row.id);
    }
    adminLog('unbind_device', `${row.code} (${targetMid})`, req, row.product_id, row.code);
  } else {
    db.prepare('DELETE FROM code_bindings WHERE code_id = ?').run(row.id);
    db.prepare(`
      UPDATE codes
      SET status = 'unused', machine_id = NULL, secret_hash = NULL, last_seen_at = NULL, kick = 0
      WHERE id = ?
    `).run(row.id);
    adminLog('unbind_all', row.code, req, row.product_id, row.code);
  }

  res.json({ ok: true });
});

router.post('/api/codes/:id/kick', (req: Request, res: Response) => {
  const row = getCodeOr404(req, res);
  if (!row) return;
  if (row.status !== 'active') {
    res.json({ ok: false, error: 'not_active' });
    return;
  }
  const targetMid = req.body?.machine_id ? String(req.body.machine_id).trim().toLowerCase() : null;
  if (targetMid) {
    db.prepare('UPDATE code_bindings SET kick = 1 WHERE code_id = ? AND machine_id = ?').run(row.id, targetMid);
  } else {
    db.prepare('UPDATE code_bindings SET kick = 1 WHERE code_id = ?').run(row.id);
    db.prepare('UPDATE codes SET kick = 1 WHERE id = ?').run(row.id);
  }
  adminLog('kick', targetMid ? `${row.code} (${targetMid})` : row.code, req, row.product_id, row.code);
  res.json({ ok: true });
});

router.post('/api/codes/:id/extend', (req: Request, res: Response) => {
  const row = getCodeOr404(req, res);
  if (!row) return;
  const days = parseFloat(req.body?.days) || 0;
  const hours = parseFloat(req.body?.hours) || 0;
  const addSec = Math.round((days * 86400) + (hours * 3600));
  if (addSec <= 0) {
    res.status(400).json({ ok: false, error: 'bad_days' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (row.status === 'unused' && !row.expires_at) {
    db.prepare('UPDATE codes SET duration_sec = duration_sec + ? WHERE id = ?').run(addSec, row.id);
  } else {
    const base = row.expires_at && row.expires_at > now ? row.expires_at : now;
    db.prepare('UPDATE codes SET expires_at = ? WHERE id = ?').run(base + addSec, row.id);
  }
  adminLog('extend', `${row.code} +${Math.round(addSec / 3600)}h`, req, row.product_id, row.code);
  res.json({ ok: true });
});

router.delete('/api/codes/:id', (req: Request, res: Response) => {
  const row = getCodeOr404(req, res);
  if (!row) return;
  db.prepare('DELETE FROM code_bindings WHERE code_id = ?').run(row.id);
  db.prepare('DELETE FROM machine_trials WHERE code_id = ?').run(row.id);
  db.prepare('DELETE FROM codes WHERE id = ?').run(row.id);
  adminLog('delete_code', row.code, req, row.product_id, row.code);
  res.json({ ok: true });
});

// ---- 4. 机器码黑名单管理 ----
router.get('/api/blacklist', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT b.*, p.name AS product_name, p.slug AS product_slug
    FROM blacklist b
    LEFT JOIN products p ON p.id = b.product_id
    ORDER BY b.id DESC
  `).all();
  res.json({ ok: true, blacklist: rows });
});

router.post('/api/blacklist', (req: Request, res: Response) => {
  const mid = String(req.body?.machine_id || '').trim().toLowerCase();
  const productId = req.body?.product_id ? parseInt(req.body.product_id, 10) : null;
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (!mid || mid.length < 4) {
    res.status(400).json({ ok: false, error: 'bad_machine_id' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO blacklist (product_id, machine_id, reason, created_at) VALUES (?, ?, ?, ?)')
    .run(productId, mid, reason, now);

  // 自动将受影响的在线设备标记为踢下线
  db.prepare('UPDATE code_bindings SET kick = 1 WHERE machine_id = ?').run(mid);
  adminLog('ban_machine', `${mid} (${reason})`, req, productId);
  res.json({ ok: true });
});

router.delete('/api/blacklist/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM blacklist WHERE id = ?').get(id) as any;
  if (!row) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  db.prepare('DELETE FROM blacklist WHERE id = ?').run(id);
  adminLog('unban_machine', row.machine_id, req, row.product_id);
  res.json({ ok: true });
});

// ---- 5. 审计日志查询与清理 ----
router.get('/api/logs', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || '200'), 10) || 200, 1000);
  const q = String(req.query.q || '').trim();
  const productId = req.query.product_id ? parseInt(String(req.query.product_id), 10) : null;

  const conds: string[] = ["l.action NOT LIKE 'heartbeat%'"];
  const params: any[] = [];

  if (productId) {
    conds.push('l.product_id = ?');
    params.push(productId);
  }
  if (q) {
    conds.push('(l.code LIKE ? OR l.machine_id LIKE ? OR l.action LIKE ? OR l.detail LIKE ? OR l.ip LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  const rows = db.prepare(`
    SELECT l.*, p.slug AS product_slug
    FROM logs l
    LEFT JOIN products p ON p.id = l.product_id
    WHERE ${conds.join(' AND ')}
    ORDER BY l.id DESC
    LIMIT ?
  `).all(...params, limit);

  res.json({ ok: true, logs: rows });
});

router.delete('/api/logs', (req: Request, res: Response) => {
  const days = parseInt(String(req.query.before_days || '0'), 10);
  if (days > 0) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    db.prepare('DELETE FROM logs WHERE created_at < ?').run(cutoff);
  } else {
    db.prepare('DELETE FROM logs').run();
  }
  adminLog('clear_logs', days > 0 ? `>${days}d` : 'all', req);
  res.json({ ok: true });
});

export default router;
