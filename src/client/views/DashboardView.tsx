import React, { useEffect, useState } from 'react';
import { adminFetch, fmtTime } from '../api';
import { DashboardStats, Product } from '../../shared/types';

interface Props {
  products: Product[];
  onRefreshProducts: () => void;
  showToast: (msg: string, isErr?: boolean) => void;
}

export const DashboardView: React.FC<Props> = ({ products, onRefreshProducts, showToast }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [onlineList, setOnlineList] = useState<Array<any>>([]);

  const loadStats = async () => {
    try {
      const res = await adminFetch('/stats');
      if (res.ok) {
        setStats(res.stats);
        setOnlineList(res.online_list || []);
      }
    } catch (e: any) {
      showToast(e.message || '加载统计失败', true);
    }
  };

  useEffect(() => {
    loadStats();
    const timer = setInterval(loadStats, 15000);
    return () => clearInterval(timer);
  }, []);

  const kickDevice = async (codeId: number, machineId: string, codeStr: string) => {
    if (!confirm(`确认踢下线设备 ${machineId.slice(0, 10)}… (卡密: ${codeStr})？\n该设备将在下次心跳时收到停止指令。`)) return;
    const res = await adminFetch(`/codes/${codeId}/kick`, { body: { machine_id: machineId } });
    if (res.ok) {
      showToast('已发送踢下线指令');
      loadStats();
    } else {
      showToast(res.error || '操作失败', true);
    }
  };

  const statItems: Array<{ label: string; val: number; cls: string }> = [
    { label: '卡密总数', val: stats?.total ?? 0, cls: 'accent' },
    { label: '待激活库存', val: stats?.unused ?? 0, cls: '' },
    { label: '有效激活中', val: stats?.active ?? 0, cls: 'green' },
    { label: '实时在线设备', val: stats?.online_devices ?? 0, cls: 'yellow' },
    { label: '试用卡发放', val: stats?.trial_count ?? 0, cls: 'cyan' },
    { label: '已过期 / 已吊销', val: (stats?.expired ?? 0) + (stats?.revoked ?? 0), cls: 'red' },
    { label: '黑名单封禁', val: stats?.blacklisted ?? 0, cls: 'red' },
  ];

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>运行仪表盘</h1>
          <div className="sub">多项目卡密状态、实时心跳在线设备与产品概览</div>
        </div>
        <button className="btn" onClick={() => { loadStats(); onRefreshProducts(); }}>
          刷新数据
        </button>
      </div>

      <div className="cards">
        {statItems.map((it, idx) => (
          <div key={idx} className={`card ${it.cls}`}>
            <div className="num">{it.val}</div>
            <div className="lbl">{it.label}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>实时在线设备监控 (最近 3 分钟有心跳)</h2>
          <span className="muted" style={{ fontSize: 12 }}>每 15 秒自动刷新</span>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>产品</th>
                <th>卡密</th>
                <th>机器码 (Machine ID)</th>
                <th>设备信息</th>
                <th>最近心跳</th>
                <th>IP 地址</th>
                <th>到期时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {onlineList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    暂无实时在线设备
                  </td>
                </tr>
              ) : (
                onlineList.map(item => (
                  <tr key={item.id}>
                    <td>{item.product_name} (<code>{item.product_slug}</code>)</td>
                    <td><code>{item.code}</code></td>
                    <td><code title={item.machine_id}>{item.machine_id.slice(0, 12)}…</code></td>
                    <td>{item.device_name || <span className="muted">-</span>}</td>
                    <td><span className="dot on"></span>{fmtTime(item.last_seen_at)}</td>
                    <td className="muted">{item.ip || '-'}</td>
                    <td>{item.expires_at ? fmtTime(item.expires_at) : <span className="muted">永久</span>}</td>
                    <td>
                      <button
                        className="btn sm danger"
                        onClick={() => kickDevice(item.code_id, item.machine_id, item.code)}
                      >
                        踢下线
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>产品运行概览</h2>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>产品名称</th>
                <th>Slug 标识</th>
                <th>状态</th>
                <th>当前版本</th>
                <th>卡密总数</th>
                <th>已激活</th>
                <th>在线设备</th>
                <th>自助换绑</th>
                <th>免费试用</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    尚未创建任何产品，请前往「产品与策略」创建
                  </td>
                </tr>
              ) : (
                products.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td><code>{p.slug}</code></td>
                    <td>
                      <span className={`tag ${p.status}`}>
                        {p.status === 'active' ? '正常服务' : p.status === 'maintenance' ? '维护中' : '已停用'}
                      </span>
                    </td>
                    <td><code>v{p.version}</code></td>
                    <td>{p.code_count ?? 0}</td>
                    <td>{p.active_count ?? 0}</td>
                    <td>
                      <span className={`dot ${(p.online_count ?? 0) > 0 ? 'on' : 'off'}`}></span>
                      {p.online_count ?? 0}
                    </td>
                    <td>{p.allow_unbind ? `开启 (冷却 ${Math.round(p.unbind_cooldown_sec / 3600)}h)` : <span className="muted">关闭</span>}</td>
                    <td>{p.trial_enabled ? `开启 (${Math.round(p.trial_duration_sec / 60)}分钟)` : <span className="muted">关闭</span>}</td>
                    <td className="muted">{fmtTime(p.created_at)}</td>
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
