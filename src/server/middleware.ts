import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// --- 安全响应头 ---
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

// --- 滑动窗口限流器 ---
export function rateLimit(max: number, windowMs: number, keyFn?: (req: Request) => string) {
  const hits = new Map<string, number[]>();

  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) {
      const kept = arr.filter(t => now - t < windowMs);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, Math.max(windowMs, 60000)).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn ? keyFn(req) : (req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      res.status(429).json({ ok: false, error: 'rate_limited', message: '请求过于频繁，请稍后再试' });
      return;
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

// --- 后台会话管理 ---
const SESSION_TTL_MS = 12 * 3600 * 1000;
const sessions = new Map<string, number>();

export function createSession(): string {
  const sid = crypto.randomBytes(32).toString('base64url');
  sessions.set(sid, Date.now() + SESSION_TTL_MS);
  return sid;
}

export function isValidSession(sid: string | undefined): boolean {
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(sid);
    return false;
  }
  return true;
}

export function destroySession(sid: string): void {
  sessions.delete(sid);
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return out;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req);
  if (isValidSession(cookies.sid)) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: 'unauthorized' });
}
