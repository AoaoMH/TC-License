import React, { useEffect, useState } from 'react';
import { adminFetch, fmtTime } from '../api';
import { BlacklistEntry, Product } from '../../shared/types';

interface Props {
  products: Product[];
  showToast: (msg: string, isErr?: boolean) => void;
}

export const BlacklistView: React.FC<Props> = ({ products, showToast }) => {
  const [list, setList] = useState<BlacklistEntry[]>([]);
  const [machineId, setMachineId] = useState('');
  const [productId, setProductId] = useState('');
  const [reason, setReason] = useState('');

  const loadBlacklist = async () => {
    try {
      const res = await adminFetch('/blacklist');
      if (res.ok) setList(res.blacklist || []);
    } catch (e: any) {
      showToast(e.message || '加载失败', true);
    }
  };

  useEffect(() => {
    loadBlacklist();
  }, []);

  const addBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId.trim()) return;
    const res = await adminFetch('/blacklist', {
      body: {
        machine_id: machineId.trim(),
        product_id: productId ? Number(productId) : null,
        reason: reason.trim(),
      },
    });
    if (res.ok) {
      showToast('已加入机器码黑名单并触发踢下线');
      setMachineId('');
      setReason('');
      loadBlacklist();
    } else {
      showToast(res.error || '封禁失败', true);
    }
  };

  const removeBan = async (id: number, mid: string) => {
    if (!confirm(`确认解除机器码 ${mid} 的封禁？`)) return;
    const res = await adminFetch(`/blacklist/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('已解除封禁');
      loadBlacklist();
    } else {
      showToast(res.error || '操作失败', true);
    }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>机器码黑名单 (Ban List)</h1>
          <div className="sub">封禁恶意破解、抓包或违规共享的硬件机器码，支持全局封禁或单产品封禁</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>新增封禁机器码</h2>
        </div>
        <form className="row" onSubmit={addBan}>
          <input
            required
            placeholder="输入要封禁的 Machine ID (机器码)"
            style={{ width: 280 }}
            value={machineId}
            onChange={e => setMachineId(e.target.value)}
          />
          <select value={productId} onChange={e => setProductId(e.target.value)}>
            <option value="">全局封禁 (所有产品均拒绝)</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>仅封禁：{p.name} ({p.slug})</option>
            ))}
          </select>
          <input
            placeholder="封禁原因 (如：恶意逆向/多开倒卖)"
            style={{ width: 240 }}
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          <button type="submit" className="btn danger">
            立即封禁并踢下线
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>已封禁设备列表 ({list.length})</h2>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>机器码 (Machine ID)</th>
                <th>封禁范围</th>
                <th>原因</th>
                <th>封禁时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                    黑名单为空
                  </td>
                </tr>
              ) : (
                list.map(b => (
                  <tr key={b.id}>
                    <td>{b.id}</td>
                    <td><code>{b.machine_id}</code></td>
                    <td>
                      {b.product_id ? (
                        <span>{b.product_name} (<code>{b.product_slug}</code>)</span>
                      ) : (
                        <span className="tag revoked">全局封禁</span>
                      )}
                    </td>
                    <td>{b.reason || <span className="muted">-</span>}</td>
                    <td className="muted">{fmtTime(b.created_at)}</td>
                    <td>
                      <button className="btn sm" onClick={() => removeBan(b.id, b.machine_id)}>
                        解除封禁
                      </button>
                    </td>
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
