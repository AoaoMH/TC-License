import React, { useEffect, useState } from 'react';
import { adminFetch, fmtDuration, fmtTime } from '../api';
import { CodeBinding, LicenseCode, Product } from '../../shared/types';

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

export const CodesView: React.FC<Props> = ({ products, showToast, showModal }) => {
  const [codes, setCodes] = useState<LicenseCode[]>([]);
  const [total, setTotal] = useState(0);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));

  // 生成表单状态
  const [genProductId, setGenProductId] = useState<string>('');
  const [genCount, setGenCount] = useState(1);
  const [genUnit, setGenUnit] = useState<'days' | 'hours' | 'permanent'>('days');
  const [genDurationVal, setGenDurationVal] = useState(30);
  const [genPrefix, setGenPrefix] = useState('');
  const [genMaxDevices, setGenMaxDevices] = useState('');
  const [genNote, setGenNote] = useState('');

  // 筛选状态
  const [fProduct, setFProduct] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fTrial, setFTrial] = useState('');
  const [fQuery, setFQuery] = useState('');

  // 批量选择与设备详情弹窗
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [inspectCode, setInspectCode] = useState<LicenseCode | null>(null);

  useEffect(() => {
    if (products.length > 0 && !genProductId) {
      setGenProductId(String(products[0].id));
    }
  }, [products]);

  const loadCodes = async () => {
    const params = new URLSearchParams();
    if (fProduct) params.set('product_id', fProduct);
    if (fStatus) params.set('status', fStatus);
    if (fTrial !== '') params.set('is_trial', fTrial);
    if (fQuery.trim()) params.set('q', fQuery.trim());

    try {
      const res = await adminFetch('/codes?' + params.toString());
      if (res.ok) {
        setCodes(res.codes || []);
        setTotal(res.total || 0);
        setNowSec(res.now || Math.floor(Date.now() / 1000));
        setSelectedIds([]);
      }
    } catch (e: any) {
      showToast(e.message || '加载失败', true);
    }
  };

  useEffect(() => {
    loadCodes();
  }, [fProduct, fStatus, fTrial]);

  const handleGenerate = async () => {
    if (!genProductId) {
      showToast('请先创建并选择产品', true);
      return;
    }
    let durationSec = 0;
    if (genUnit === 'days') durationSec = Math.max(0, Math.round(genDurationVal * 86400));
    else if (genUnit === 'hours') durationSec = Math.max(0, Math.round(genDurationVal * 3600));

    const body: any = {
      product_id: Number(genProductId),
      count: genCount,
      duration_sec: durationSec,
      note: genNote,
    };
    if (genPrefix.trim()) body.prefix = genPrefix.trim();
    if (genMaxDevices.trim()) body.max_devices = Number(genMaxDevices);

    const res = await adminFetch('/codes', { body });
    if (res.ok) {
      showModal(
        `已生成 ${res.codes.length} 张激活码 (批次: ${res.batch_no}) — 首次激活才开始计时`,
        res.codes.join('\n')
      );
      loadCodes();
    } else {
      showToast(res.error || '生成失败', true);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(codes.map(c => c.id));
    else setSelectedIds([]);
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const runBatch = async (action: string, confirmText?: string) => {
    if (selectedIds.length === 0) return;
    if (confirmText && !confirm(confirmText)) return;

    let extra: any = {};
    if (action === 'extend') {
      const d = prompt('批量延长天数（支持小数，如 0.5 表示 12 小时）：', '7');
      if (!d || isNaN(Number(d)) || Number(d) <= 0) return;
      extra.days = Number(d);
    }

    const res = await adminFetch('/codes/batch', {
      body: { ids: selectedIds, action, ...extra },
    });
    if (res.ok) {
      showToast(`批量操作成功 (${res.count} 张)`);
      loadCodes();
    } else {
      showToast(res.error || '批量操作失败', true);
    }
  };

  const exportSelected = () => {
    const list = codes.filter(c => selectedIds.includes(c.id)).map(c => c.code);
    showModal(`导出选中的 ${list.length} 张激活码 (可直接粘贴至发卡网)`, list.join('\n'));
  };

  const singleAction = async (id: number, action: string, confirmMsg?: string, body: any = {}) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const res = await adminFetch(`/codes/${id}/${action}`, { body });
    if (res.ok) {
      showToast('操作成功');
      loadCodes();
      if (inspectCode && inspectCode.id === id) setInspectCode(null);
    } else {
      showToast(res.error || '操作失败', true);
    }
  };

  const extendSingle = async (c: LicenseCode) => {
    const days = prompt(`为卡密 ${c.code} 延长天数（若未激活则直接增加卡密时长）：`, '30');
    if (!days || isNaN(Number(days)) || Number(days) <= 0) return;
    await singleAction(c.id, 'extend', undefined, { days: Number(days) });
  };

  const deleteSingle = async (c: LicenseCode) => {
    if (!confirm(`确认永久删除卡密 ${c.code}？`)) return;
    const res = await adminFetch(`/codes/${c.id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('已删除');
      loadCodes();
    } else {
      showToast(res.error || '删除失败', true);
    }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>激活码管理与批量运维</h1>
          <div className="sub">支持激活后计时（天卡/小时卡/永久卡）、自定义前缀、多设备并发席位管理与发卡网批量导出</div>
        </div>
      </div>

      {/* 生成卡密面板 */}
      <div className="panel">
        <div className="panel-head">
          <h2>批量生成激活码 (首次激活后才开始计算有效期)</h2>
        </div>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">所属产品</span>
            <select value={genProductId} onChange={e => setGenProductId(e.target.value)}>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
              ))}
            </select>
          </label>

          <label className="row" style={{ gap: 6 }}>
            <span className="muted">数量</span>
            <input
              type="number"
              min={1}
              max={1000}
              style={{ width: 80 }}
              value={genCount}
              onChange={e => setGenCount(Number(e.target.value))}
            />
          </label>

          <label className="row" style={{ gap: 6 }}>
            <span className="muted">计费类型</span>
            <select value={genUnit} onChange={e => setGenUnit(e.target.value as any)}>
              <option value="days">按天计时 (天卡/月卡/年卡)</option>
              <option value="hours">按小时计时 (小时卡)</option>
              <option value="permanent">永久有效 (Lifetime)</option>
            </select>
          </label>

          {genUnit !== 'permanent' && (
            <label className="row" style={{ gap: 6 }}>
              <span className="muted">时长({genUnit === 'days' ? '天' : '小时'})</span>
              <input
                type="number"
                min={1}
                style={{ width: 85 }}
                value={genDurationVal}
                onChange={e => setGenDurationVal(Number(e.target.value))}
              />
            </label>
          )}

          <label className="row" style={{ gap: 6 }}>
            <span className="muted">前缀</span>
            <input
              placeholder="默认继承产品"
              maxLength={8}
              style={{ width: 115 }}
              value={genPrefix}
              onChange={e => setGenPrefix(e.target.value)}
            />
          </label>

          <label className="row" style={{ gap: 6 }}>
            <span className="muted">席位上限</span>
            <input
              type="number"
              min={1}
              placeholder="继承产品"
              style={{ width: 90 }}
              value={genMaxDevices}
              onChange={e => setGenMaxDevices(e.target.value)}
            />
          </label>

          <label className="row" style={{ gap: 6 }}>
            <span className="muted">备注</span>
            <input
              placeholder="如：发卡网首批月卡"
              style={{ width: 150 }}
              value={genNote}
              onChange={e => setGenNote(e.target.value)}
            />
          </label>

          <button className="btn primary" onClick={handleGenerate}>
            立即生成
          </button>
        </div>
      </div>

      {/* 列表与筛选面板 */}
      <div className="panel">
        <div className="panel-head">
          <h2>卡密列表 (共 {total} 张)</h2>
          <div className="row">
            <select value={fProduct} onChange={e => setFProduct(e.target.value)}>
              <option value="">全部产品</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)}>
              <option value="">全部状态</option>
              <option value="unused">未激活 (库存)</option>
              <option value="active">已激活</option>
              <option value="expired">已过期</option>
              <option value="revoked">已吊销</option>
            </select>
            <select value={fTrial} onChange={e => setFTrial(e.target.value)}>
              <option value="">正式卡 + 试用卡</option>
              <option value="0">仅正式卡</option>
              <option value="1">仅免费试用卡</option>
            </select>
            <input
              placeholder="搜索 激活码 / 机器码 / 批次 / 备注..."
              style={{ width: 240 }}
              value={fQuery}
              onChange={e => setFQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadCodes()}
            />
            <button className="btn" onClick={loadCodes}>查询</button>
          </div>
        </div>

        {/* 批量操作工具栏 */}
        {selectedIds.length > 0 && (
          <div className="batch-bar">
            <div>
              已选中 <strong>{selectedIds.length}</strong> 张卡密
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm primary" onClick={exportSelected}>导出选中卡密</button>
              <button className="btn sm success" onClick={() => runBatch('extend')}>批量延期</button>
              <button className="btn sm" onClick={() => runBatch('unbind', '确认批量解绑选中卡密的所有设备？')}>批量解绑</button>
              <button className="btn sm" onClick={() => runBatch('kick', '确认批量踢下线选中卡密的在线设备？')}>批量踢下线</button>
              <button className="btn sm danger" onClick={() => runBatch('revoke', '确认批量吊销选中的卡密？')}>批量吊销</button>
              <button className="btn sm" onClick={() => runBatch('restore')}>批量恢复</button>
              <button className="btn sm danger" onClick={() => runBatch('delete', '确认永久删除选中的卡密？此操作不可恢复！')}>批量删除</button>
            </div>
          </div>
        )}

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={codes.length > 0 && selectedIds.length === codes.length}
                    onChange={e => toggleSelectAll(e.target.checked)}
                  />
                </th>
                <th>激活码</th>
                <th>产品</th>
                <th>状态</th>
                <th>面值时长</th>
                <th>在线 / 绑定席位</th>
                <th>到期时间</th>
                <th>换绑次数</th>
                <th>批次 / 备注</th>
                <th>最近心跳</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr>
                  <td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                    没有匹配的激活码记录
                  </td>
                </tr>
              ) : (
                codes.map(c => {
                  const isExpired = c.status === 'active' && c.expires_at && c.expires_at < nowSec;
                  return (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(c.id)}
                          onChange={() => toggleSelectOne(c.id)}
                        />
                      </td>
                      <td>
                        <code>{c.code}</code>
                        {c.is_trial === 1 && <span className="tag trial" style={{ marginLeft: 6 }}>试用</span>}
                      </td>
                      <td>{c.product_name}</td>
                      <td>
                        {isExpired ? (
                          <span className="tag expired">已过期</span>
                        ) : (
                          <span className={`tag ${c.status}`}>{STATUS_LABELS[c.status] || c.status}</span>
                        )}
                      </td>
                      <td>{fmtDuration(c.duration_sec)}</td>
                      <td>
                        <span className={`dot ${c.online ? 'on' : 'off'}`}></span>
                        <button
                          className="btn sm"
                          style={{ padding: '2px 8px' }}
                          onClick={() => setInspectCode(c)}
                          title="点击查看或管理绑定的设备列表"
                        >
                          {c.bound_devices || (c.machine_id ? 1 : 0)} / {c.effective_max_devices || 1} 台
                        </button>
                      </td>
                      <td>
                        {c.status === 'unused' && !c.expires_at ? (
                          <span className="muted">待激活后计时</span>
                        ) : !c.expires_at ? (
                          <span style={{ color: 'var(--green)' }}>永久有效</span>
                        ) : (
                          <span style={{ color: isExpired ? 'var(--red)' : undefined }}>
                            {fmtTime(c.expires_at)}
                          </span>
                        )}
                      </td>
                      <td className="muted">{c.unbind_count || 0} 次</td>
                      <td>
                        {c.batch_no && <code style={{ marginRight: 6, fontSize: 11 }}>{c.batch_no}</code>}
                        <span>{c.note || <span className="muted">-</span>}</span>
                      </td>
                      <td className="muted">{fmtTime(c.last_seen_at)}</td>
                      <td>
                        <div className="row" style={{ gap: 5 }}>
                          {c.status === 'active' && (
                            <>
                              <button
                                className="btn sm"
                                onClick={() => singleAction(c.id, 'kick', '确认踢下线该卡密下的设备？')}
                              >
                                踢下线
                              </button>
                              <button
                                className="btn sm"
                                onClick={() => singleAction(c.id, 'unbind', '确认解绑该卡密的所有设备？')}
                              >
                                解绑
                              </button>
                            </>
                          )}
                          {c.status !== 'revoked' ? (
                            <button
                              className="btn sm danger"
                              onClick={() => singleAction(c.id, 'revoke', '确认吊销该激活码？')}
                            >
                              吊销
                            </button>
                          ) : (
                            <button className="btn sm" onClick={() => singleAction(c.id, 'restore')}>
                              恢复
                            </button>
                          )}
                          <button className="btn sm" onClick={() => extendSingle(c)}>延期</button>
                          <button className="btn sm danger" onClick={() => deleteSingle(c)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 单卡设备绑定详情管理弹窗 */}
      {inspectCode && (
        <div className="mask" onClick={() => setInspectCode(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>设备绑定会话管理 — <code>{inspectCode.code}</code></h3>
            <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
              当前绑定席位：{inspectCode.bindings?.length || 0} / {inspectCode.effective_max_devices || 1} 台
              （首次激活时间：{fmtTime(inspectCode.activated_at)}）
            </p>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>机器码 (Machine ID)</th>
                    <th>设备名</th>
                    <th>最近 IP</th>
                    <th>最近心跳</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(!inspectCode.bindings || inspectCode.bindings.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                        当前无绑定设备
                      </td>
                    </tr>
                  ) : (
                    inspectCode.bindings.map((b: CodeBinding) => (
                      <tr key={b.id}>
                        <td>
                          <span className={`dot ${b.online ? 'on' : 'off'}`}></span>
                          {b.online ? '在线' : '离线'}
                        </td>
                        <td><code>{b.machine_id}</code></td>
                        <td>{b.device_name || '-'}</td>
                        <td className="muted">{b.ip || '-'}</td>
                        <td>{fmtTime(b.last_seen_at)}</td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              className="btn sm"
                              onClick={() => singleAction(inspectCode.id, 'kick', undefined, { machine_id: b.machine_id })}
                            >
                              踢下线
                            </button>
                            <button
                              className="btn sm danger"
                              onClick={() => singleAction(inspectCode.id, 'unbind', `确认解绑设备 ${b.machine_id}？`, { machine_id: b.machine_id })}
                            >
                              解绑此机
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="foot">
              <button className="btn primary" onClick={() => setInspectCode(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
