import React, { useState } from 'react';
import { adminFetch } from '../api';
import { Product } from '../../shared/types';

interface Props {
  products: Product[];
  onRefresh: () => void;
  showToast: (msg: string, isErr?: boolean) => void;
  showModal: (title: string, content: string) => void;
}

const DEFAULT_FORM = {
  id: 0,
  name: '',
  slug: '',
  status: 'active',
  version: '1.0.0',
  min_version: '1.0.0',
  code_prefix: '',
  max_devices: 1,
  heartbeat_interval: 60,
  allow_unbind: true,
  unbind_cooldown_hours: 24,
  unbind_penalty_hours: 0,
  max_unbind_count: 0,
  trial_enabled: false,
  trial_duration_minutes: 60,
  announcement: '',
  custom_data: '{\n  "feature_flags": {\n    "vip_mode": true\n  }\n}',
};

export const ProductsView: React.FC<Props> = ({ products, onRefresh, showToast, showModal }) => {
  const [editing, setEditing] = useState<typeof DEFAULT_FORM | null>(null);

  const openCreate = () => {
    setEditing({ ...DEFAULT_FORM });
  };

  const openEdit = (p: Product) => {
    let formattedCustom = p.custom_data || '{}';
    try {
      formattedCustom = JSON.stringify(JSON.parse(formattedCustom), null, 2);
    } catch {
      // keep raw
    }
    setEditing({
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status || 'active',
      version: p.version || '1.0.0',
      min_version: p.min_version || '1.0.0',
      code_prefix: p.code_prefix || '',
      max_devices: p.max_devices || 1,
      heartbeat_interval: p.heartbeat_interval || 60,
      allow_unbind: Boolean(p.allow_unbind),
      unbind_cooldown_hours: Math.round((p.unbind_cooldown_sec || 0) / 3600),
      unbind_penalty_hours: Math.round((p.unbind_penalty_sec || 0) / 3600),
      max_unbind_count: p.max_unbind_count || 0,
      trial_enabled: Boolean(p.trial_enabled),
      trial_duration_minutes: Math.round((p.trial_duration_sec || 3600) / 60),
      announcement: p.announcement || '',
      custom_data: formattedCustom,
    });
  };

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    const payload = {
      name: editing.name.trim(),
      slug: editing.slug.trim().toLowerCase(),
      status: editing.status,
      version: editing.version.trim(),
      min_version: editing.min_version.trim(),
      code_prefix: editing.code_prefix.trim().toUpperCase(),
      max_devices: Number(editing.max_devices) || 1,
      heartbeat_interval: Number(editing.heartbeat_interval) || 60,
      allow_unbind: editing.allow_unbind ? 1 : 0,
      unbind_cooldown_sec: Math.round((Number(editing.unbind_cooldown_hours) || 0) * 3600),
      unbind_penalty_sec: Math.round((Number(editing.unbind_penalty_hours) || 0) * 3600),
      max_unbind_count: Number(editing.max_unbind_count) || 0,
      trial_enabled: editing.trial_enabled ? 1 : 0,
      trial_duration_sec: Math.round((Number(editing.trial_duration_minutes) || 60) * 60),
      announcement: editing.announcement,
      custom_data: editing.custom_data,
    };

    try {
      const res = editing.id
        ? await adminFetch(`/products/${editing.id}`, { method: 'PUT', body: payload })
        : await adminFetch('/products', { method: 'POST', body: payload });

      if (res.ok) {
        showToast(editing.id ? '产品配置已保存' : '产品已创建并生成密钥对');
        setEditing(null);
        onRefresh();
      } else {
        showToast(res.error || '保存失败', true);
      }
    } catch (err: any) {
      showToast(err.message || '请求异常', true);
    }
  };

  const viewPubkey = async (p: Product) => {
    const res = await adminFetch(`/products/${p.id}/pubkey`);
    if (res.ok) {
      showModal(`产品 Ed25519 公钥 (${p.slug}) — 内嵌到客户端用于离线验签`, res.pem);
    }
  };

  const compensateProduct = async (p: Product) => {
    const hoursStr = prompt(`为「${p.name}」所有有效激活中的卡密统一补偿增加多少小时？（可输入小数或24的倍数）：`, '24');
    if (!hoursStr) return;
    const hours = parseFloat(hoursStr);
    if (!Number.isFinite(hours) || hours <= 0) {
      showToast('请输入有效的小时数', true);
      return;
    }
    const res = await adminFetch(`/products/${p.id}/compensate`, { body: { hours } });
    if (res.ok) {
      showToast(`补偿成功！已为 ${res.affected} 张激活卡密顺延 ${hours} 小时`);
      onRefresh();
    } else {
      showToast(res.error || '补偿失败', true);
    }
  };

  const deleteProduct = async (p: Product) => {
    const hasCodes = (p.code_count || 0) > 0;
    const msg = hasCodes
      ? `产品「${p.name}」下包含 ${p.code_count} 张卡密！确认强制连同所有卡密一并删除吗？此操作不可恢复！`
      : `确认删除产品「${p.name}」(${p.slug})？`;
    if (!confirm(msg)) return;
    const res = await adminFetch(`/products/${p.id}${hasCodes ? '?force=1' : ''}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('产品已删除');
      onRefresh();
    } else {
      showToast(res.error || '删除失败', true);
    }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>产品与策略管理</h1>
          <div className="sub">每个产品拥有独立 Ed25519 密钥对、版本公告、激活后下发的私有 JSON 变量、换绑及免费试用策略</div>
        </div>
        <button className="btn primary" onClick={openCreate}>
          + 新建自定义产品
        </button>
      </div>

      <div className="panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>产品名称 / Slug</th>
                <th>状态</th>
                <th>版本 (最新 / 最低)</th>
                <th>默认前缀</th>
                <th>设备上限</th>
                <th>换绑策略</th>
                <th>免费试用</th>
                <th>卡密 (激活/总数)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                    暂无产品，点击右上角「新建自定义产品」开始
                  </td>
                </tr>
              ) : (
                products.map(p => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <code>{p.slug}</code>
                    </td>
                    <td>
                      <span className={`tag ${p.status}`}>
                        {p.status === 'active' ? '正常' : p.status === 'maintenance' ? '维护' : '停服'}
                      </span>
                    </td>
                    <td>
                      <code>{p.version}</code> / <span className="muted">min {p.min_version}</span>
                    </td>
                    <td>{p.code_prefix ? <code>{p.code_prefix}-</code> : <span className="muted">无</span>}</td>
                    <td>{p.max_devices} 台/码</td>
                    <td>
                      {p.allow_unbind ? (
                        <span>
                          冷却 {Math.round(p.unbind_cooldown_sec / 3600)}h
                          {p.unbind_penalty_sec > 0 ? ` / 扣 ${Math.round(p.unbind_penalty_sec / 3600)}h` : ''}
                          {p.max_unbind_count > 0 ? ` / 限 ${p.max_unbind_count}次` : ''}
                        </span>
                      ) : (
                        <span className="muted">禁止换绑</span>
                      )}
                    </td>
                    <td>
                      {p.trial_enabled ? (
                        <span className="tag trial">{Math.round(p.trial_duration_sec / 60)} 分钟</span>
                      ) : (
                        <span className="muted">关闭</span>
                      )}
                    </td>
                    <td>
                      <strong style={{ color: 'var(--green)' }}>{p.active_count || 0}</strong> / {p.code_count || 0}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn sm" onClick={() => openEdit(p)}>配置策略</button>
                        <button className="btn sm" onClick={() => viewPubkey(p)}>公钥</button>
                        <button className="btn sm success" onClick={() => compensateProduct(p)}>全服加时</button>
                        <button className="btn sm danger" onClick={() => deleteProduct(p)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="mask" onClick={() => setEditing(null)}>
          <form className="modal" style={{ width: 760 }} onClick={e => e.stopPropagation()} onSubmit={saveProduct}>
            <h3>{editing.id ? `编辑产品策略 — ${editing.name} (${editing.slug})` : '新建自定义产品'}</h3>

            <div className="grid-form" style={{ marginBottom: 14 }}>
              <div className="field">
                <label>产品名称 *</label>
                <input
                  required
                  placeholder="如：Neon Abyss 2 增强 Mod"
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>产品唯一标识 Slug * (小写字母/数字/横线)</label>
                <input
                  required
                  disabled={Boolean(editing.id)}
                  placeholder="如：neona2-tweaks"
                  value={editing.slug}
                  onChange={e => setEditing({ ...editing, slug: e.target.value })}
                />
              </div>
              <div className="field">
                <label>运行状态</label>
                <select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })}>
                  <option value="active">正常服务 (Active)</option>
                  <option value="maintenance">停机维护 (Maintenance - 拒绝验证并提示公告)</option>
                  <option value="disabled">已停用 (Disabled)</option>
                </select>
              </div>
              <div className="field">
                <label>默认卡密前缀 (可选，如 VIP)</label>
                <input
                  placeholder="留空则生成纯 16 位卡密"
                  maxLength={8}
                  value={editing.code_prefix}
                  onChange={e => setEditing({ ...editing, code_prefix: e.target.value })}
                />
              </div>
              <div className="field">
                <label>最新版本号</label>
                <input
                  value={editing.version}
                  onChange={e => setEditing({ ...editing, version: e.target.value })}
                />
              </div>
              <div className="field">
                <label>最低兼容版本号 (低于此版本提示强更)</label>
                <input
                  value={editing.min_version}
                  onChange={e => setEditing({ ...editing, min_version: e.target.value })}
                />
              </div>
              <div className="field">
                <label>单码最大同时绑定设备数</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={editing.max_devices}
                  onChange={e => setEditing({ ...editing, max_devices: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>建议客户端心跳间隔 (秒)</label>
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={editing.heartbeat_interval}
                  onChange={e => setEditing({ ...editing, heartbeat_interval: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="panel" style={{ padding: 14, marginBottom: 14, background: 'var(--bg)' }}>
              <h2 style={{ marginBottom: 10 }}>客户端自助换绑 & 免费试用策略</h2>
              <div className="grid-form">
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
                    <input
                      type="checkbox"
                      checked={editing.allow_unbind}
                      onChange={e => setEditing({ ...editing, allow_unbind: e.target.checked })}
                    />
                    允许客户端调用 /api/unbind 自助换绑
                  </label>
                </div>
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
                    <input
                      type="checkbox"
                      checked={editing.trial_enabled}
                      onChange={e => setEditing({ ...editing, trial_enabled: e.target.checked })}
                    />
                    开启新机器码免费试用 (/api/trial)
                  </label>
                </div>
                <div className="field">
                  <label>换绑冷却时间 (小时)</label>
                  <input
                    type="number"
                    min={0}
                    value={editing.unbind_cooldown_hours}
                    onChange={e => setEditing({ ...editing, unbind_cooldown_hours: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>每次换绑扣除有效期 (小时，0=不扣时)</label>
                  <input
                    type="number"
                    min={0}
                    value={editing.unbind_penalty_hours}
                    onChange={e => setEditing({ ...editing, unbind_penalty_hours: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>最大自助换绑次数 (0=不限次数)</label>
                  <input
                    type="number"
                    min={0}
                    value={editing.max_unbind_count}
                    onChange={e => setEditing({ ...editing, max_unbind_count: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>免费试用时长 (分钟)</label>
                  <input
                    type="number"
                    min={1}
                    value={editing.trial_duration_minutes}
                    onChange={e => setEditing({ ...editing, trial_duration_minutes: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <label>项目公告 (客户端初始化 / 激活 / 心跳时同步下发)</label>
              <textarea
                rows={2}
                placeholder="可选：填写版本更新说明、维护通知或群号..."
                value={editing.announcement}
                onChange={e => setEditing({ ...editing, announcement: e.target.value })}
              />
            </div>

            <div className="field">
              <label>私有远程配置 / 加密变量 (JSON 格式，仅在卡密激活或 Verify 验签通过后下发，防静态逆向)</label>
              <textarea
                rows={4}
                value={editing.custom_data}
                onChange={e => setEditing({ ...editing, custom_data: e.target.value })}
              />
            </div>

            <div className="foot">
              <button type="button" className="btn" onClick={() => setEditing(null)}>取消</button>
              <button type="submit" className="btn primary">保存配置</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
