import React, { useEffect, useMemo, useState } from 'react';
import { adminFetch, fmtCompact, fmtDuration, fmtRelative, fmtRemaining, fmtTime } from '../api';
import { CodeBinding, LicenseCode, Product } from '../../shared/types';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  Modal,
  NumberField,
  PageHeader,
  Select,
  Switch,
  copyText,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { useDialog } from '../components/dialogs';

interface Props {
  products: Product[];
  showToast: (msg: string, isErr?: boolean) => void;
  showModal: (title: string, content: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  unused: '未激活',
  active: '已激活',
  revoked: '已吊销',
};

const PRESETS: Array<{ label: string; sec: number }> = [
  { label: '1 小时', sec: 3600 },
  { label: '12 小时', sec: 12 * 3600 },
  { label: '1 天', sec: 86400 },
  { label: '7 天', sec: 7 * 86400 },
  { label: '30 天', sec: 30 * 86400 },
  { label: '90 天', sec: 90 * 86400 },
  { label: '365 天', sec: 365 * 86400 },
];

const UNIT_SEC: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ====================================================================== */
/* Generate result                                                         */
/* ====================================================================== */

const GenerateResultModal: React.FC<{
  result: { codes: string[]; batch: string } | null;
  onClose: () => void;
  showToast: (m: string, e?: boolean) => void;
}> = ({ result, onClose, showToast }) => {
  if (!result) return null;
  const text = result.codes.join('\n');
  return (
    <Modal
      open
      onClose={onClose}
      icon="ticket"
      title={`已生成 ${result.codes.length} 张激活码`}
      subtitle={`批次 ${result.batch} · 首次激活后才开始计算有效期`}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            完成
          </Button>
          <Button
            icon="download"
            onClick={() => {
              downloadText(`codes-${result.batch}.txt`, text);
              showToast('已下载 txt 文件');
            }}
          >
            下载 txt
          </Button>
          <Button
            variant="primary"
            icon="copy"
            onClick={async () => {
              const ok = await copyText(text);
              showToast(ok ? '已复制全部激活码' : '复制失败，请手动选择', !ok);
            }}
          >
            复制全部
          </Button>
        </>
      }
    >
      <div className="gen-result-list">
        {result.codes.map((c, i) => (
          <div className="gen-result-row" key={c}>
            <span className="idx">{String(i + 1).padStart(2, '0')}</span>
            <code>{c}</code>
            <IconButton
              icon="copy"
              label="复制"
              size="xs"
              onClick={async () => {
                const ok = await copyText(c);
                showToast(ok ? '已复制' : '复制失败', !ok);
              }}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
};

/* ====================================================================== */
/* Extend                                                                  */
/* ====================================================================== */

type TimeUnit = 'minutes' | 'hours' | 'days';

const ExtendModal: React.FC<{
  target: { ids: number[]; label: string; code?: LicenseCode } | null;
  onClose: () => void;
  onDone: () => void;
  showToast: (m: string, e?: boolean) => void;
}> = ({ target, onClose, onDone, showToast }) => {
  const [amount, setAmount] = useState(7);
  const [unit, setUnit] = useState<TimeUnit>('days');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setAmount(7);
      setUnit('days');
      setSaving(false);
    }
  }, [target]);

  if (!target) return null;
  const addSec = Math.round(amount * UNIT_SEC[unit]);
  const single = target.code;

  let preview = '';
  if (single) {
    if (single.status === 'unused' && !single.expires_at) {
      preview =
        single.duration_sec > 0
          ? `未激活 · 卡密时长 ${fmtDuration(single.duration_sec)} → ${fmtDuration(single.duration_sec + addSec)}`
          : '未激活 · 永久卡，无需延期';
    } else if (!single.expires_at) {
      preview = '永久有效，延期不会改变到期时间';
    } else {
      const base = single.expires_at > Math.floor(Date.now() / 1000) ? single.expires_at : Math.floor(Date.now() / 1000);
      preview = `${fmtTime(single.expires_at)} → ${fmtTime(base + addSec)}`;
    }
  }

  const submit = async () => {
    if (addSec <= 0) {
      showToast('请输入大于 0 的时长', true);
      return;
    }
    setSaving(true);
    try {
      if (single) {
        const res = await adminFetch(`/codes/${single.id}/extend`, {
          body: { days: unit === 'days' ? amount : 0, hours: unit === 'days' ? 0 : amount * (unit === 'minutes' ? 1 / 60 : 1) },
        });
        if (!res.ok) throw new Error(res.error || '延期失败');
      } else {
        const res = await adminFetch('/codes/batch', {
          body: {
            ids: target.ids,
            action: 'extend',
            days: unit === 'days' ? amount : 0,
            hours: unit === 'days' ? 0 : amount * (unit === 'minutes' ? 1 / 60 : 1),
          },
        });
        if (!res.ok) throw new Error(res.error || '批量延期失败');
      }
      showToast(single ? '延期成功' : `已为 ${target.ids.length} 张卡密延期`);
      onDone();
      onClose();
    } catch (e: any) {
      showToast(e.message || '延期失败', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon="clock"
      title={single ? '延长有效期' : '批量延期'}
      subtitle={target.label}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" icon="calendar" loading={saving} onClick={submit}>
            确认延期
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div>
          <div className="billing-title" style={{ marginBottom: 8 }}>
            <Icon name="zap" size={13} /> 快捷时长
          </div>
          <div className="plan-chips">
            {PRESETS.map(p => (
              <button
                key={p.sec}
                type="button"
                className={`plan-chip ${Math.round(amount * UNIT_SEC[unit]) === p.sec ? 'on' : ''}`}
                onClick={() => {
                  setUnit('days');
                  setAmount(p.sec / 86400);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="custom-duration">
          <Field label="自定义时长">
            <NumberField value={amount} onChange={setAmount} min={0.1} max={36500} step={1} />
          </Field>
          <Field label="单位">
            <Select
              value={unit}
              onChange={v => setUnit(v as TimeUnit)}
              options={[
                { value: 'minutes', label: '分钟' },
                { value: 'hours', label: '小时' },
                { value: 'days', label: '天' },
              ]}
            />
          </Field>
        </div>
        {preview ? (
          <div className="gen-summary" style={{ marginTop: 0 }}>
            <Icon name="calendar" size={14} />
            <span>{preview}</span>
          </div>
        ) : null}
        {single?.status === 'unused' ? (
          <div className="field-hint">未激活的卡密会直接增加卡密面值时长，激活后一次性生效。</div>
        ) : null}
      </div>
    </Modal>
  );
};

/* ====================================================================== */
/* Blacklist                                                               */
/* ====================================================================== */

const REASONS = ['使用外挂 / 破解', '多人共享账号', '恶意退款', '异常多开', '违规转售', '其他'];

const BanModal: React.FC<{
  target: { machineId: string; codeId?: number; productId?: number; productName?: string; deviceName?: string } | null;
  products: Product[];
  onClose: () => void;
  onDone: () => void;
  showToast: (m: string, e?: boolean) => void;
}> = ({ target, products, onClose, onDone, showToast }) => {
  const [scope, setScope] = useState<'product' | 'global'>('product');
  const [reason, setReason] = useState('使用外挂 / 破解');
  const [unbind, setUnbind] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setScope('product');
      setReason('使用外挂 / 破解');
      setUnbind(true);
      setSaving(false);
    }
  }, [target]);

  if (!target) return null;
  const product = products.find(p => p.id === target.productId);

  const submit = async () => {
    if (!reason.trim()) {
      showToast('请填写拉黑原因', true);
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch('/blacklist', {
        body: {
          machine_id: target.machineId,
          product_id: scope === 'global' ? null : target.productId ?? null,
          reason: reason.trim(),
        },
      });
      if (!res.ok) throw new Error(res.error || '拉黑失败');
      if (unbind && target.codeId) {
        try {
          const unbindRes = await adminFetch(`/codes/${target.codeId}/unbind`, {
            body: { machine_id: target.machineId },
          });
          if (!unbindRes.ok) throw new Error(unbindRes.error || '解绑失败');
        } catch (e: any) {
          showToast(`已拉黑，但解绑失败：${e.message || '未知错误'}`, true);
          onDone();
          onClose();
          return;
        }
      }
      showToast('已加入黑名单，该设备已被强制下线');
      onDone();
      onClose();
    } catch (e: any) {
      showToast(e.message || '拉黑失败', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon="ban"
      title="拉黑机器码"
      subtitle="拉黑后该设备将无法激活、验证或续期"
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" icon="shield-ban" loading={saving} onClick={submit}>
            确认拉黑
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="blacklist-preview">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim small">机器码</span>
            <IconButton
              icon="copy"
              label="复制机器码"
              size="xs"
              onClick={async () => {
                const ok = await copyText(target.machineId);
                showToast(ok ? '已复制机器码' : '复制失败', !ok);
              }}
            />
          </div>
          <span className="machine-id">
            <span>{target.machineId}</span>
          </span>
          {target.deviceName ? (
            <div className="small muted">
              设备名：{target.deviceName}
              {target.productName ? ` · 产品：${target.productName}` : ''}
            </div>
          ) : null}
        </div>

        <Field label="封禁范围" hint={scope === 'global' ? '该机器码将在所有产品中被拒绝' : `仅禁止该机器码访问 ${product?.name || target.productName || '当前产品'}`}>
          <Select
            value={scope}
            onChange={v => setScope(v as any)}
            options={[
              { value: 'product', label: `仅当前产品${product ? `（${product.name}）` : ''}` },
              { value: 'global', label: '全局 · 所有产品' },
            ]}
          />
        </Field>

        <Field label="拉黑原因" required>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：使用外挂 / 多人共享账号" />
          <div className="quick-chips" style={{ marginTop: 8 }}>
            {REASONS.map(r => (
              <button type="button" key={r} className="quick-chip" onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
        </Field>

        <div className="ban-switch">
          <Switch
            checked={unbind}
            onChange={setUnbind}
            label="同时解绑该设备"
            hint="解绑后当前卡密可被其他设备重新激活"
          />
        </div>
        <div className="field-hint">
          <Icon name="info" size={12} /> 拉黑会立即下发踢下线指令，设备下次心跳将被拒绝（machine_banned）。
        </div>
      </div>
    </Modal>
  );
};

/* ====================================================================== */
/* Device sessions                                                         */
/* ====================================================================== */

const DeviceModal: React.FC<{
  code: LicenseCode | null;
  onClose: () => void;
  onKick: (b: CodeBinding) => void;
  onUnbind: (b: CodeBinding) => void;
  onBan: (b: CodeBinding) => void;
  onKickAll: () => void;
  onUnbindAll: () => void;
  onBanAny: () => void;
}> = ({ code, onClose, onKick, onUnbind, onBan, onKickAll, onUnbindAll, onBanAny }) => {
  if (!code) return null;
  const bindings = code.bindings || [];
  const onlineCount = bindings.filter(b => b.online).length;

  return (
    <Modal
      open
      onClose={onClose}
      icon="users"
      title="设备绑定会话"
      subtitle={
        <span>
          <code className="mono" style={{ color: '#9dbcff' }}>{code.code}</code>
          <span className="dim"> · {code.product_name}</span>
        </span>
      }
      width={920}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button icon="power" disabled={onlineCount === 0} onClick={onKickAll}>
            全部踢下线
          </Button>
          <Button icon="unlink" disabled={bindings.length === 0} onClick={onUnbindAll}>
            解绑全部
          </Button>
          <Button variant="danger" icon="ban" disabled={bindings.length === 0} onClick={onBanAny}>
            拉黑机器码
          </Button>
        </>
      }
    >
      <div className="device-summary">
        <div className="item">
          <span>绑定席位</span>
          <b>
            {bindings.length} / {code.effective_max_devices || 1} 台
          </b>
        </div>
        <div className="item">
          <span>当前在线</span>
          <b style={{ color: onlineCount > 0 ? 'var(--green)' : undefined }}>{onlineCount} 台</b>
        </div>
        <div className="item">
          <span>首次激活</span>
          <b>{fmtTime(code.activated_at)}</b>
        </div>
        <div className="item">
          <span>到期时间</span>
          <b>{code.duration_sec === 0 ? '永久有效' : fmtTime(code.expires_at)}</b>
        </div>
        <div className="item">
          <span>换绑次数</span>
          <b>{code.unbind_count || 0} 次</b>
        </div>
      </div>

      {bindings.length === 0 ? (
        <EmptyState
          icon="cpu"
          title="当前没有绑定设备"
          description="卡密首次激活后，设备的机器码、IP 与心跳会显示在这里。"
        />
      ) : (
        <div className="table-wrap">
          <table className="device-table">
            <thead>
              <tr>
                <th style={{ width: 92 }}>状态</th>
                <th>机器码 (Machine ID)</th>
                <th style={{ width: 120 }}>设备名</th>
                <th style={{ width: 120 }}>最近 IP</th>
                <th style={{ width: 150 }}>最近心跳</th>
                <th style={{ width: 208 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map(b => (
                <tr key={b.id}>
                  <td>
                    <Badge tone={b.online ? 'success' : 'neutral'} dot>
                      {b.online ? '在线' : '离线'}
                    </Badge>
                  </td>
                  <td>
                    <span className="machine-id">
                      <span>{b.machine_id}</span>
                    </span>
                  </td>
                  <td>{b.device_name || '—'}</td>
                  <td className="muted mono small">{b.ip || '—'}</td>
                  <td>
                    <div className="cell-main">{fmtRelative(b.last_seen_at)}</div>
                    <div className="cell-sub">{fmtCompact(b.last_seen_at)}</div>
                  </td>
                  <td>
                    <div className="device-actions">
                      <Button size="sm" icon="power" onClick={() => onKick(b)}>
                        踢下线
                      </Button>
                      <Button size="sm" icon="unlink" onClick={() => onUnbind(b)}>
                        解绑
                      </Button>
                      <Button size="sm" variant="danger" icon="ban" onClick={() => onBan(b)}>
                        拉黑
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
};

/* ====================================================================== */
/* Main view                                                               */
/* ====================================================================== */

export const CodesView: React.FC<Props> = ({ products, showToast }) => {
  const dialog = useDialog();
  const [codes, setCodes] = useState<LicenseCode[]>([]);
  const [total, setTotal] = useState(0);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
  const [loading, setLoading] = useState(false);

  // generate form
  const [genProductId, setGenProductId] = useState<string>('');
  const [genCount, setGenCount] = useState(1);
  const [permanent, setPermanent] = useState(false);
  const [durationSec, setDurationSec] = useState(30 * 86400);
  const [customAmount, setCustomAmount] = useState(30);
  const [customUnit, setCustomUnit] = useState<TimeUnit>('days');
  const [showCustom, setShowCustom] = useState(false);
  const [genPrefix, setGenPrefix] = useState('');
  const [genMaxDevices, setGenMaxDevices] = useState('');
  const [genNote, setGenNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ codes: string[]; batch: string } | null>(null);

  // filters
  const [fProduct, setFProduct] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fTrial, setFTrial] = useState('');
  const [fQuery, setFQuery] = useState('');

  // selection & modals
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [inspectCode, setInspectCode] = useState<LicenseCode | null>(null);
  const [extendTarget, setExtendTarget] = useState<{ ids: number[]; label: string; code?: LicenseCode } | null>(null);
  const [banTarget, setBanTarget] = useState<{
    machineId: string;
    codeId?: number;
    productId?: number;
    productName?: string;
    deviceName?: string;
  } | null>(null);

  useEffect(() => {
    if (products.length > 0 && !genProductId) setGenProductId(String(products[0].id));
  }, [products, genProductId]);

  const fetchCodes = async (): Promise<LicenseCode[]> => {
    const params = new URLSearchParams();
    if (fProduct) params.set('product_id', fProduct);
    if (fStatus) params.set('status', fStatus);
    if (fTrial !== '') params.set('is_trial', fTrial);
    if (fQuery.trim()) params.set('q', fQuery.trim());
    const res = await adminFetch('/codes?' + params.toString());
    if (res.ok) {
      setTotal(res.total || 0);
      setNowSec(res.now || Math.floor(Date.now() / 1000));
      return res.codes || [];
    }
    throw new Error(res.error || '加载失败');
  };

  const loadCodes = async () => {
    setLoading(true);
    try {
      const list = await fetchCodes();
      setCodes(list);
      setSelectedIds([]);
      setInspectCode(prev => (prev ? list.find(c => c.id === prev.id) || null : null));
    } catch (e: any) {
      showToast(e.message || '加载失败', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fProduct, fStatus, fTrial]);

  const activePreset = useMemo(() => PRESETS.find(p => p.sec === durationSec), [durationSec]);
  const seatInherit = products.find(p => String(p.id) === genProductId)?.max_devices;

  const handleGenerate = async () => {
    if (!genProductId) {
      showToast('请先创建并选择产品', true);
      return;
    }
    setGenerating(true);
    try {
      const body: any = {
        product_id: Number(genProductId),
        count: genCount,
        duration_sec: permanent ? 0 : durationSec,
        note: genNote,
      };
      if (genPrefix.trim()) body.prefix = genPrefix.trim();
      if (genMaxDevices.trim()) body.max_devices = Number(genMaxDevices);
      const res = await adminFetch('/codes', { body });
      if (res.ok) {
        setGenResult({ codes: res.codes, batch: res.batch_no });
        loadCodes();
        setGenCount(1);
        setGenNote('');
      } else {
        showToast(res.error || '生成失败', true);
      }
    } catch (e: any) {
      showToast(e.message || '生成失败', true);
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? codes.map(c => c.id) : []);
  };
  const toggleSelectOne = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const runBatch = async (action: string, opts?: { confirm?: string; danger?: boolean }) => {
    if (selectedIds.length === 0) return;
    if (opts?.confirm) {
      const ok = await dialog.confirm({
        title: '批量操作确认',
        message: opts.confirm,
        tone: opts.danger ? 'danger' : 'primary',
        confirmText: opts.danger ? '确认执行' : '确定',
      });
      if (!ok) return;
    }
    try {
      const res = await adminFetch('/codes/batch', { body: { ids: selectedIds, action } });
      if (res.ok) {
        showToast(`批量操作成功（${res.count} 张）`);
        loadCodes();
      } else {
        showToast(res.error || '批量操作失败', true);
      }
    } catch (e: any) {
      showToast(e.message || '批量操作失败', true);
    }
  };

  const singleAction = async (code: LicenseCode, action: string, body: any = {}) => {
    try {
      const res = await adminFetch(`/codes/${code.id}/${action}`, { body });
      if (res.ok) {
        showToast('操作成功');
        loadCodes();
      } else {
        showToast(res.error || '操作失败', true);
      }
    } catch (e: any) {
      showToast(e.message || '操作失败', true);
    }
  };

  const deleteCode = async (c: LicenseCode) => {
    const ok = await dialog.confirm({
      title: '永久删除激活码',
      message: (
        <>
          确认删除 <b className="mono">{c.code}</b>？该操作不可恢复，绑定设备与试用记录会一并清除。
        </>
      ),
      tone: 'danger',
      icon: 'trash',
      confirmText: '永久删除',
    });
    if (!ok) return;
    try {
      const res = await adminFetch(`/codes/${c.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('已删除');
        loadCodes();
      } else {
        showToast(res.error || '删除失败', true);
      }
    } catch (e: any) {
      showToast(e.message || '删除失败', true);
    }
  };

  const exportCodes = (list: LicenseCode[], label: string) => {
    if (list.length === 0) {
      showToast('没有可导出的激活码', true);
      return;
    }
    const text = list.map(c => c.code).join('\n');
    navigateExport(text, label);
  };

  const navigateExport = (text: string, label: string) => {
    showToast(`正在导出 ${label}`);
    downloadText(`codes-${label}.txt`, text);
  };

  const selectedCodes = codes.filter(c => selectedIds.includes(c.id));

  const openBanForCode = (c: LicenseCode) => {
    const bindings = c.bindings || [];
    if (bindings.length === 1) {
      setBanTarget({
        machineId: bindings[0].machine_id,
        codeId: c.id,
        productId: c.product_id,
        productName: c.product_name,
        deviceName: bindings[0].device_name,
      });
    } else if (bindings.length > 1) {
      setInspectCode(c);
      showToast('该卡密绑定了多台设备，请在设备列表中选择要拉黑的机器码');
    } else {
      showToast('该卡密尚未绑定设备', true);
    }
  };

  return (
    <div>
      <PageHeader
        icon="key"
        title="激活码管理"
        subtitle="批量签发、席位管理、延期与机器码风控。首次激活后才开始计算有效期。"
        actions={
          <>
            <Button icon="download" onClick={() => exportCodes(codes, 'filtered')} disabled={codes.length === 0}>
              导出列表
            </Button>
            <Button icon="refresh" loading={loading} onClick={loadCodes}>
              刷新
            </Button>
          </>
        }
      />

      {/* ---------------------------------------------------------- */}
      {/* Generator                                                   */}
      {/* ---------------------------------------------------------- */}
      <section className="panel gen-panel">
        <div className="panel-head">
          <div className="panel-head-icon">
            <Icon name="sparkles" size={15} />
          </div>
          <div>
            <h3>批量生成激活码</h3>
            <div className="panel-head-sub">支持天卡 / 小时卡 / 永久卡，自定义前缀与席位上限</div>
          </div>
          <div className="spacer" />
          <Badge tone="info">激活后计时</Badge>
        </div>

        <div className="gen-layout">
          <div className="gen-left">
            <Field label="所属产品" className="span-2">
              <Select
                value={genProductId}
                onChange={setGenProductId}
                searchable
                placeholder="选择产品"
                options={products.map(p => ({ value: String(p.id), label: p.name, hint: p.slug }))}
              />
            </Field>
            <Field label="生成数量" hint="单次最多 1000 张">
              <NumberField value={genCount} onChange={setGenCount} min={1} max={1000} suffix="张" />
            </Field>
            <Field label="席位上限" hint={seatInherit ? `留空继承产品默认（${seatInherit} 台）` : '留空继承产品设置'}>
              <Input
                inputMode="numeric"
                placeholder="继承产品"
                value={genMaxDevices}
                onChange={e => setGenMaxDevices(e.target.value.replace(/[^\d]/g, ''))}
                suffix="台"
              />
            </Field>
            <Field label="卡密前缀" hint="2–8 位大写字母，留空继承产品前缀">
              <Input
                placeholder="例如 TCNA"
                maxLength={8}
                value={genPrefix}
                onChange={e => setGenPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </Field>
            <Field label="备注" hint="仅后台可见，可用于标记渠道 / 批次">
              <Input placeholder="如：发卡网首批月卡" maxLength={60} value={genNote} onChange={e => setGenNote(e.target.value)} />
            </Field>
          </div>

          <div className="gen-billing">
            <div className="billing-title">
              <Icon name="credit-card" size={13} /> 计费方案
            </div>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-item ${!permanent ? 'on' : ''}`}
                onClick={() => setPermanent(false)}
              >
                按时长
              </button>
              <button
                type="button"
                className={`segmented-item ${permanent ? 'on' : ''}`}
                onClick={() => setPermanent(true)}
              >
                永久有效
              </button>
            </div>

            {!permanent ? (
              <>
                <div className="plan-chips">
                  {PRESETS.map(p => (
                    <button
                      type="button"
                      key={p.sec}
                      className={`plan-chip ${!showCustom && activePreset?.sec === p.sec ? 'on' : ''}`}
                      onClick={() => {
                        setShowCustom(false);
                        setDurationSec(p.sec);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button type="button" className={`plan-chip ${showCustom ? 'on' : ''}`} onClick={() => setShowCustom(true)}>
                    自定义
                  </button>
                </div>

                {showCustom ? (
                  <div className="custom-duration">
                    <NumberField
                      value={customAmount}
                      onChange={v => {
                        setCustomAmount(v);
                        setDurationSec(Math.round(v * UNIT_SEC[customUnit]));
                      }}
                      min={1}
                      max={36500}
                      step={1}
                    />
                    <Select
                      value={customUnit}
                      onChange={v => {
                        setCustomUnit(v as TimeUnit);
                        setDurationSec(Math.round(customAmount * UNIT_SEC[v]));
                      }}
                      options={[
                        { value: 'minutes', label: '分钟' },
                        { value: 'hours', label: '小时' },
                        { value: 'days', label: '天' },
                      ]}
                    />
                  </div>
                ) : null}

                <div className="gen-summary">
                  <Icon name="calendar" size={13} />
                  <span>
                    激活后到期：<b className="expiry">{fmtTime(Math.floor(Date.now() / 1000) + durationSec)}</b>
                  </span>
                  <span className="dim">（{fmtDuration(durationSec)}）</span>
                </div>
              </>
            ) : (
              <div className="gen-summary">
                <Icon name="infinity" size={14} />
                <span>永久有效 · 不设置到期时间</span>
              </div>
            )}

            <div className="gen-total">
              <span>共 {genCount} 张</span>
              <span className="dim">·</span>
              <span>{permanent ? '永久' : fmtDuration(durationSec)}</span>
            </div>
          </div>
        </div>

        <div className="gen-actions">
          <Button
            variant="ghost"
            icon="x"
            onClick={() => {
              setGenCount(1);
              setPermanent(false);
              setDurationSec(30 * 86400);
              setCustomAmount(30);
              setCustomUnit('days');
              setShowCustom(false);
              setGenPrefix('');
              setGenMaxDevices('');
              setGenNote('');
            }}
          >
            重置
          </Button>
          <Button variant="primary" icon="zap" loading={generating} onClick={handleGenerate}>
            立即生成 {genCount} 张
          </Button>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* List                                                        */}
      {/* ---------------------------------------------------------- */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>卡密列表</h3>
            <div className="panel-head-sub">
              共 <b style={{ color: 'var(--text-2)' }}>{total}</b> 张
              {fQuery ? ' · 已按关键词筛选' : ''}
            </div>
          </div>
          <div className="spacer" />
          <Button size="sm" icon="download" onClick={() => exportCodes(codes, 'filtered')} disabled={codes.length === 0}>
            导出筛选结果
          </Button>
        </div>

        <div className="filter-bar">
          <Select
            value={fProduct}
            onChange={setFProduct}
            size="sm"
            placeholder="全部产品"
            ariaLabel="按产品筛选"
            options={[{ value: '', label: '全部产品' }, ...products.map(p => ({ value: String(p.id), label: p.name }))]}
          />
          <Select
            value={fStatus}
            onChange={setFStatus}
            size="sm"
            ariaLabel="按状态筛选"
            options={[
              { value: '', label: '全部状态' },
              { value: 'unused', label: '未激活（库存）' },
              { value: 'active', label: '已激活' },
              { value: 'expired', label: '已过期' },
              { value: 'revoked', label: '已吊销' },
            ]}
          />
          <Select
            value={fTrial}
            onChange={setFTrial}
            size="sm"
            ariaLabel="按类型筛选"
            options={[
              { value: '', label: '全部类型' },
              { value: '0', label: '仅正式卡' },
              { value: '1', label: '仅试用卡' },
            ]}
          />
          <div className="search">
            <Input
              icon="search"
              aria-label="搜索激活码、机器码、批次或备注"
              placeholder="搜索 激活码 / 机器码 / 批次 / 备注…"
              value={fQuery}
              onChange={e => setFQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadCodes()}
            />
            <Button size="sm" icon="search" onClick={loadCodes}>
              查询
            </Button>
          </div>
          <IconButton icon="refresh" label="刷新列表" size="sm" onClick={loadCodes} />
        </div>

        <div className="table-wrap table-scroll">
          <table className="codes-table">
            <thead>
              <tr>
                <th style={{ width: 38 }}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label="选择全部激活码"
                    checked={codes.length > 0 && selectedIds.length === codes.length}
                    onChange={e => toggleSelectAll(e.target.checked)}
                  />
                </th>
                <th>激活码</th>
                <th style={{ width: 150 }}>产品</th>
                <th style={{ width: 96 }}>状态</th>
                <th style={{ width: 178 }}>有效期</th>
                <th style={{ width: 150 }}>席位</th>
                <th style={{ width: 130 }}>最近心跳</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon="ticket"
                      title={loading ? '正在加载…' : '没有匹配的激活码'}
                      description={loading ? undefined : '调整筛选条件，或使用上方表单生成新的激活码。'}
                    />
                  </td>
                </tr>
              ) : (
                codes.map(c => {
                  const isExpired = c.status !== 'revoked' && !!c.expires_at && c.expires_at < nowSec;
                  const isActive = c.status === 'active' || (!!c.activated_at && c.status !== 'revoked' && !isExpired);
                  const bound = c.bound_devices ?? (c.machine_id ? 1 : 0);
                  const max = c.effective_max_devices || 1;
                  const bindings = c.bindings || [];
                  return (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox"
                          aria-label={`选择激活码 ${c.code}`}
                          checked={selectedIds.includes(c.id)}
                          onChange={() => toggleSelectOne(c.id)}
                        />
                      </td>
                      <td>
                        <div className="code-cell">
                          <div className="code-key">
                            <span>{c.code}</span>
                            <IconButton
                              icon="copy"
                              label="复制激活码"
                              size="xs"
                              className="copy"
                              onClick={async () => {
                                const ok = await copyText(c.code);
                                showToast(ok ? '已复制激活码' : '复制失败', !ok);
                              }}
                            />
                            {c.is_trial === 1 ? <Badge tone="info">试用</Badge> : null}
                          </div>
                          <div className="code-meta">
                            {c.batch_no ? <b className="mono">{c.batch_no}</b> : null}
                            {c.batch_no && c.note ? <span className="sep" /> : null}
                            {c.note ? <span>{c.note}</span> : null}
                            {!c.batch_no && !c.note ? <span>—</span> : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="cell-main">{c.product_name || '—'}</div>
                        {c.product_slug ? <div className="cell-sub mono">{c.product_slug}</div> : null}
                      </td>
                      <td>
                        {c.status === 'revoked' ? (
                          <Badge tone="danger" dot>
                            已吊销
                          </Badge>
                        ) : isExpired ? (
                          <Badge tone="warning" dot>
                            已过期
                          </Badge>
                        ) : isActive ? (
                          <Badge tone="success" dot>
                            已激活
                          </Badge>
                        ) : (
                          <Badge tone="neutral">未激活</Badge>
                        )}
                      </td>
                      <td>
                        <div className="cell-main">{c.duration_sec === 0 ? '永久有效' : fmtDuration(c.duration_sec)}</div>
                        <div
                          className={`cell-sub expiry-sub ${isExpired ? 'text-danger' : ''}`}
                          title={c.expires_at ? fmtTime(c.expires_at) : undefined}
                        >
                          {c.status === 'unused' && !c.expires_at
                            ? '待激活后计时'
                            : !c.expires_at
                              ? '无到期时间'
                              : `${fmtCompact(c.expires_at)} 到期 · ${fmtRemaining(c.expires_at, nowSec)}`}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="seat-chip"
                          onClick={() => setInspectCode(c)}
                          title="查看并管理绑定设备"
                        >
                          <span className={`dot ${c.online ? 'on' : 'off'}`} />
                          <span className="seat-num">
                            {bound}/{max}
                          </span>
                          <span className="usage-track">
                            <span
                              className={`usage-fill ${bound >= max ? 'full' : ''}`}
                              style={{ width: `${Math.min(100, (bound / Math.max(1, max)) * 100)}%` }}
                            />
                          </span>
                          <Icon name="chevron-right" size={12} />
                        </button>
                      </td>
                      <td>
                        <div className="cell-main">{c.last_seen_at ? fmtRelative(c.last_seen_at, nowSec) : '从未连接'}</div>
                        <div className="cell-sub">{c.last_seen_at ? fmtTime(c.last_seen_at) : ''}</div>
                      </td>
                      <td>
                        <div className="actions-cell">
                          <Button size="sm" icon="users" onClick={() => setInspectCode(c)}>
                            设备
                          </Button>
                          <Menu
                            trigger={<IconButton icon="more" label="更多操作" size="sm" variant="solid" />}
                            header={<span>卡密操作</span>}
                            items={[
                              { key: 'extend', label: '延期', icon: 'clock', onSelect: () => setExtendTarget({ ids: [c.id], label: c.code, code: c }) },
                              ...(isActive
                                ? [
                                    {
                                      key: 'kick',
                                      label: '踢下线',
                                      icon: 'power' as const,
                                      onSelect: () => singleAction(c, 'kick'),
                                    },
                                    {
                                      key: 'unbind',
                                      label: '解绑全部设备',
                                      icon: 'unlink' as const,
                                      onSelect: () => singleAction(c, 'unbind'),
                                    },
                                  ]
                                : []),
                              {
                                key: 'ban',
                                label: '拉黑机器码',
                                icon: 'ban' as const,
                                disabled: bindings.length === 0,
                                onSelect: () => openBanForCode(c),
                              },
                              { key: 's1', separator: true },
                              ...(c.status !== 'revoked'
                                ? [
                                    {
                                      key: 'revoke',
                                      label: '吊销',
                                      icon: 'shield-ban' as const,
                                      danger: true,
                                      onSelect: () => singleAction(c, 'revoke'),
                                    },
                                  ]
                                : [
                                    {
                                      key: 'restore',
                                      label: '恢复',
                                      icon: 'restore' as const,
                                      onSelect: () => singleAction(c, 'restore'),
                                    },
                                  ]),
                              {
                                key: 'delete',
                                label: '删除',
                                icon: 'trash' as const,
                                danger: true,
                                onSelect: () => deleteCode(c),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* floating selection dock */}
      {selectedIds.length > 0 ? (
        <div className="selection-dock">
          <div className="count">
            <b>{selectedIds.length}</b>
            已选中
          </div>
          <span className="divider" />
          <Button size="sm" icon="download" onClick={() => exportCodes(selectedCodes, 'selected')}>
            导出
          </Button>
          <Button size="sm" icon="clock" onClick={() => setExtendTarget({ ids: selectedIds, label: `已选中 ${selectedIds.length} 张卡密` })}>
            延期
          </Button>
          <Button size="sm" icon="power" onClick={() => runBatch('kick', { confirm: `确认批量踢下线选中的 ${selectedIds.length} 张卡密的在线设备？` })}>
            踢下线
          </Button>
          <Button size="sm" icon="unlink" onClick={() => runBatch('unbind', { confirm: `确认解绑选中的 ${selectedIds.length} 张卡密的全部设备？`, danger: true })}>
            解绑
          </Button>
          <Menu
            trigger={<Button size="sm" icon="more">更多</Button>}
            header={<span>批量操作</span>}
            items={[
              { key: 'revoke', label: '批量吊销', icon: 'shield-ban', danger: true, onSelect: () => runBatch('revoke', { confirm: `确认吊销选中的 ${selectedIds.length} 张卡密？`, danger: true }) },
              { key: 'restore', label: '批量恢复', icon: 'restore', onSelect: () => runBatch('restore') },
              { key: 's', separator: true },
              { key: 'delete', label: '批量删除', icon: 'trash', danger: true, onSelect: () => runBatch('delete', { confirm: `确认永久删除选中的 ${selectedIds.length} 张卡密？此操作不可恢复。`, danger: true }) },
            ]}
          />
          <span className="divider" />
          <IconButton icon="x" label="取消选择" size="sm" onClick={() => setSelectedIds([])} />
        </div>
      ) : null}

      {/* modals */}
      <GenerateResultModal result={genResult} onClose={() => setGenResult(null)} showToast={showToast} />

      <ExtendModal
        target={extendTarget}
        onClose={() => setExtendTarget(null)}
        onDone={loadCodes}
        showToast={showToast}
      />

      <BanModal
        target={banTarget}
        products={products}
        onClose={() => setBanTarget(null)}
        onDone={loadCodes}
        showToast={showToast}
      />

      <DeviceModal
        code={inspectCode}
        onClose={() => setInspectCode(null)}
        onKick={b => {
          if (!inspectCode) return;
          singleAction(inspectCode, 'kick', { machine_id: b.machine_id });
        }}
        onUnbind={async b => {
          if (!inspectCode) return;
          const ok = await dialog.confirm({
            title: '解绑设备',
            message: `确认解绑设备 ${b.device_name || b.machine_id}？该席位将被释放。`,
            tone: 'danger',
            confirmText: '解绑',
          });
          if (ok) singleAction(inspectCode, 'unbind', { machine_id: b.machine_id });
        }}
        onBan={b => {
          if (!inspectCode) return;
          setBanTarget({
            machineId: b.machine_id,
            codeId: inspectCode.id,
            productId: inspectCode.product_id,
            productName: inspectCode.product_name,
            deviceName: b.device_name,
          });
        }}
        onKickAll={() => {
          if (!inspectCode) return;
          singleAction(inspectCode, 'kick');
        }}
        onUnbindAll={async () => {
          if (!inspectCode) return;
          const ok = await dialog.confirm({
            title: '解绑全部设备',
            message: `确认解绑 ${inspectCode.code} 下的全部设备？`,
            tone: 'danger',
            confirmText: '全部解绑',
          });
          if (ok) singleAction(inspectCode, 'unbind');
        }}
        onBanAny={() => {
          if (!inspectCode) return;
          const bindings = inspectCode.bindings || [];
          if (bindings.length === 0) {
            showToast('当前没有可拉黑的设备', true);
            return;
          }
          if (bindings.length === 1) {
            setBanTarget({
              machineId: bindings[0].machine_id,
              codeId: inspectCode.id,
              productId: inspectCode.product_id,
              productName: inspectCode.product_name,
              deviceName: bindings[0].device_name,
            });
          } else {
            showToast('设备较多，请在列表中点击对应的「拉黑」按钮');
          }
        }}
      />
    </div>
  );
};
