// E2E 自动化测试套件 — License Server v3
// 覆盖：管理员鉴权、多产品策略、防跨产品串码、激活后计时、多设备席位、HMAC防重放、
//       全服加时补偿与Token刷新、客户端自助换绑(扣时惩罚)、机器码免费试用、远程踢下线、机器码黑名单
// 用法: node test-e2e.mjs <admin_password>
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:3000';
const PW = process.argv[2];
if (!PW) {
  console.error('用法: node test-e2e.mjs <admin_password>');
  process.exit(1);
}

const MID1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const MID2 = 'ffeeddccbbaa99887766554433221100';
const MID3 = '11223344556677889900aabbccddeeff';
const MID_TRIAL = '99887766554433221100ffeeddccbbaa';
const SLUG = 'test-v3-' + Date.now().toString(36);

let passed = 0;
function ok(msg) {
  passed++;
  console.log(`✓ [${passed}] ${msg}`);
}
function fail(msg) {
  console.error(`✗ FAIL: ${msg}`);
  process.exit(1);
}

async function api(path, body, cookie, method) {
  const res = await fetch(BASE + path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

function signReq(product, secret, code, mid) {
  const ts = Date.now();
  const nonce = crypto.randomBytes(12).toString('base64url');
  const key = crypto.createHash('sha256').update(secret).digest();
  const sig = crypto.createHmac('sha256', key).update(`${product}|${code}|${mid}|${ts}|${nonce}`).digest('hex');
  return { product, code, machine_id: mid, ts, nonce, sig };
}

// 1. 健康检查与未授权拦截
const health = await (await fetch(BASE + '/health')).json();
if (!health.ok) fail('health check');
ok('健康检查 /health 正常');

const unauth = await fetch(BASE + '/admin/api/codes');
if (unauth.status !== 401) fail('admin auth check');
ok('未登录访问后台 API 正确返回 401');

// 2. 管理员登录
const loginRes = await fetch(BASE + '/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'password=' + encodeURIComponent(PW),
  redirect: 'manual',
});
const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
if (!cookie.startsWith('sid=')) fail('admin login');
ok('管理员登录成功并获取 HttpOnly Session Cookie');

// 3. 创建自定义产品 (含前缀 VIP、单码最多 2 台设备、开启免费试用、开启自助换绑且扣时 1 小时、配置私有 JSON)
let r = await api('/admin/api/products', {
  name: 'Test V3 Product',
  slug: SLUG,
  version: '2.0.0',
  min_version: '1.5.0',
  announcement: 'Welcome to V3',
  custom_data: { secret_offset: '0x1A2B3C', vip: true },
  code_prefix: 'VIP',
  max_devices: 2,
  allow_unbind: 1,
  unbind_cooldown_sec: 0,
  unbind_penalty_sec: 3600,
  max_unbind_count: 2,
  trial_enabled: 1,
  trial_duration_sec: 1800,
}, cookie);
if (!r.json.ok) fail('create product: ' + JSON.stringify(r.json));
const prodId = r.json.id;
ok('创建自定义产品成功 (配置多设备上限=2、换绑扣时=1h、免费试用=30m、私有配置)');

// 4. 客户端 /api/init 初始化与版本检查
r = await api(`/api/init?product=${SLUG}&version=1.2.0`);
if (!r.json.ok || !r.json.product.update_required || r.json.product.custom_data !== undefined) {
  fail('/api/init check: ' + JSON.stringify(r.json));
}
ok('客户端 /api/init 正常返回版本强更提示与公钥，且未泄露私有 custom_data');

// 5. 公钥一致性检查
const pubAdmin = (await api(`/admin/api/products/${prodId}/pubkey`, undefined, cookie)).json;
const pubApi = await (await fetch(`${BASE}/api/pubkey?product=${SLUG}`)).text();
if (pubAdmin.pem !== pubApi) fail('pubkey mismatch');
ok('产品 Ed25519 公钥一致 (/admin vs /api/pubkey)');

// 6. 生成激活码 (验证前缀与激活后计时模式)
r = await api('/admin/api/codes', { product_id: prodId, count: 1, days: 30, note: 'e2e-v3' }, cookie);
if (!r.json.ok || !r.json.codes[0].startsWith('VIP-')) fail('create code: ' + JSON.stringify(r.json));
const code = r.json.codes[0];
const unusedRow = (await api(`/admin/api/codes?q=${code}`, undefined, cookie)).json.codes[0];
if (unusedRow.expires_at !== null || unusedRow.duration_sec !== 30 * 86400) {
  fail('unused code should not have expires_at before activation');
}
ok(`生成带前缀激活码 (${code})，未激活时 expires_at=null (激活后才开始倒计时)`);

// 7. 防跨产品串码测试
r = await api('/api/activate', { product: 'wrong-product-slug', code, machine_id: MID1 });
if (r.json.error !== 'product_mismatch') fail('cross-product activation should be rejected');
ok('防跨产品串码校验生效 (product_mismatch)');

// 8. 首次激活 (设备 1)
r = await api('/api/activate', { product: SLUG, code, machine_id: MID1, device_name: 'Dev-1' });
if (!r.json.ok || !r.json.token || !r.json.secret || r.json.custom_data?.secret_offset !== '0x1A2B3C') {
  fail('activate MID1: ' + JSON.stringify(r.json));
}
const { token: token1, secret: secret1, expires_at: initialExp } = r.json;
ok('设备 1 首次激活成功，开始倒计时并下发离线 Token、HMAC Secret 与私有 custom_data');

// 9. 验证 Ed25519 离线签名
const [pb, sb] = token1.split('.');
const payload = JSON.parse(Buffer.from(pb, 'base64url').toString());
const sigOk = crypto.verify(null, Buffer.from(pb, 'base64url'), crypto.createPublicKey(pubApi), Buffer.from(sb, 'base64url'));
if (!sigOk || payload.p !== SLUG || payload.c !== code || payload.m !== MID1) fail('token ed25519 verify');
ok('离线 Token Ed25519 签名验证通过');

// 10. 多设备席位测试 (max_devices = 2)：设备 2 激活成功，设备 3 激活被拒
r = await api('/api/activate', { product: SLUG, code, machine_id: MID2, device_name: 'Dev-2' });
if (!r.json.ok) fail('activate MID2 should succeed (max_devices=2)');
r = await api('/api/activate', { product: SLUG, code, machine_id: MID3, device_name: 'Dev-3' });
if (r.json.error !== 'bound_to_other') fail('activate MID3 should fail with bound_to_other');
ok('多设备席位并发控制生效 (第 2 台成功绑定，第 3 台超出席位被拒)');

// 11. HMAC 签名验证与防重放测试
const signed = signReq(SLUG, secret1, code, MID1);
r = await api('/api/verify', signed);
if (!r.json.ok) fail('verify ok: ' + JSON.stringify(r.json));
r = await api('/api/verify', signed);
if (r.json.error !== 'replay') fail('replay nonce should be rejected');
const badSig = signReq(SLUG, secret1, code, MID1);
badSig.sig = '0'.repeat(64);
r = await api('/api/verify', badSig);
if (r.json.error !== 'bad_sig') fail('bad signature should be rejected');
ok('HMAC-SHA256 签名验证与 Nonce 防重放拦截生效');

// 12. 按产品全服加时补偿 + Verify 自动刷新离线 Token
r = await api(`/admin/api/products/${prodId}/compensate`, { hours: 24 }, cookie);
if (!r.json.ok || r.json.affected !== 1) fail('compensate product');
r = await api('/api/verify', signReq(SLUG, secret1, code, MID1));
if (!r.json.ok || r.json.expires_at !== initialExp + 86400) fail('verify after compensate');
const [newPb] = r.json.token.split('.');
const newPayload = JSON.parse(Buffer.from(newPb, 'base64url').toString());
if (newPayload.exp !== initialExp + 86400) fail('refreshed token exp mismatch');
ok('全服加时补偿生效，且客户端 /api/verify 自动获发最新到期时间的离线 Token');

// 13. 客户端自助换绑测试 (解绑 MID2，扣除 3600s 惩罚时长，释放席位后 MID3 激活成功)
const expBeforeUnbind = r.json.expires_at;
r = await api('/api/unbind', { product: SLUG, code, machine_id: MID2 });
if (!r.json.ok || r.json.expires_at !== expBeforeUnbind - 3600) {
  fail('client unbind: ' + JSON.stringify(r.json));
}
r = await api('/api/activate', { product: SLUG, code, machine_id: MID3, device_name: 'Dev-3' });
if (!r.json.ok) fail('MID3 activate after MID2 unbind');
ok('客户端自助换绑成功：自动扣除 1 小时惩罚时长，释放席位后新设备成功激活');

// 14. 机器码免费试用测试 (/api/trial)
r = await api('/api/trial', { product: SLUG, machine_id: MID_TRIAL, device_name: 'Trial-PC' });
if (!r.json.ok || !r.json.is_trial || !r.json.code.startsWith('TRIAL-')) {
  fail('trial issue: ' + JSON.stringify(r.json));
}
const trialCodeStr = r.json.code;
const trialSecret = r.json.secret;
r = await api('/api/heartbeat', signReq(SLUG, trialSecret, trialCodeStr, MID_TRIAL));
if (!r.json.ok || r.json.status !== 'active') fail('trial heartbeat');
// 吊销试用卡后再次申请试用，应拒绝重复白嫖
const trialRow = (await api(`/admin/api/codes?q=${trialCodeStr}`, undefined, cookie)).json.codes[0];
await api(`/admin/api/codes/${trialRow.id}/revoke`, {}, cookie);
r = await api('/api/trial', { product: SLUG, machine_id: MID_TRIAL });
if (r.json.error !== 'trial_already_used') fail('repeat trial should be blocked');
ok('机器码免费试用签发、心跳验证及防重复试用拦截生效');

// 15. 心跳在线状态与单设备远程踢下线 (Kick)
r = await api('/api/heartbeat', signReq(SLUG, secret1, code, MID1));
if (r.json.status !== 'active') fail('heartbeat active');
const activeRow = (await api(`/admin/api/codes?q=${code}`, undefined, cookie)).json.codes[0];
if (!activeRow.online || activeRow.bound_devices !== 2) fail('admin online & bound_devices check');
await api(`/admin/api/codes/${activeRow.id}/kick`, { machine_id: MID1 }, cookie);
r = await api('/api/heartbeat', signReq(SLUG, secret1, code, MID1));
if (r.json.status !== 'kick') fail('kick not delivered');
r = await api('/api/heartbeat', signReq(SLUG, secret1, code, MID1));
if (r.json.status !== 'active') fail('kick should be one-shot');
ok('心跳在线检测与单设备一次性远程踢下线 (Kick) 正常');

// 16. 机器码黑名单测试
r = await api('/admin/api/blacklist', { product_id: prodId, machine_id: MID3, reason: 'E2E Ban Test' }, cookie);
if (!r.json.ok) fail('add blacklist');
r = await api('/api/activate', { product: SLUG, code, machine_id: MID3 });
if (r.json.error !== 'machine_banned') fail('banned machine should be blocked on activate');
const blList = (await api('/admin/api/blacklist', undefined, cookie)).json.blacklist;
const blEntry = blList.find(b => b.machine_id === MID3);
await api(`/admin/api/blacklist/${blEntry.id}`, undefined, cookie, 'DELETE');
ok('机器码黑名单封禁拦截与解封恢复正常');

// 17. 清理测试产品与关联卡密/密钥
r = await api(`/admin/api/products/${prodId}?force=1`, undefined, cookie, 'DELETE');
if (!r.json.ok) fail('cleanup product');
ok('测试数据与临时密钥对清理完成');

console.log(`\n🎉 ALL ${passed} E2E TESTS PASSED!`);
process.exit(0);
