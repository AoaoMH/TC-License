import React, { useEffect, useState } from 'react';
import { adminFetch } from './api';
import { Product } from '../shared/types';
import { DashboardView } from './views/DashboardView';
import { ProductsView } from './views/ProductsView';
import { CodesView } from './views/CodesView';
import { BlacklistView } from './views/BlacklistView';
import { SdkDocsView } from './views/SdkDocsView';
import { LogsView } from './views/LogsView';
import { Button, Field, Input, Modal, Spinner, copyText } from './components/ui';
import { Icon, IconName } from './components/Icon';

type TabKey = 'dash' | 'products' | 'codes' | 'blacklist' | 'sdk' | 'logs';

const NAV: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: 'dash', label: '运行仪表盘', icon: 'activity' },
  { key: 'products', label: '产品与策略', icon: 'package' },
  { key: 'codes', label: '激活码管理', icon: 'key' },
  { key: 'blacklist', label: '机器码黑名单', icon: 'shield-ban' },
  { key: 'sdk', label: '对接文档 / SDK', icon: 'book' },
  { key: 'logs', label: '安全审计日志', icon: 'scroll' },
];

const APP_VERSION = '3.1.0';

export const App: React.FC = () => {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>('dash');
  const [products, setProducts] = useState<Product[]>([]);

  const [toast, setToast] = useState<{ msg: string; isErr?: boolean; id: number } | null>(null);
  const [modal, setModal] = useState<{ title: string; content: string } | null>(null);

  const showToast = (msg: string, isErr?: boolean) => {
    setToast({ msg, isErr, id: Date.now() });
    setTimeout(() => {
      setToast(prev => (prev?.msg === msg ? null : prev));
    }, 3000);
  };

  const showModal = (title: string, content: string) => setModal({ title, content });

  const loadProducts = async () => {
    try {
      const res = await adminFetch('/products');
      if (res.ok) setProducts(res.products || []);
    } catch {
      // handled by unauthorized listener
    }
  };

  useEffect(() => {
    adminFetch('/me')
      .then(res => {
        setAuthenticated(Boolean(res.authenticated));
        setAuthChecked(true);
        if (res.authenticated) loadProducts();
      })
      .catch(() => {
        setAuthenticated(false);
        setAuthChecked(true);
      });

    const onUnauth = () => setAuthenticated(false);
    window.addEventListener('admin:unauthorized', onUnauth);
    return () => window.removeEventListener('admin:unauthorized', onUnauth);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const res = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthenticated(true);
        setPassword('');
        loadProducts();
      } else {
        setLoginError('管理员密码错误（10 分钟内最多尝试 8 次）');
      }
    } catch {
      setLoginError('网络请求失败，请检查服务器状态');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/admin/logout', { method: 'POST', headers: { Accept: 'application/json' } });
    setAuthenticated(false);
  };

  if (!authChecked) {
    return (
      <div className="boot-screen">
        <Spinner size={22} />
        <span>正在校验会话…</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="logo">
            <div className="logo-mark">
              <Icon name="shield" size={17} />
            </div>
            <span>
              License<b style={{ color: 'var(--accent)' }}>Admin</b>
            </span>
            <span className="ver">v{APP_VERSION}</span>
          </div>
          <h2>登录管理控制台</h2>
          <div className="sub">多项目卡密签发、心跳验证与远程配置中心</div>

          {loginError ? <div className="login-error">{loginError}</div> : null}

          <div className="login-form">
            <Field label="管理员密码" hint="密码由服务端 ADMIN_PASSWORD 环境变量配置">
              <Input
                type="password"
                icon="lock"
                autoFocus
                required
                autoComplete="current-password"
                placeholder="请输入管理员密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" block icon="arrow-right" loading={loggingIn}>
              进入控制台
            </Button>
          </div>

          <div className="login-foot">
            <span className="dot on" /> 服务已连接
          </div>
        </form>
      </div>
    );
  }

  const current = NAV.find(n => n.key === activeTab);

  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="side">
        <div className="logo">
          <div className="logo-mark">
            <Icon name="shield" size={17} />
          </div>
          <span>
            License<b style={{ color: 'var(--accent)' }}>Admin</b>
          </span>
          <span className="ver">v{APP_VERSION}</span>
        </div>

        <div className="nav-label">管理</div>
        <nav className="nav">
          {NAV.map(item => (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${activeTab === item.key ? 'on' : ''}`}
              onClick={() => setActiveTab(item.key)}
              aria-current={activeTab === item.key ? 'page' : undefined}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <div className="side-user">
            <div className="avatar">A</div>
            <div className="who">
              <b>Administrator</b>
              <span>系统管理员</span>
            </div>
          </div>
          <Button variant="ghost" icon="logout" block onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </aside>

      <main className="main" id="main-content">
        <div className="topbar">
          <div className="crumb">
            控制台
            <Icon name="chevron-right" size={12} />
            <b>{current?.label || ''}</b>
          </div>
          <div className="spacer" />
          <span className="status-pill">
            <span className="dot on" /> 服务运行中
          </span>
          <span className="topbar-ver">v{APP_VERSION}</span>
        </div>

        <div className="content">
          {activeTab === 'dash' && (
            <DashboardView products={products} onRefreshProducts={loadProducts} showToast={showToast} />
          )}
          {activeTab === 'products' && (
            <ProductsView products={products} onRefresh={loadProducts} showToast={showToast} showModal={showModal} />
          )}
          {activeTab === 'codes' && (
            <CodesView products={products} showToast={showToast} showModal={showModal} />
          )}
          {activeTab === 'blacklist' && (
            <BlacklistView products={products} showToast={showToast} />
          )}
          {activeTab === 'sdk' && <SdkDocsView products={products} showToast={showToast} />}
          {activeTab === 'logs' && <LogsView products={products} showToast={showToast} />}
        </div>
      </main>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        icon="ticket"
        title={modal?.title || ''}
        width={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              关闭
            </Button>
            <Button
              variant="primary"
              icon="copy"
              onClick={async () => {
                if (!modal) return;
                const ok = await copyText(modal.content);
                showToast(ok ? '已复制到剪贴板' : '复制失败', !ok);
              }}
            >
              一键复制
            </Button>
          </>
        }
      >
        <pre className="export-pre">{modal?.content}</pre>
      </Modal>

      {toast ? (
        <div
          className={`toast ${toast.isErr ? 'err' : ''}`}
          key={toast.id}
          role={toast.isErr ? 'alert' : 'status'}
          aria-live={toast.isErr ? 'assertive' : 'polite'}
        >
          <Icon name={toast.isErr ? 'x-circle' : 'check-circle'} size={15} />
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
};

export default App;
