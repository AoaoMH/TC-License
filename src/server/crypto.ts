import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { KEYS_DIR } from './config';
import { TokenPayload } from '../shared/types';

fs.mkdirSync(KEYS_DIR, { recursive: true });

interface KeyPairEntry {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
}

const keyCache = new Map<string, KeyPairEntry>();

function privPath(slug: string): string {
  return path.join(KEYS_DIR, `${slug}_private.pem`);
}

function pubPath(slug: string): string {
  return path.join(KEYS_DIR, `${slug}_public.pem`);
}

export function generateKeyPair(slug: string): void {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privPath(slug), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(pubPath(slug), publicKey.export({ type: 'spki', format: 'pem' }));
  keyCache.delete(slug);
}

export function getKeyPair(slug: string): KeyPairEntry {
  let entry = keyCache.get(slug);
  if (!entry) {
    if (!fs.existsSync(privPath(slug))) {
      generateKeyPair(slug);
    }
    entry = {
      privateKey: crypto.createPrivateKey(fs.readFileSync(privPath(slug))),
      publicKey: crypto.createPublicKey(fs.readFileSync(pubPath(slug))),
    };
    keyCache.set(slug, entry);
  }
  return entry;
}

export function getPublicKeyPem(slug: string): string {
  return getKeyPair(slug).publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

export function deleteKeyPair(slug: string): void {
  keyCache.delete(slug);
  if (fs.existsSync(privPath(slug))) fs.unlinkSync(privPath(slug));
  if (fs.existsSync(pubPath(slug))) fs.unlinkSync(pubPath(slug));
}

export function issueToken(slug: string, payload: TokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload));
  const sig = crypto.sign(null, data, getKeyPair(slug).privateKey);
  return data.toString('base64url') + '.' + sig.toString('base64url');
}

// --- 随机激活码生成（支持自定义前缀） ---
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCodeString(prefix?: string): string {
  const bytes = crypto.randomBytes(16);
  let body = '';
  for (let i = 0; i < 16; i++) {
    body += ALPHABET[bytes[i] & 31];
    if (i % 4 === 3 && i < 15) body += '-';
  }
  const cleanPrefix = (prefix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return cleanPrefix ? `${cleanPrefix}-${body}` : body;
}

// --- HMAC 密钥与防重放签名校验 ---
export function newSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

const TS_WINDOW_MS = 5 * 60 * 1000; // ±5分钟时间窗口
const MAX_NONCE_CACHE = 50000;
const seenNonces = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of seenNonces) {
    if (exp < now) seenNonces.delete(n);
  }
}, 60000).unref();

export function verifySignedRequest(params: {
  product?: string;
  code: string;
  mid: string;
  ts: unknown;
  nonce: unknown;
  sig: unknown;
  secretHash: string | null | undefined;
}): string | null {
  const tsNum = Number(params.ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > TS_WINDOW_MS) {
    return 'stale_ts';
  }
  if (typeof params.nonce !== 'string' || !/^[a-zA-Z0-9_-]{12,64}$/.test(params.nonce)) {
    return 'bad_nonce';
  }
  if (seenNonces.has(params.nonce)) {
    return 'replay';
  }
  if (!params.secretHash || typeof params.sig !== 'string' || params.sig.length !== 64) {
    return 'bad_sig';
  }

  const key = Buffer.from(params.secretHash, 'hex');
  const sigBuf = Buffer.from(params.sig.toLowerCase(), 'utf8');

  // 同时支持 v3 推荐签名格式 (含 product) 与 v2 签名格式
  const candidates: string[] = [];
  if (params.product) {
    candidates.push(`${params.product}|${params.code}|${params.mid}|${params.ts}|${params.nonce}`);
  }
  candidates.push(`${params.code}|${params.mid}|${params.ts}|${params.nonce}`);

  let matched = false;
  for (const msg of candidates) {
    const expect = crypto.createHmac('sha256', key).update(msg).digest('hex');
    const expectBuf = Buffer.from(expect, 'utf8');
    if (sigBuf.length === expectBuf.length && crypto.timingSafeEqual(sigBuf, expectBuf)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    return 'bad_sig';
  }

  if (seenNonces.size >= MAX_NONCE_CACHE) {
    const firstKey = seenNonces.keys().next().value;
    if (firstKey) seenNonces.delete(firstKey);
  }
  seenNonces.set(params.nonce, Date.now() + TS_WINDOW_MS);
  return null;
}
