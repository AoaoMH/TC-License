import React, { useEffect, useState } from 'react';
import { adminFetch, fmtTime } from '../api';
import { AuditLog, Product } from '../../shared/types';
import { Badge, Button, EmptyState, Input, PageHeader, Select } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDialog } from '../components/dialogs';

interface Props {
  products: Product[];
  showToast: (msg: string, isErr?: boolean) => void;
}

const toneFor = (action: string): 'success' | 'danger' | 'warning' | 'accent' | 'neutral' | 'info' => {
  const a = action.toLowerCase();
  if (a.includes('fail') || a.includes('error') || a.includes('deny') || a.includes('mismatch')) return 'danger';
  if (a.includes('revoke') || a.includes('ban') || a.includes('blacklist')) return 'danger';
  if (a.includes('unbind') || a.includes('kick') || a.includes('reset')) return 'warning';
  if (a.includes('activate') || a.includes('success') || a.includes('login')) return 'success';
  if (a.includes('trial')) return 'info';
  if (a.includes('admin') || a.includes('generate') || a.includes('extend')) return 'accent';
  return 'neutral';
};

export const LogsView: React.FC<Props> = ({ products, showToast }) => {
  const dialog = useDialog();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [productId, setProductId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '300' });
    if (productId) p.set('product_id', productId);
    if (query.trim()) p.set('q', query.trim());
    try {
      const res = await adminFetch('/logs?' + p.toString());
      if (res.ok) setLogs(res.logs || []);
    } catch (e: any) {
      showToast(e.message || '日志加载失败', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [productId]);

  const clearLogs = async (beforeDays: number) => {
    const ok = await dialog.confirm({
      title: beforeDays > 0 ? `清理 ${beforeDays} 天前的日志？` : '清空全部审计日志？',
      message:
        beforeDays > 0
          ? `早于 ${beforeDays} 天的历史记录将被永久删除，此操作不可撤销。`
          : '所有审计日志将被永久删除，无法恢复。建议先导出留档。',
      confirmText: beforeDays > 0 ? '清理历史日志' : '清空全部',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    const res = await adminFetch(`/logs?before_days=${beforeDays}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('日志已清理');
      loadLogs();
    } else {
      showToast(res.error || '清理失败', true);
    }
  };

  const productOptions = [
    { value: '', label: '全部产品' },
    ...products.map(p => ({ value: String(p.id), label: p.name, hint: p.slug })),
  ];

  return (
    <div>
      <PageHeader
        icon="scroll"
        title="安全与审计日志"
        subtitle="记录激活、验签异常、换绑、免费试用与后台管理操作；高频正常心跳不落库，避免刷库。"
        actions={
          <>
            <Button icon="clock" variant="ghost" onClick={() => clearLogs(30)}>
              清理 30 天前
            </Button>
            <Button icon="trash" variant="danger" onClick={() => clearLogs(0)}>
              清空全部
            </Button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-icon">
            <Icon name="list" size={15} />
          </div>
          <div>
            <h3>日志列表</h3>
            <div className="panel-head-sub">最多展示最近 300 条 · 当前 {logs.length} 条</div>
          </div>
        </div>

        <div className="filter-bar">
          <Select value={productId} onChange={setProductId} options={productOptions} minWidth={160} />
          <div className="search">
            <Input
              icon="search"
              placeholder="搜索 卡密 / 机器码 / 动作 / IP…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadLogs()}
            />
            <Button size="sm" icon="search" onClick={loadLogs} loading={loading}>
              筛选
            </Button>
          </div>
        </div>

        {logs.length === 0 ? (
          <EmptyState icon="scroll" title="暂无日志记录" description="发生激活、换绑或后台操作后，审计事件会显示在这里。" />
        ) : (
          <div className="table-wrap table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>产品</th>
                  <th>关联卡密</th>
                  <th>机器码</th>
                  <th>详情</th>
                  <th>来源 IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td>
                      <div className="cell-main mono">{fmtTime(l.created_at)}</div>
                    </td>
                    <td>
                      <Badge tone={toneFor(l.action)} dot>
                        {l.action}
                      </Badge>
                    </td>
                    <td>{l.product_slug ? <span className="mono">{l.product_slug}</span> : <span className="muted">—</span>}</td>
                    <td>{l.code ? <span className="mono">{l.code}</span> : <span className="muted">—</span>}</td>
                    <td>
                      {l.machine_id ? (
                        <span className="mono" title={l.machine_id}>
                          {l.machine_id.slice(0, 12)}…
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted log-detail" title={l.detail || ''}>{l.detail || '—'}</td>
                    <td className="mono muted">{l.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
