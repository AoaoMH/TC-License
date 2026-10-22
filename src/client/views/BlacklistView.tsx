import React, { useEffect, useMemo, useState } from 'react';
import { adminFetch, fmtRelative, fmtTime } from '../api';
import { BlacklistEntry, Product } from '../../shared/types';
import { Badge, Button, EmptyState, Field, IconButton, Input, PageHeader, Select, copyText } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDialog } from '../components/dialogs';

interface Props {
  products: Product[];
  showToast: (msg: string, isErr?: boolean) => void;
}

const REASONS = ['恶意破解 / 逆向', '多人共享账号', '异常多开', '违规转售', '恶意退款', '抓包篡改'];

export const BlacklistView: React.FC<Props> = ({ products, showToast }) => {
  const dialog = useDialog();
  const [list, setList] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [machineId, setMachineId] = useState('');
  const [productId, setProductId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');

  const loadBlacklist = async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/blacklist');
      if (res.ok) setList(res.blacklist || []);
    } catch (e: any) {
      showToast(e.message || '加载失败', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBlacklist();
  }, []);

  const addBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId.trim()) return;
    setSubmitting(true);
    try {
      const res = await adminFetch('/blacklist', {
        body: {
          machine_id: machineId.trim(),
          product_id: productId ? Number(productId) : null,
          reason: reason.trim(),
        },
      });
      if (res.ok) {
        showToast('已加入机器码黑名单，并已触发该设备下线');
        setMachineId('');
        setReason('');
        loadBlacklist();
      } else {
        showToast(res.error || '封禁失败', true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const removeBan = async (entry: BlacklistEntry) => {
    const ok = await dialog.confirm({
      title: '解除该机器码封禁？',
      message: `机器码 ${entry.machine_id} 将恢复访问${entry.product_id ? `「${entry.product_name}」` : '所有产品'}的权限。`,
      confirmText: '解除封禁',
      tone: 'warning',
      icon: 'restore',
    });
    if (!ok) return;
    const res = await adminFetch(`/blacklist/${entry.id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('已解除封禁');
      loadBlacklist();
    } else {
      showToast(res.error || '操作失败', true);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      b =>
        b.machine_id.toLowerCase().includes(q) ||
        (b.reason || '').toLowerCase().includes(q) ||
        (b.product_name || '').toLowerCase().includes(q)
    );
  }, [list, query]);

  const productOptions = [
    { value: '', label: '全局封禁', hint: '所有产品均拒绝该机器码' },
    ...products.map(p => ({ value: String(p.id), label: p.name, hint: p.slug })),
  ];

  return (
    <div>
      <PageHeader
        icon="shield-ban"
        title="机器码黑名单"
        subtitle="封禁恶意破解、抓包或违规共享的硬件机器码。支持全局封禁或仅限单个产品，封禁后立即触发设备下线。"
        actions={
          <>
            <Button icon="refresh" onClick={loadBlacklist} loading={loading}>
              刷新
            </Button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-icon">
            <Icon name="ban" size={15} />
          </div>
          <div>
            <h3>新增封禁</h3>
            <div className="panel-head-sub">机器码可在「激活码管理 → 设备」中直接获取，也支持从客户端日志复制</div>
          </div>
        </div>
        <form className="panel-body" onSubmit={addBan}>
          <div className="form-grid">
            <Field label="机器码" required className="span-2" hint="回车确认，支持粘贴完整 Machine ID">
              <Input
                required
                icon="cpu"
                placeholder="例如 5cd303a1f7ed90b5226823baae76af08"
                value={machineId}
                onChange={e => setMachineId(e.target.value)}
              />
            </Field>
            <Field label="封禁范围" hint="按产品封禁只影响单个产品，全局封禁拒绝所有产品">
              <Select value={productId} onChange={setProductId} options={productOptions} />
            </Field>
            <Field label="封禁原因" hint="原因会展示在审计日志中，便于后续追溯">
              <Input
                icon="edit"
                placeholder="例如：恶意逆向 / 多开倒卖"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </Field>
            <div className="quick-chips span-2">
              {REASONS.map(r => (
                <button key={r} type="button" className="quick-chip" onClick={() => setReason(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <span className="muted fs-12">
              <Icon name="info" size={13} /> 封禁会立即踢下线，并阻止该机器码后续激活 / 心跳
            </span>
            <Button type="submit" variant="danger" icon="ban" loading={submitting} disabled={!machineId.trim()}>
              立即封禁
            </Button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>已封禁设备</h3>
            <div className="panel-head-sub">共 {list.length} 条记录</div>
          </div>
          <div className="spacer" />
          <div className="filter-search">
            <Input
              icon="search"
              placeholder="搜索机器码 / 原因 / 产品…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon="shield-ban"
            title={list.length === 0 ? '黑名单为空' : '没有匹配的记录'}
            description={list.length === 0 ? '被封禁的机器码会出现在这里，可随时解除。' : '试试更换关键词，或清空搜索条件。'}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>机器码</th>
                  <th>封禁范围</th>
                  <th>原因</th>
                  <th>封禁时间</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => (
                  <tr key={b.id}>
                    <td>
                      <div className="mono-cell">
                        <span className="mono">{b.machine_id}</span>
                        <IconButton
                          icon="copy"
                          label="复制机器码"
                          size="xs"
                          onClick={async () => {
                            const ok = await copyText(b.machine_id);
                            showToast(ok ? '机器码已复制' : '复制失败', !ok);
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      {b.product_id ? (
                        <div className="cell-main">
                          {b.product_name}
                          <div className="cell-sub mono">{b.product_slug}</div>
                        </div>
                      ) : (
                        <Badge tone="danger" dot>
                          全局封禁
                        </Badge>
                      )}
                    </td>
                    <td>{b.reason ? <span className="text-2">{b.reason}</span> : <span className="muted">—</span>}</td>
                    <td>
                      <div className="cell-main">{fmtRelative(b.created_at)}</div>
                      <div className="cell-sub mono">{fmtTime(b.created_at)}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Button size="sm" variant="ghost" icon="restore" onClick={() => removeBan(b)}>
                        解除
                      </Button>
                    </td>
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
