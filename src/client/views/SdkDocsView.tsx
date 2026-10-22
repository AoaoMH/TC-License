import React, { useEffect, useState } from 'react';
import { adminFetch } from '../api';
import { Product } from '../../shared/types';

interface Props {
  products: Product[];
  showToast: (msg: string, isErr?: boolean) => void;
}

type Lang = 'csharp' | 'python' | 'nodejs';

export const SdkDocsView: React.FC<Props> = ({ products, showToast }) => {
  const [selectedId, setSelectedId] = useState<number>(0);
  const [pubPem, setPubPem] = useState<string>('');
  const [lang, setLang] = useState<Lang>('csharp');

  useEffect(() => {
    if (products.length > 0 && !selectedId) {
      setSelectedId(products[0].id);
    }
  }, [products]);

  useEffect(() => {
    if (!selectedId) return;
    adminFetch(`/products/${selectedId}/pubkey`)
      .then(res => {
        if (res.ok) setPubPem(res.pem.trim());
      })
      .catch(() => {});
  }, [selectedId]);

  const currentProd = products.find(p => p.id === selectedId);
  const slug = currentProd?.slug || 'your-product-slug';
  const serverOrigin = window.location.origin;

  const generateCode = (): string => {
    if (lang === 'csharp') {
      return `// ============================================================================
// C# (.NET / Unity / BepInEx / MelonLoader Mod) 完整卡密验证、心跳与自助换绑示例
// 产品: ${currentProd?.name || slug} (${slug})
// ============================================================================
using System;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

public static class LicenseClient
{
    private const string ServerUrl = "${serverOrigin}";
    private const string ProductSlug = "${slug}";

    // 内嵌产品 Ed25519 公钥 (SPKI PEM)，用于本地离线验签防篡改
    public const string PublicKeyPem = @"${pubPem}";

    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    private static string _code = "";
    private static string _secret = "";
    private static string _machineId = "";
    private static CancellationTokenSource _hbCts;

    // 1. 激活卡密（首次启动或用户输入卡密时调用）
    public static async Task<JsonElement> ActivateAsync(string code, string machineId, string deviceName = "PC")
    {
        _code = code.Trim().ToUpperInvariant();
        _machineId = machineId.Trim().ToLowerInvariant();

        var payload = JsonSerializer.Serialize(new {
            product = ProductSlug,
            code = _code,
            machine_id = _machineId,
            device_name = deviceName
        });
        var res = await Http.PostAsync($"{ServerUrl}/api/activate", new StringContent(payload, Encoding.UTF8, "application/json"));
        var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

        if (doc.GetProperty("ok").GetBoolean())
        {
            _secret = doc.GetProperty("secret").GetString();
            int interval = doc.GetProperty("heartbeat_interval").GetInt32();
            StartHeartbeatLoop(interval);
        }
        return doc;
    }

    // 2. 构造防重放 HMAC-SHA256 签名请求体 (Verify & Heartbeat 通用)
    private static string BuildSignedJson()
    {
        long ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        byte[] nonceBytes = new byte[12];
        RandomNumberGenerator.Fill(nonceBytes);
        string nonce = Convert.ToBase64String(nonceBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        byte[] key = SHA256.HashData(Encoding.UTF8.GetBytes(_secret));
        string msg = $"{ProductSlug}|{_code}|{_machineId}|{ts}|{nonce}";
        using var hmac = new HMACSHA256(key);
        string sig = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(msg))).ToLowerInvariant();

        return JsonSerializer.Serialize(new {
            product = ProductSlug,
            code = _code,
            machine_id = _machineId,
            ts,
            nonce,
            sig
        });
    }

    // 3. 后台定时心跳保活与远程指令监听 (kick / revoked / expired)
    private static void StartHeartbeatLoop(int intervalSeconds)
    {
        _hbCts?.Cancel();
        _hbCts = new CancellationTokenSource();
        var ct = _hbCts.Token;

        Task.Run(async () => {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(intervalSeconds), ct);
                try
                {
                    var res = await Http.PostAsync($"{ServerUrl}/api/heartbeat",
                        new StringContent(BuildSignedJson(), Encoding.UTF8, "application/json"), ct);
                    var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
                    if (!doc.GetProperty("ok").GetBoolean()) continue;

                    string status = doc.GetProperty("status").GetString();
                    if (status != "active")
                    {
                        // 收到远程踢下线 (kick)、吊销 (revoked)、过期 (expired) 或封禁 (banned)
                        Console.WriteLine($"[License] 授权已终止: {status}");
                        Environment.Exit(0);
                    }
                }
                catch { /* 网络抖动容错 */ }
            }
        }, ct);
    }
}`;
    }

    if (lang === 'python') {
      return `# ============================================================================
# Python 客户端完整对接示例 (支持初始化、免费试用、卡密激活、HMAC签名校验与心跳)
# 产品: ${currentProd?.name || slug} (${slug})
# ============================================================================
import time
import hmac
import hashlib
import secrets
import urllib.request
import json

SERVER_URL = "${serverOrigin}"
PRODUCT_SLUG = "${slug}"
PUBLIC_KEY_PEM = """${pubPem}"""

def post_json(path: str, data: dict) -> dict:
    req = urllib.request.Request(
        f"{SERVER_URL}{path}",
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))

def sign_request(secret: str, code: str, machine_id: str) -> dict:
    ts = int(time.time() * 1000)
    nonce = secrets.token_urlsafe(12)
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    msg = f"{PRODUCT_SLUG}|{code}|{machine_id}|{ts}|{nonce}".encode("utf-8")
    sig = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return {
        "product": PRODUCT_SLUG,
        "code": code,
        "machine_id": machine_id,
        "ts": ts,
        "nonce": nonce,
        "sig": sig,
    }

# 1. 激活卡密
res = post_json("/api/activate", {
    "product": PRODUCT_SLUG,
    "code": "XXXX-XXXX-XXXX-XXXX",
    "machine_id": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "device_name": "My-Workstation"
})
print("Activate:", res)

if res.get("ok"):
    secret = res["secret"]
    code = res["code"]
    # 2. 发送安全验证与心跳
    hb = post_json("/api/heartbeat", sign_request(secret, code, "a1b2c3d4e5f60718293a4b5c6d7e8f90"))
    print("Heartbeat:", hb)`;
    }

    return `// ============================================================================
// Node.js / TypeScript 客户端完整对接示例 (含 Ed25519 离线验签 + HMAC 防重放签名)
// 产品: ${currentProd?.name || slug} (${slug})
// ============================================================================
import crypto from 'node:crypto';

const SERVER_URL = '${serverOrigin}';
const PRODUCT_SLUG = '${slug}';
const PUBLIC_KEY_PEM = \`${pubPem}\`;

export function verifyOfflineToken(token: string, expectedMachineId: string): boolean {
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return false;
  const sigOk = crypto.verify(
    null,
    Buffer.from(payloadB64, 'base64url'),
    crypto.createPublicKey(PUBLIC_KEY_PEM),
    Buffer.from(sigB64, 'base64url')
  );
  if (!sigOk) return false;
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (payload.p !== PRODUCT_SLUG || payload.m !== expectedMachineId) return false;
  if (payload.exp > 0 && payload.exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function buildSignedBody(secret: string, code: string, machineId: string) {
  const ts = Date.now();
  const nonce = crypto.randomBytes(12).toString('base64url');
  const key = crypto.createHash('sha256').update(secret).digest();
  const sig = crypto
    .createHmac('sha256', key)
    .update(\`\${PRODUCT_SLUG}|\${code}|\${machineId}|\${ts}|\${nonce}\`)
    .digest('hex');
  return { product: PRODUCT_SLUG, code, machine_id: machineId, ts, nonce, sig };
}`;
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generateCode()).then(() => showToast('代码已复制到剪贴板'));
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>API 协议规范与客户端代码生成器</h1>
          <div className="sub">选择目标产品，一键生成已自动嵌入该产品 Slug 与 Ed25519 公钥的客户端验证代码</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>交互式 SDK 代码生成器</h2>
          <div className="row">
            <label className="row" style={{ gap: 6 }}>
              <span className="muted">选择产品</span>
              <select value={selectedId} onChange={e => setSelectedId(Number(e.target.value))}>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
                ))}
              </select>
            </label>
            <button className={`btn sm ${lang === 'csharp' ? 'primary' : ''}`} onClick={() => setLang('csharp')}>
              C# / Unity / Mod
            </button>
            <button className={`btn sm ${lang === 'python' ? 'primary' : ''}`} onClick={() => setLang('python')}>
              Python
            </button>
            <button className={`btn sm ${lang === 'nodejs' ? 'primary' : ''}`} onClick={() => setLang('nodejs')}>
              Node.js / TS
            </button>
            <button className="btn sm" onClick={copyCode}>复制完整代码</button>
          </div>
        </div>
        <pre className="code-box" style={{ maxHeight: 480, padding: 16, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'auto', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5 }}>
          {generateCode()}
        </pre>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>标准接口速查表</h2>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>端点</th>
                <th>方法</th>
                <th>请求参数</th>
                <th>响应说明与核心机制</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>/api/init</code></td>
                <td>GET</td>
                <td><code>?product={slug}&amp;version=1.0.0</code></td>
                <td>返回项目状态、公告、是否需强更 (<code>update_required</code>)、免费试用配置与公钥</td>
              </tr>
              <tr>
                <td><code>/api/activate</code></td>
                <td>POST</td>
                <td><code>{`{ product, code, machine_id, device_name }`}</code></td>
                <td>首次激活触发倒计时；检查设备并发席位；下发 <code>token</code>、<code>secret</code> 与私有 <code>custom_data</code></td>
              </tr>
              <tr>
                <td><code>/api/trial</code></td>
                <td>POST</td>
                <td><code>{`{ product, machine_id, device_name }`}</code></td>
                <td>每台机器限领一次免费试用卡，返回与 <code>/api/activate</code> 完全相同的凭证结构</td>
              </tr>
              <tr>
                <td><code>/api/verify</code></td>
                <td>POST</td>
                <td><code>{`{ product, code, machine_id, ts, nonce, sig }`}</code></td>
                <td>HMAC-SHA256 验签 + 防重放；返回最新有效期 <code>token</code> 与最新私有 <code>custom_data</code></td>
              </tr>
              <tr>
                <td><code>/api/heartbeat</code></td>
                <td>POST</td>
                <td><code>{`{ product, code, machine_id, ts, nonce, sig }`}</code></td>
                <td>返回 <code>status: active | kick | revoked | expired | maintenance | banned</code></td>
              </tr>
              <tr>
                <td><code>/api/unbind</code></td>
                <td>POST</td>
                <td><code>{`{ product, code, machine_id? }`}</code></td>
                <td>客户端自助换绑：按产品策略校验冷却时间、次数上限并自动扣除换绑惩罚时长</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
