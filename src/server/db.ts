import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'license.db'));

// 开启 WAL 高并发模式与外键约束
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// 初始化核心表结构
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',       -- active | maintenance | disabled
  version             TEXT NOT NULL DEFAULT '1.0.0',
  min_version         TEXT NOT NULL DEFAULT '1.0.0',
  announcement        TEXT NOT NULL DEFAULT '',
  custom_data         TEXT NOT NULL DEFAULT '{}',           -- 激活/验证通过后下发的私有配置
  code_prefix         TEXT NOT NULL DEFAULT '',
  max_devices         INTEGER NOT NULL DEFAULT 1,
  heartbeat_interval  INTEGER NOT NULL DEFAULT 60,
  allow_unbind        INTEGER NOT NULL DEFAULT 1,           -- 1=允许客户端自助换绑
  unbind_cooldown_sec INTEGER NOT NULL DEFAULT 86400,       -- 默认冷却 24 小时
  unbind_penalty_sec  INTEGER NOT NULL DEFAULT 0,           -- 换绑扣除时长(秒)
  max_unbind_count    INTEGER NOT NULL DEFAULT 0,           -- 0=不限次数
  trial_enabled       INTEGER NOT NULL DEFAULT 0,           -- 0=关闭免费试用, 1=开启
  trial_duration_sec  INTEGER NOT NULL DEFAULT 3600,        -- 默认试用 1 小时
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS codes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  code           TEXT NOT NULL UNIQUE,
  batch_no       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'unused',            -- unused | active | revoked
  is_trial       INTEGER NOT NULL DEFAULT 0,                -- 0=正式卡, 1=试用卡
  duration_sec   INTEGER NOT NULL DEFAULT 0,                -- 有效时长(秒), 0=永久
  max_devices    INTEGER,                                   -- NULL 则继承产品 max_devices
  unbind_count   INTEGER NOT NULL DEFAULT 0,
  last_unbind_at INTEGER,
  machine_id     TEXT,                                      -- 主绑定机器码(兼容展示)
  secret_hash    TEXT,                                      -- 兼容旧字段
  expires_at     INTEGER,                                   -- 到期秒级时间戳, NULL=永久或未激活
  note           TEXT NOT NULL DEFAULT '',
  kick           INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  activated_at   INTEGER,
  last_seen_at   INTEGER
);

CREATE TABLE IF NOT EXISTS code_bindings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id      INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  machine_id   TEXT NOT NULL,
  device_name  TEXT NOT NULL DEFAULT '',
  secret_hash  TEXT NOT NULL,
  kick         INTEGER NOT NULL DEFAULT 0,
  ip           TEXT,
  bound_at     INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(code_id, machine_id)
);

CREATE TABLE IF NOT EXISTS machine_trials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  code_id    INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  ip         TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(product_id, machine_id)
);

CREATE TABLE IF NOT EXISTS blacklist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE, -- NULL 表示全局封禁
  machine_id TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  code       TEXT,
  machine_id TEXT,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT,
  created_at INTEGER NOT NULL
);
`);

// ---- 自动平滑迁移 (v2 -> v3) ----
function ensureColumn(table: string, col: string, defSql: string): void {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defSql}`);
  }
}

// 补齐 products 表 v3 扩展字段
ensureColumn('products', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('products', 'version', "TEXT NOT NULL DEFAULT '1.0.0'");
ensureColumn('products', 'min_version', "TEXT NOT NULL DEFAULT '1.0.0'");
ensureColumn('products', 'announcement', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'custom_data', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('products', 'code_prefix', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'max_devices', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('products', 'heartbeat_interval', 'INTEGER NOT NULL DEFAULT 60');
ensureColumn('products', 'allow_unbind', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('products', 'unbind_cooldown_sec', 'INTEGER NOT NULL DEFAULT 86400');
ensureColumn('products', 'unbind_penalty_sec', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'max_unbind_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'trial_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'trial_duration_sec', 'INTEGER NOT NULL DEFAULT 3600');

// 补齐 codes 表 v3 扩展字段
ensureColumn('codes', 'batch_no', "TEXT NOT NULL DEFAULT ''");
ensureColumn('codes', 'is_trial', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('codes', 'duration_sec', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('codes', 'max_devices', 'INTEGER');
ensureColumn('codes', 'unbind_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('codes', 'last_unbind_at', 'INTEGER');

// 补齐 logs 表 v3 扩展字段
ensureColumn('logs', 'product_id', 'INTEGER');
ensureColumn('logs', 'detail', "TEXT NOT NULL DEFAULT ''");

// 将 v2 已激活的卡密平滑迁移至 code_bindings 表，并修正 v2 未激活卡密的 duration_sec
const legacyActiveCodes = db.prepare(`
  SELECT c.* FROM codes c
  LEFT JOIN code_bindings cb ON cb.code_id = c.id
  WHERE c.status = 'active' AND c.machine_id IS NOT NULL AND cb.id IS NULL
`).all() as Array<any>;

if (legacyActiveCodes.length > 0) {
  const insBinding = db.prepare(`
    INSERT OR IGNORE INTO code_bindings (code_id, machine_id, device_name, secret_hash, kick, bound_at, last_seen_at)
    VALUES (?, ?, 'Legacy Device', ?, ?, ?, ?)
  `);
  const now = Math.floor(Date.now() / 1000);
  for (const c of legacyActiveCodes) {
    insBinding.run(
      c.id,
      c.machine_id,
      c.secret_hash || '',
      c.kick || 0,
      c.activated_at || c.created_at || now,
      c.last_seen_at || c.activated_at || now
    );
  }
  console.log(`[db] migrated ${legacyActiveCodes.length} v2 active binding(s) into code_bindings`);
}

// 修正 v2 中未激活但已写入 expires_at 的卡密为激活后计时
const legacyUnusedWithExp = db.prepare(`
  SELECT id, created_at, expires_at FROM codes
  WHERE status = 'unused' AND expires_at IS NOT NULL AND duration_sec = 0
`).all() as Array<{ id: number; created_at: number; expires_at: number }>;

if (legacyUnusedWithExp.length > 0) {
  const updUnused = db.prepare('UPDATE codes SET duration_sec = ?, expires_at = NULL WHERE id = ?');
  for (const c of legacyUnusedWithExp) {
    const dur = Math.max(86400, c.expires_at - c.created_at);
    updUnused.run(dur, c.id);
  }
  console.log(`[db] converted ${legacyUnusedWithExp.length} unused v2 code(s) to post-activation duration mode`);
}

// 创建索引以提升高频查询性能
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_codes_product ON codes(product_id);
  CREATE INDEX IF NOT EXISTS idx_codes_status ON codes(status);
  CREATE INDEX IF NOT EXISTS idx_codes_batch ON codes(batch_no);
  CREATE INDEX IF NOT EXISTS idx_bindings_code ON code_bindings(code_id);
  CREATE INDEX IF NOT EXISTS idx_bindings_machine ON code_bindings(machine_id);
  CREATE INDEX IF NOT EXISTS idx_blacklist_machine ON blacklist(machine_id);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
`);

export function writeLog(params: {
  productId?: number | null;
  code?: string | null;
  machineId?: string | null;
  action: string;
  detail?: string;
  ip?: string | null;
}): void {
  db.prepare(`
    INSERT INTO logs (product_id, code, machine_id, action, detail, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.productId ?? null,
    params.code ?? null,
    params.machineId ?? null,
    params.action,
    params.detail ?? '',
    params.ip ?? null,
    Math.floor(Date.now() / 1000)
  );
}

export default db;
