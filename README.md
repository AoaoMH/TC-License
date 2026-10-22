# TC-License — 多项目卡密签发、心跳验证与远程配置中心

基于 **Node.js (>= 22.5) + TypeScript + Express + 原生 `node:sqlite` (WAL 模式) + Vite + React** 构建的商业级轻量卡密验证系统。
支持通过 **GitHub Actions 自动化构建 Docker 镜像**，生产环境直接拉取极速部署。

---

## 核心特性

1. **自定义多项目隔离 (`Products`)**
   - 每个项目独立自动生成 **Ed25519 非对称密钥对**（客户端内嵌公钥离线验签，防本地抓包改包）。
   - 支持**项目状态开关**（正常服务 / 停机维护 / 停用）、**版本号与最低强更版本控制**、**实时项目公告**。
   - 支持**私有远程配置/变量 (`custom_data`)**：仅在卡密激活或 Verify 验签通过后下发 JSON 变量，防止逆向者静态提取关键参数。
2. **标准卡密计费与防串码逻辑 (`License Codes`)**
   - **激活后计时**：生成卡密时设定有效时长（天/小时/永久），库存状态下永不过期，**首次激活时才开始倒计时**。
   - **防跨项目串码**：所有接口强制校验产品标识 `product` (`slug`)。
   - **多设备并发席位 (`code_bindings`)**：支持一码一机或一码多机（可按产品或单卡自定义允许同时绑定的设备数），后台可查看每台设备的在线状态并独立踢下线或解绑。
3. **客户端自助换绑 (`/api/unbind`)**
   - 支持按产品配置：是否允许自助换绑、**换绑冷却时间**（如 24 小时）、**每次换绑扣除时长惩罚**（防共享倒卖）、**最大换绑次数上限**。
4. **机器码免费试用 (`/api/trial`) & 硬件黑名单 (`Blacklist`)**
   - 开启免费试用后，新机器码可自动申领一次试用卡密，100% 复用标准验签与心跳逻辑，到期后禁止重复白嫖。
   - 支持全局或单产品拉黑恶意机器码，封禁瞬间自动触发在线设备踢下线。
5. **防重放安全心跳 (`/api/heartbeat` & `/api/verify`)**
   - 激活时下发通讯密钥 `secret`（服务端仅存 SHA-256 哈希），后续请求携带 `时间戳 + 随机 Nonce + HMAC-SHA256 签名`，严格防重放与防 Token 盗用。
   - 管理员后台延期或全服加时补偿后，客户端调用 `/api/verify` 自动获发最新到期时间的离线 Token。
6. **内置客户端 SDK 代码生成器**
   - 管理后台自带交互式代码生成器，一键生成已填入当前产品公钥与参数的 **C# (Unity/Mod) / Python / Node.js** 对接代码。

---

## 本地开发与构建

```bash
# 1. 安装依赖 (需 Node.js >= 22.5.0)
npm install

# 2. 编译前端 (Vite + React) 与后端 (TypeScript)
npm run build

# 3. 启动生产服务 (默认监听 :3000)
npm start

# 4. 运行端到端自动化测试套件
node test-e2e.mjs <ADMIN_PASSWORD>
```

首次启动若未配置 `.env`，将自动生成随机 `ADMIN_PASSWORD` 写入 `.env` 并打印在终端。
管理后台地址：`http://localhost:3000/admin`

---

## 生产环境部署指南（Docker Compose + 1Panel / 宝塔面板）

### 为什么推荐使用 Docker Compose + 面板反向代理？
1. **环境零冲突**：项目依赖 Node 22.5+ 内置的 `node:sqlite`，使用官方 `node:22-alpine` 容器可避免污染宿主机 Node 环境。
2. **端口安全隔离**：`docker-compose.yml` 默认仅绑定宿主机回环地址 `127.0.0.1:3000:3000`，外网无法绕过 Nginx 防火墙直接扫描容器端口。
3. **备份极简**：所有持久化数据仅存于项目目录下的 `./data`（SQLite 数据库）与 `./keys`（Ed25519 密钥对）。

### 部署步骤

#### 第一步：上传项目并配置环境变量
将项目上传至服务器（如 `/opt/license-server` 或 `/www/wwwroot/license-server`）：

