// 前端 API 请求封装与时间/时长格式化工具

export async function adminFetch<T = any>(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch('/admin/api' + path, {
    method: options?.method || (options?.body !== undefined ? 'POST' : 'GET'),
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('admin:unauthorized'));
    throw new Error('登录已过期，请重新登录');
  }

  const data = await res.json();
  return data as T;
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}

export function fmtDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '永久';
  if (sec % 86400 === 0) return `${sec / 86400} 天`;
  if (sec % 3600 === 0) return `${sec / 3600} 小时`;
  if (sec >= 86400) {
    const d = Math.floor(sec / 86400);
    const h = Math.round((sec % 86400) / 3600);
    return h > 0 ? `${d}天${h}小时` : `${d} 天`;
  }
  return `${Math.round(sec / 60)} 分钟`;
}
