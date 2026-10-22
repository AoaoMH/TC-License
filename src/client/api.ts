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

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** 紧凑时间 → “10/22 20:07”，用于表格副行 */
export function fmtCompact(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

/** 过去时间 → “刚刚 / 5 分钟前 / 3 小时前 / 2 天前” */
export function fmtRelative(ts: number | null | undefined, now = Math.floor(Date.now() / 1000)): string {
  if (!ts) return '—';
  const diff = now - ts;
  if (diff < 0) return fmtTime(ts);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(ts);
}

/** 未来时间 → “剩余 12 天 / 剩余 3 小时 / 已过期” */
export function fmtRemaining(ts: number | null | undefined, now = Math.floor(Date.now() / 1000)): string {
  if (!ts) return '永久';
  const diff = ts - now;
  if (diff <= 0) return '已过期';
  if (diff < 3600) return `剩余 ${Math.max(1, Math.floor(diff / 60))} 分钟`;
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return m > 0 && h < 6 ? `剩余 ${h} 小时 ${m} 分` : `剩余 ${h} 小时`;
  }
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return h > 0 && d < 3 ? `剩余 ${d} 天 ${h} 小时` : `剩余 ${d} 天`;
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