```bash
cd /opt/license-server
cp .env.example .env
# 编辑 .env 设置强密码 ADMIN_PASSWORD
vi .env
```

#### 第二步：一键构建并启动 Docker 容器
```bash
docker compose up -d --build
```
可通过 `docker compose ps` 或 `curl http://127.0.0.1:3000/health` 检查运行状态。

#### 第三步：在 1Panel 或 宝塔面板配置 HTTPS 反向代理
1. 打开 **1Panel** 或 **宝塔面板** $\rightarrow$ **网站** $\rightarrow$ **创建反向代理站点**。
2. 绑定你的域名（如 `auth.yourdomain.com`）。
3. **代理目标地址**填写：`http://127.0.0.1:3000`（详细配置可参考 [`nginx.example.conf`](file:///F:/HTML/license-server/nginx.example.conf)）。
4. 在站点设置中一键申请 **Let's Encrypt 免费 SSL 证书**，并开启 **强制 HTTPS**。

#### 第四步：配置定时自动备份（重要！）
在 1Panel / 宝塔面板的 **计划任务** 中添加一条「备份目录」任务：
- **备份目录**：`/opt/license-server/data` 与 `/opt/license-server/keys`（或整个 `/opt/license-server` 目录）
- **执行周期**：每天凌晨执行一次，保留最近 30 份备份（建议同步挂载云存储 OSS/COS/WebDAV）。

---

## 客户端标准 API 协议速查

### 1. 启动初始化：`GET /api/init?product=<slug>&version=1.0.0`
返回产品状态、公告、是否需强制更新 (`update_required`)、是否开启免费试用及产品 Ed25519 公钥。

### 2. 卡密激活：`POST /api/activate`
```json
// 请求
{
  "product": "neona2-tweaks",
  "code": "VIP-XXXX-XXXX-XXXX-XXXX",
  "machine_id": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "device_name": "Gaming-PC"
}
// 响应
{
  "ok": true,
  "token": "<base64url(payload)>.<base64url(ed25519_sig)>",
  "secret": "<base64url_hmac_secret>",
  "product": "neona2-tweaks",
  "code": "VIP-XXXX-XXXX-XXXX-XXXX",
  "expires_at": 1763800000,
  "is_permanent": false,
  "server_time": 1761208000,
  "heartbeat_interval": 60,
  "version": "1.0.0",
  "announcement": "欢迎使用！",
  "custom_data": { "feature_flags": { "vip_mode": true } }
}
```

### 3. 机器码免费试用：`POST /api/trial`
```json
{ "product": "neona2-tweaks", "machine_id": "a1b2c3d4e5f60718293a4b5c6d7e8f90", "device_name": "Gaming-PC" }
```
成功时返回与 `/api/activate` 相同的结构（附带 `"is_trial": true`）。

### 4. 签名计算规则（`/api/verify` 与 `/api/heartbeat` 通用）
```text
key   = SHA256(secret)                                         // 32 字节二进制摘要
msg   = "{product}|{code}|{machine_id}|{ts}|{nonce}"           // UTF-8 字符串 (亦兼容 "{code}|{machine_id}|{ts}|{nonce}")
sig   = HMAC-SHA256(key, msg)                                  // 64 位小写 hex 字符串
ts    = 当前毫秒级时间戳 (与服务器时间误差需在 ±5 分钟内)
nonce = 12~64 位随机字符串 ([a-zA-Z0-9_-])
```

### 5. 安全验证与刷新凭证：`POST /api/verify`
请求携带 `{ product, code, machine_id, ts, nonce, sig }`，成功返回最新 `expires_at`、重新签发的 `token` 以及最新 `custom_data`。

### 6. 心跳保活：`POST /api/heartbeat`
请求同 `/api/verify`，返回：
```json
{ "ok": true, "status": "active", "expires_at": 1763800000, "server_time": 1761208060, "announcement": "" }
```
当 `status` 为 `kick`（管理员远程踢下线）、`revoked`（已吊销）、`expired`（已过期）、`maintenance`（维护中）或 `banned`（机器码被封禁）时，客户端应立即停止工作。

### 7. 客户端自助换绑：`POST /api/unbind`
```json
{ "product": "neona2-tweaks", "code": "VIP-XXXX-XXXX-XXXX-XXXX", "machine_id": "可选指定解绑的机器码" }
```
