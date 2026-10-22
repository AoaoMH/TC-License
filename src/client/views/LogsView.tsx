import React, { useEffect, useState } from 'react';
import { adminFetch, fmtTime } from '../api';
import { AuditLog, Product } from '../../shared/types';

interface Props {
  products: Product[];
  showToast: (msg: string, isErr?: boolean) => void;
}

export const LogsView: React.FC<Props> = ({ products, showToast }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [productId, setProductId] = useState('');
  const [query, setQuery] = useState('');

  const loadLogs = async () => {
    const p = new URLSearchParams({ limit: '300' });
    if (productId) p.set('product_id', productId);
    if (query.trim()) p.set('q', query.trim());
    try {
      const res = await adminFetch('/logs?' + p.toString());
      if (res.ok) setLogs(res.logs || []);
    } catch (e: any) {
      showToast(e.message || '日志加载失败', true);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [productId]);

  const clearLogs = async (beforeDays: number) => {
    const msg = beforeDays > 0 ? `确认清理 ${beforeDays} 天前的历史日志？` : '确认清空所有审计日志？';
    if (!confirm(msg)) return;
    const res = await adminFetch(`/logs?before_days=${beforeDays}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('日志已清理');
      loadLogs();
    }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>安全与审计日志</h1>
          <div className="sub">记录所有激活、验签异常、换绑、免费试用与后台管理操作（高频正常心跳不落库以防刷库）</div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => clearLogs(30)}>清理 30 天前日志</button>
          <button className="btn sm danger" onClick={() => clearLogs(0)}>清空全部</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>日志列表 ({logs.length})</h2>
          <div className="row">
            <select value={productId} onChange={e => setProductId(e.target.value)}>
              <option value="">全部产品</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              placeholder="搜索 卡密 / 机器码 / 动作 / IP..."
              style={{ width: 240 }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadLogs()}
            />
            <button className="btn" onClick={loadLogs}>筛选</button>
          </div>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>产品</th>
                <th>动作 (Action)</th>
                <th>关联卡密</th>
                <th>机器码 (Machine ID)</th>
                <th>详情</th>
                <th>来源 IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                    暂无日志记录
                  </td>
                </tr>
              ) : (
                logs.map(l => (
                  <tr key={l.id}>
                    <td className="muted">{fmtTime(l.created_at)}</td>
                    <td>{l.product_slug ? <code>{l.product_slug}</code> : <span className="muted">-</span>}</td>
                    <td style={{ fontWeight: 500 }}>{l.action}</td>
                    <td>{l.code ? <code>{l.code}</code> : <span className="muted">-</span>}</td>
                    <td>{l.machine_id ? <code title={l.machine_id}>{l.machine_id.slice(0, 12)}…</code> : <span className="muted">-</span>}</td>
                    <td className="muted">{l.detail || '-'}</td>
                    <td className="muted">{l.ip || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
