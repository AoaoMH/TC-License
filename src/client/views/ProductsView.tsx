import React, { useState } from 'react';
import { adminFetch } from '../api';
import { Product } from '../../shared/types';
import {
  Badge,
  Button,
  Field,
  Input,
  Menu,
  Modal,
  NumberField,
  PageHeader,
  Segmented,
  Switch,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { useDialog } from '../components/dialogs';

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

const STATUS_OPTIONS = [
  { value: 'active', label: '正常服务' },
  { value: 'maintenance', label: '停机维护' },
  { value: 'disabled', label: '已停用' },
];

export const ProductsView: React.FC<Props> = ({ products, onRefresh, showToast, showModal }) => {
  const dialog = useDialog();
  const [editing, setEditing] = useState<typeof DEFAULT_FORM | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => setEditing({ ...DEFAULT_FORM });

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

    setSaving(true);
    try {
      const res = editing.id
        ? await adminFetch(`/products/${editing.id}`, { method: 'PUT', body: payload })
        : await adminFetch('/products', { method: 'POST', body: payload });

      if (res.ok) {
        showToast(editing.id ? '产品配置已保存' : '产品已创建并生成 Ed25519 密钥对');
        setEditing(null);
        onRefresh();
      } else {
        showToast(res.error || '保存失败', true);
      }
    } catch (err: any) {
      showToast(err.message || '请求异常', true);
    } finally {
      setSaving(false);
    }
  };

  const viewPubkey = async (p: Product) => {
    const res = await adminFetch(`/products/${p.id}/pubkey`);
    if (res.ok) {
      showModal(`产品 Ed25519 公钥 · ${p.slug}`, res.pem);
    } else {
      showToast(res.error || '获取公钥失败', true);
    }
  };

  const compensateProduct = async (p: Product) => {
    const hoursStr = await dialog.prompt({
      title: `为「${p.name}」全服加时`,
      message: '该产品下所有有效激活中的卡密将统一顺延有效期。',
      label: '补偿时长（小时）',
      defaultValue: '24',
      suffix: '小时',
      confirmText: '确认加时',
      validate: v => {
        const n = parseFloat(v);
        if (!Number.isFinite(n) || n <= 0) return '请输入大于 0 的小时数';
        return null;
      },
    });
    if (!hoursStr) return;
    const hours = parseFloat(hoursStr);
    const res = await adminFetch(`/products/${p.id}/compensate`, { body: { hours } });
    if (res.ok) {
      showToast(`补偿成功，已为 ${res.affected} 张激活卡密顺延 ${hours} 小时`);
      onRefresh();
    } else {
      showToast(res.error || '补偿失败', true);
    }
  };

  const deleteProduct = async (p: Product) => {
    const hasCodes = (p.code_count || 0) > 0;
    const ok = await dialog.confirm({
      title: `删除产品「${p.name}」？`,
      message: hasCodes
        ? `该产品下仍有 ${p.code_count} 张卡密，强制删除会连同全部卡密、绑定关系与试用记录一并移除，且不可恢复。`
        : `将删除产品 ${p.slug} 及其密钥对，此操作不可恢复。`,
      confirmText: hasCodes ? '强制删除全部' : '删除产品',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    const res = await adminFetch(`/products/${p.id}${hasCodes ? '?force=1' : ''}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('产品已删除');
      onRefresh();
    } else {
      showToast(res.error || '删除失败', true);
    }
  };

  const update = (patch: Partial<typeof DEFAULT_FORM>) => {
    if (!editing) return;
    setEditing({ ...editing, ...patch });
  };

  return (
    <div>
      <PageHeader
        icon="package"
        title="产品与策略"
        subtitle="每个产品拥有独立 Ed25519 密钥对、版本公告、激活后下发的私有 JSON 变量，以及换绑与免费试用策略。"
        actions={
          <Button variant="primary" icon="plus" onClick={openCreate}>
            新建产品
          </Button>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-icon">
            <Icon name="package" size={15} />
          </div>
          <div>
            <h3>产品列表</h3>
            <div className="panel-head-sub">共 {products.length} 个产品</div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>产品</th>
                <th>状态</th>
                <th>版本</th>
                <th>前缀</th>
                <th>设备上限</th>
                <th>换绑策略</th>
                <th>免费试用</th>
                <th>卡密（激活 / 总数）</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-inline">
                      <Icon name="package" size={26} />
                      <div>
                        <b>还没有产品</b>
                        <span>点击右上角「新建产品」开始签发卡密。</span>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                products.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-main">{p.name}</div>
                      <div className="cell-sub mono">{p.slug}</div>
                    </td>
                    <td>
                      <Badge tone={p.status === 'active' ? 'success' : p.status === 'maintenance' ? 'warning' : 'neutral'} dot>
                        {p.status === 'active' ? '正常' : p.status === 'maintenance' ? '维护' : '停服'}
                      </Badge>
                    </td>
                    <td>
                      <div className="cell-main mono">{p.version}</div>
                      <div className="cell-sub">最低 {p.min_version}</div>
                    </td>
                    <td>{p.code_prefix ? <span className="mono">{p.code_prefix}-</span> : <span className="muted">无</span>}</td>
                    <td>{p.max_devices} 台/码</td>
                    <td>
                      {p.allow_unbind ? (
                        <div className="cell-main">
                          冷却 {Math.round(p.unbind_cooldown_sec / 3600)}h
                          {p.unbind_penalty_sec > 0 ? ` · 扣 ${Math.round(p.unbind_penalty_sec / 3600)}h` : ''}
                        </div>
                      ) : (
                        <span className="muted">禁止换绑</span>
                      )}
                      {p.max_unbind_count > 0 ? <div className="cell-sub">最多 {p.max_unbind_count} 次</div> : null}
                    </td>
                    <td>
                      {p.trial_enabled ? (
                        <Badge tone="info">{Math.round(p.trial_duration_sec / 60)} 分钟</Badge>
                      ) : (
                        <span className="muted">关闭</span>
                      )}
                    </td>
                    <td>
                      <span className="text-green">{p.active_count || 0}</span>
                      <span className="muted"> / {p.code_count || 0}</span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button size="sm" icon="sliders" onClick={() => openEdit(p)}>
                          配置
                        </Button>
                        <Menu
                          align="end"
                          trigger={
                            <Button size="sm" variant="ghost" icon="more" aria-label="更多操作" />
                          }
                          items={[
                            { label: '查看公钥', icon: 'lock', onSelect: () => viewPubkey(p) },
                            { label: '全服加时', icon: 'gift', onSelect: () => compensateProduct(p) },
                            { separator: true },
                            { label: '删除产品', icon: 'trash', danger: true, onSelect: () => deleteProduct(p) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        icon={editing?.id ? 'sliders' : 'plus'}
        title={editing?.id ? `编辑产品 · ${editing.name}` : '新建产品'}
        subtitle={editing?.id ? editing.slug : '创建后会自动生成 Ed25519 密钥对'}
        width={800}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button type="submit" form="product-form" variant="primary" icon="check" loading={saving}>
              保存配置
            </Button>
          </>
        }
      >
        {editing ? (
          <form id="product-form" className="form-stack" onSubmit={saveProduct}>
            <div className="form-section">
              <div className="form-section-title">
                <Icon name="package" size={14} /> 基础信息
              </div>
              <div className="form-grid">
                <Field label="产品名称" required>
                  <Input
                    required
                    placeholder="如：Neon Abyss 2 增强 Mod"
                    value={editing.name}
                    onChange={e => update({ name: e.target.value })}
                  />
                </Field>
                <Field label="唯一标识 Slug" required hint="小写字母、数字与横线；创建后不可修改">
                  <Input
                    required
                    disabled={Boolean(editing.id)}
                    className="mono"
                    placeholder="如：neona2-tweaks"
                    value={editing.slug}
                    onChange={e => update({ slug: e.target.value })}
                  />
                </Field>
                <Field label="运行状态" className="span-2">
                  <Segmented value={editing.status} onChange={v => update({ status: v })} options={STATUS_OPTIONS} />
                </Field>
                <Field label="默认卡密前缀" hint="留空则生成纯 16 位卡密">
                  <Input
                    maxLength={8}
                    className="mono"
                    placeholder="如 VIP"
                    value={editing.code_prefix}
                    onChange={e => update({ code_prefix: e.target.value })}
                  />
                </Field>
                <Field label="单码设备上限" hint="同一卡密可同时绑定的设备数">
                  <NumberField min={1} max={100} value={editing.max_devices} onChange={v => update({ max_devices: v })} suffix="台" />
                </Field>
                <Field label="最新版本号">
                  <Input className="mono" value={editing.version} onChange={e => update({ version: e.target.value })} />
                </Field>
                <Field label="最低兼容版本" hint="低于此版本时客户端提示强制更新">
                  <Input className="mono" value={editing.min_version} onChange={e => update({ min_version: e.target.value })} />
                </Field>
                <Field label="建议心跳间隔" hint="客户端应在此周期内上报心跳，服务端在线窗口为 3 分钟">
                  <NumberField min={10} max={3600} value={editing.heartbeat_interval} onChange={v => update({ heartbeat_interval: v })} suffix="秒" />
                </Field>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-title">
                <Icon name="sliders" size={14} /> 换绑与试用策略
              </div>
              <div className="switch-grid">
                <div className="switch-row">
                  <Switch
                    checked={editing.allow_unbind}
                    onChange={v => update({ allow_unbind: v })}
                    label="允许客户端自助换绑"
                    hint="关闭后仅管理员可在后台解绑"
                  />
                </div>
                <div className="switch-row">
                  <Switch
                    checked={editing.trial_enabled}
                    onChange={v => update({ trial_enabled: v })}
                    label="开启免费试用"
                    hint="新机器码可领取一次试用时长"
                  />
                </div>
              </div>
              <div className="form-grid">
                <Field label="换绑冷却时间">
                  <NumberField min={0} value={editing.unbind_cooldown_hours} onChange={v => update({ unbind_cooldown_hours: v })} suffix="小时" />
                </Field>
                <Field label="每次换绑扣除有效期" hint="0 表示不扣除剩余时长">
                  <NumberField min={0} value={editing.unbind_penalty_hours} onChange={v => update({ unbind_penalty_hours: v })} suffix="小时" />
                </Field>
                <Field label="最大自助换绑次数" hint="0 表示不限制">
                  <NumberField min={0} value={editing.max_unbind_count} onChange={v => update({ max_unbind_count: v })} suffix="次" />
                </Field>
                <Field label="免费试用时长">
                  <NumberField min={1} value={editing.trial_duration_minutes} onChange={v => update({ trial_duration_minutes: v })} suffix="分钟" />
                </Field>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-title">
                <Icon name="database" size={14} /> 公告与远程配置
              </div>
              <Field label="项目公告" hint="客户端初始化 / 激活 / 心跳时同步下发">
                <textarea
                  className="input textarea"
                  rows={2}
                  placeholder="可选：版本更新说明、维护通知或交流群号…"
                  value={editing.announcement}
                  onChange={e => update({ announcement: e.target.value })}
                />
              </Field>
              <Field label="私有远程配置（JSON）" hint="仅在激活或验签通过后下发，用于防静态逆向">
                <textarea
                  className="input textarea mono"
                  rows={5}
                  value={editing.custom_data}
                  onChange={e => update({ custom_data: e.target.value })}
                />
              </Field>
            </div>

            <button type="submit" hidden />
          </form>
        ) : null}
      </Modal>
    </div>
  );
};
