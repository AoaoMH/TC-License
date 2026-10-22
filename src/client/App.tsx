import React, { useEffect, useState } from 'react';
import { adminFetch } from './api';
import { Product } from '../shared/types';
import { DashboardView } from './views/DashboardView';
import { ProductsView } from './views/ProductsView';
import { CodesView } from './views/CodesView';
import { BlacklistView } from './views/BlacklistView';
import { SdkDocsView } from './views/SdkDocsView';
import { LogsView } from './views/LogsView';

type TabKey = 'dash' | 'products' | 'codes' | 'blacklist' | 'sdk' | 'logs';

export const App: React.FC = () => {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<TabKey>('dash');
  const [products, setProducts] = useState<Product[]>([]);

  const [toast, setToast] = useState<{ msg: string; isErr?: boolean } | null>(null);
  const [modal, setModal] = useState<{ title: string; content: string } | null>(null);

  const showToast = (msg: string, isErr?: boolean) => {
    setToast({ msg, isErr });
    setTimeout(() => {
      setToast(prev => (prev?.msg === msg ? null : prev));
    }, 2800);
  };

  const showModal = (title: string, content: string) => {
    setModal({ title, content });
  };

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
        if (res.authenticated) {
          loadProducts();
        }
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
    }
  };

  const handleLogout = async () => {
    await fetch('/admin/logout', { method: 'POST', headers: { Accept: 'application/json' } });
    setAuthenticated(false);
  };

  if (!authChecked) {
    return null;
  }

  if (!authenticated) {
    return (
      <div className="login-wrap">
        <form className="login-card" onSubmit={handleLogin}>
          <h1 style={{ fontSize: 21, textAlign: 'center', marginBottom: 6 }}>
            License<span style={{ color: 'var(--accent)' }}>Admin</span> <small style={{ fontSize: 12, color: 'var(--muted)' }}>v3</small>
          </h1>
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, marginBottom: 24 }}>
            多项目卡密签发、心跳验证与远程配置中心
          </div>
          {loginError && (
            <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 14, textAlign: 'center' }}>
              {loginError}
            </div>
          )}
          <input
            type="password"
            placeholder="请输入管理员密码 (ADMIN_PASSWORD)"
            style={{ width: '100%', padding: '11px 14px', marginBottom: 14 }}
            autoFocus
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <button type="submit" className="btn primary" style={{ width: '100%', padding: '11px' }}>
            登 录 系 统
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="side">
        <div className="logo">
          <div>License<span>Admin</span></div>
          <span className="ver">v3.0</span>
        </div>
        <nav className="nav">
          <button className={activeTab === 'dash' ? 'on' : ''} onClick={() => setActiveTab('dash')}>
            运行仪表盘
          </button>
          <button className={activeTab === 'products' ? 'on' : ''} onClick={() => setActiveTab('products')}>
            产品与策略
          </button>
          <button className={activeTab === 'codes' ? 'on' : ''} onClick={() => setActiveTab('codes')}>
            激活码管理
          </button>
          <button className={activeTab === 'blacklist' ? 'on' : ''} onClick={() => setActiveTab('blacklist')}>
            机器码黑名单
          </button>
          <button className={activeTab === 'sdk' ? 'on' : ''} onClick={() => setActiveTab('sdk')}>
            对接文档 / SDK
          </button>
          <button className={activeTab === 'logs' ? 'on' : ''} onClick={() => setActiveTab('logs')}>
            安全审计日志
          </button>
        </nav>
        <div className="foot">
          <button className="btn" style={{ width: '100%' }} onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </aside>

      <main className="main">
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
        {activeTab === 'sdk' && (
          <SdkDocsView products={products} showToast={showToast} />
        )}
        {activeTab === 'logs' && (
          <LogsView products={products} showToast={showToast} />
        )}
      </main>

      {modal && (
        <div className="mask" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{modal.title}</h3>
            <pre className="code-box">{modal.content}</pre>
            <div className="foot">
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard.writeText(modal.content).then(() => showToast('已复制到剪贴板'));
                }}
              >
                一键复制
              </button>
              <button className="btn primary" onClick={() => setModal(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.isErr ? 'err' : ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default App;
