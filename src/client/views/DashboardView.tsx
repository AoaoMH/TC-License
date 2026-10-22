import React, { useEffect, useState } from 'react';
import { adminFetch, fmtRelative, fmtTime } from '../api';
import { DashboardStats, Product } from '../../shared/types';
import { Badge, Button, EmptyState, PageHeader } from '../components/ui';
import { Icon, IconName } from '../components/Icon';
import { useDialog } from '../components/dialogs';

interface Props {
  products: Product[];
  onRefreshProducts: () => void;
  showToast: (msg: string, isErr?: boolean) => void;
}

export const DashboardView: React.FC<Props> = ({ products, onRefreshProducts, showToast }) => {
  const dialog = useDialog();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [onlineList, setOnlineList] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  const loadStats = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await adminFetch('/stats');
      if (res.ok) {
        setStats(res.stats);
        setOnlineList(res.online_list || []);
        setUpdatedAt(Math.floor(Date.now() / 1000));
      }
    } catch (e: any) {
      showToast(e.message || '加载统计失败', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    const timer = setInterval(() => loadStats(true), 15000);
    return () => clearInterval(timer);
  }, []);

  const kickDevice = async (codeId: number, machineId: string, codeStr: string) => {
    const ok = await dialog.confirm({
      title: '踢下线该设备？',
      message: `设备 ${machineId.slice(0, 12)}… 将在下次心跳时收到停止指令。\n卡密：${codeStr}`,
      confirmText: '踢下线',
      tone: 'danger',
      icon: 'power',
    });
    if (!ok) return;
    const res = await adminFetch(`/codes/${codeId}/kick`, { body: { machine_id: machineId } });
    if (res.ok) {
      showToast('已发送踢下线指令');
      loadStats(true);
    } else {
      showToast(res.error || '操作失败', true);
    }
  };

  const statItems: Array<{ label: string; val: number; sub: string; icon: IconName; tone: string }> = [
    { label: '卡密总数', val: stats?.total ?? 0, sub: '全部签发记录', icon: 'key', tone: 'accent' },
    { label: '待激活库存', val: stats?.unused ?? 0, sub: '尚未首次激活', icon: 'ticket', tone: 'muted' },
    { label: '有效激活中', val: stats?.active ?? 0, sub: '未过期且未吊销', icon: 'check-circle', tone: 'green' },
    { label: '实时在线设备', val: stats?.online_devices ?? 0, sub: '最近 3 分钟有心跳', icon: 'wifi', tone: 'yellow' },
    { label: '试用卡发放', val: stats?.trial_count ?? 0, sub: '免费体验记录', icon: 'gift', tone: 'cyan' },
    { label: '过期 / 吊销', val: (stats?.expired ?? 0) + (stats?.revoked ?? 0), sub: '已失效卡密', icon: 'x-circle', tone: 'red' },
    { label: '黑名单封禁', val: stats?.blacklisted ?? 0, sub: '被拒绝的机器码', icon: 'shield-ban', tone: 'red' },
  ];

  return (
    <div>
      <PageHeader
        icon="activity"
        title="运行仪表盘"
        subtitle="多项目卡密状态、实时心跳在线设备与产品运行概览，每 15 秒自动刷新。"
        actions={
          <>
            <span className="muted fs-12">{updatedAt ? `更新于 ${fmtTime(updatedAt)}` : '正在同步…'}</span>
            <Button
              icon="refresh"
              loading={loading}
              onClick={() => {
                loadStats();
                onRefreshProducts();
              }}
            >
              刷新数据
            </Button>
          </>
        }
      />

      <div className="cards">
        {statItems.map(it => (
          <div key={it.label} className={`card tone-${it.tone}`}>
            <div className="k">
              <Icon name={it.icon} size={13} />
              {it.label}
            </div>
            <div className="v">{it.val}</div>
            <div className="s">{it.sub}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-icon">
            <Icon name="wifi" size={15} />
          </div>
          <div>
            <h3>实时在线设备</h3>
            <div className="panel-head-sub">最近 3 分钟有心跳的绑定会话</div>
          </div>
          <div className="spacer" />
          <Badge tone={(stats?.online_devices ?? 0) > 0 ? 'success' : 'neutral'} dot>
            {stats?.online_devices ?? 0} 台在线
          </Badge>
        </div>

        {onlineList.length === 0 ? (
          <EmptyState icon="wifi" title="暂无实时在线设备" description="客户端启动并成功校验后会出现在这里。" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>产品 / 卡密</th>
                  <th>机器码</th>
                  <th>设备</th>
                  <th>最近心跳</th>
                  <th>IP</th>
                  <th>到期时间</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {onlineList.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div className="cell-main">{item.product_name}</div>
                      <div className="cell-sub mono">{item.code}</div>
                    </td>
                    <td>
                      <span className="mono" title={item.machine_id}>
                        {item.machine_id.slice(0, 14)}…
                      </span>
                    </td>
                    <td>{item.device_name || <span className="muted">—</span>}</td>
                    <td>
                      <div className="cell-main">
                        <span className="dot on" /> {fmtRelative(item.last_seen_at)}
                      </div>
                      <div className="cell-sub mono">{fmtTime(item.last_seen_at)}</div>
                    </td>
                    <td className="mono muted">{item.ip || '—'}</td>
                    <td>{item.expires_at ? fmtTime(item.expires_at) : <span className="muted">永久</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="power"
                        onClick={() => kickDevice(item.code_id, item.machine_id, item.code)}
                      >
                        踢下线
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-icon">
            <Icon name="package" size={15} />
          </div>
          <div>
            <h3>产品运行概览</h3>
            <div className="panel-head-sub">共 {products.length} 个产品</div>
          </div>
        </div>

        {products.length === 0 ? (
          <EmptyState
            icon="package"
            title="尚未创建任何产品"
            description="前往「产品与策略」创建第一个产品后即可签发卡密。"
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>产品</th>
                  <th>状态</th>
                  <th>版本</th>
                  <th>卡密</th>
                  <th>已激活</th>
                  <th>在线</th>
                  <th>自助换绑</th>
                  <th>免费试用</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-main">{p.name}</div>
                      <div className="cell-sub mono">{p.slug}</div>
                    </td>
                    <td>
                      <Badge tone={p.status === 'active' ? 'success' : p.status === 'maintenance' ? 'warning' : 'neutral'} dot>
                        {p.status === 'active' ? '正常服务' : p.status === 'maintenance' ? '维护中' : '已停用'}
                      </Badge>
                    </td>
                    <td className="mono">v{p.version}</td>
                    <td>{p.code_count ?? 0}</td>
                    <td>{p.active_count ?? 0}</td>
                    <td>
                      <span className={`dot ${(p.online_count ?? 0) > 0 ? 'on' : 'off'}`} />
                      {p.online_count ?? 0}
                    </td>
                    <td>
                      {p.allow_unbind ? (
                        <span>开启 · 冷却 {Math.round(p.unbind_cooldown_sec / 3600)}h</span>
                      ) : (
                        <span className="muted">关闭</span>
                      )}
                    </td>
                    <td>
                      {p.trial_enabled ? (
                        <span>开启 · {Math.round(p.trial_duration_sec / 60)} 分钟</span>
                      ) : (
                        <span className="muted">关闭</span>
                      )}
                    </td>
                    <td className="muted">{fmtTime(p.created_at)}</td>
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
