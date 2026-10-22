import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// 项目根目录（兼容 tsx 开发态 src/server 与编译后 dist/server）
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const KEYS_DIR = path.join(ROOT_DIR, 'keys');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'dist', 'public');

export function loadEnv(): void {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || m[1] in process.env) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }

  if (!process.env.ADMIN_PASSWORD) {
    const pw = crypto.randomBytes(12).toString('base64url');
    fs.writeFileSync(envPath, `PORT=3000\nADMIN_PASSWORD=${pw}\n`);
    process.env.ADMIN_PASSWORD = pw;
    console.log('==================================================');
    console.log('[init] ADMIN_PASSWORD generated and saved to .env:');
    console.log('       ' + pw);
    console.log('==================================================');
  }
}

loadEnv();

export const PORT = parseInt(process.env.PORT || '3000', 10);
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const ONLINE_WINDOW_SEC = 180; // 3分钟内有心跳视为在线
