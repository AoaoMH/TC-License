import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express';
import { PORT, PUBLIC_DIR } from './config';
import './db'; // 初始化 SQLite WAL 与自动迁移
import { securityHeaders } from './middleware';
import clientApi from './routes/client-api';
import adminApi from './routes/admin-api';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(securityHeaders);
app.use(express.json({ limit: '64kb' }));

// 健康检查端点 (供 Docker / 1Panel / 负载均衡探测)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy', ts: Math.floor(Date.now() / 1000) });
});

// 挂载客户端 API (同时支持 /api/* 与 /api/v1/*)
app.use('/api', clientApi);
app.use('/api/v1', clientApi);

// 挂载管理端 API 与登录/登出路由
app.use('/admin', adminApi);

// 托管现代前端构建产物 (dist/public)
const spaIndex = path.join(PUBLIC_DIR, 'index.html');
app.use('/admin', express.static(PUBLIC_DIR, { index: false }));

app.get(['/admin', '/admin/login', '/admin/*'], (req: Request, res: Response) => {
  if (req.path.startsWith('/admin/api/')) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  if (fs.existsSync(spaIndex)) {
    res.sendFile(spaIndex);
    return;
  }
  res.status(503).send('Frontend assets not built. Please run `npm run build` first.');
});

app.get('/', (_req: Request, res: Response) => {
  res.redirect('/admin');
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

const server = app.listen(PORT, () => {
  console.log(`[server] License Server v3 listening on http://0.0.0.0:${PORT}`);
});

// 优雅停机
function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, shutting down gracefully...`);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
