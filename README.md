<div align="center">
  <img src="https://img.shields.io/badge/Node.js-22.x-339933?style=flat-square&logo=nodedotjs" />
  <img src="https://img.shields.io/badge/Bun-1.3-14151A?style=flat-square&logo=bun" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  <img src="https://img.shields.io/github/last-commit/spfnas/opencode2api-free?style=flat-square" />
</div>

<br />

<div align="center">
  <h1>🚪 opencode2api-free</h1>
  <p><strong>Per-Key IP Pool 反代网关 — 每个 API Key 独立代理池，基于 opencode.ai/zen 的免费 API 转发</strong></p>
  <p>为每个 API Key 分配独立代理资源池，自动健康检查、故障转移、WARP 兜底，让你的免费 API 调用稳定如丝。</p>
</div>

<br />

---

## 📋 目录

- [核心特性](#-核心特性)
- [架构概览](#-架构概览)
- [快速开始](#-快速开始)
- [配置说明](#-配置说明)
- [API 文档](#-api-文档)
- [管理面板](#-管理面板)
- [部署指南](#-部署指南)
- [性能优化](#-性能优化)
- [技术栈](#-技术栈)

---

## ✨ 核心特性

### 🎯 Per-Key 独立代理池
- 每个 API Key 独占 N 个代理 Slot（默认 3 个）
- Key 级别隔离：一个 Key 的代理故障不影响其他 Key
- 空闲 Key 自动释放资源（默认 10min）

### 🔄 智能故障转移
```
Slot 不可用 → WARP fallback → 自定义兜底代理 → ZenProxy → 502
```
- 代理失败自动替换，业务无感
- 源头代理池定时刷新（默认 300s）
- 备用候选池自动回流机制

### 🌐 多源聚合
- **amux** — 高频代理源
- **speedx-socks5** — SOCKS5 代理源
- **自定义源** — 灵活扩展
- **自定义代理** — 手动指定静态代理

### 🛡️ WARP 全局兜底
- Cloudflare WARP SOCKS5 集成
- 30s 自动探活 + 断线重连
- 一键开关，运行状态可视

### ⚡ 性能优化
- **Agent 连接池** — LRU 缓存，避免重复 TCP 握手
- **审计异步写入** — 攒批 50 条 / 5s 定时 flush，告别 `appendFileSync` 阻塞
- **模型列表缓存持久化** — 启动即加载，1h 内不重复请求上游
- **优雅退出** — SIGINT/SIGTERM 触发审计 flush，数据不丢

### 📊 精美管理面板
- Stitch Design System 驱动
- 实时仪表盘 + 用量审计 + 密钥管理
- 代理池健康监控 + 代理源管理
- 系统配置热修改 + 在线 Chat 测试（支持流式响应）
- 暗色风格，骨架屏加载，移动端自适应

---

## 🏗 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    Client Request                     │
│              POST /openai/v1/chat/completions         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              opencode2api-free 网关                    │
│                                                       │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │ Key 绑定  │───▶│ Slot 池  │───▶│  代理执行器   │   │
│  └──────────┘    └──────────┘    └──────┬───────┘   │
│         │                               │           │
│         ▼                               ▼           │
│  ┌──────────┐    ┌──────────────────────────────┐   │
│  │ Key 管理  │    │       故障转移链              │   │
│  │ 创建/更新 │    │  Slot → WARP → Custom → 502 │   │
│  │ 启用/禁用 │    └──────────────────────────────┘   │
│  └──────────┘                                        │
│                                                       │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │ 代理源    │───▶│ 候选池   │───▶│ 备用候选池   │   │
│  │ amux     │    │ 187+     │    │ 20+          │   │
│  │ speedx   │    │ 代理     │    │ 备用         │   │
│  └──────────┘    └──────────┘    └──────────────┘   │
│                                                       │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │ 审计日志  │    │ WARP 探活 │    │ 模型缓存     │   │
│  │ 异步写入  │    │ 30s 重连  │    │ 持久化 1h   │   │
│  └──────────┘    └──────────┘    └──────────────┘   │
└─────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              opencode.ai/zen 上游                      │
│            https://opencode.ai/zen                    │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 前置条件
- **Node.js 22+** 或 **Bun 1.3+**
- Docker（可选，推荐容器部署）
- WARP 容器（可选，用于全局兜底）

### 本地运行

```bash
# 1. 安装依赖
bun install

# 2. 配置密钥
# 编辑 keys.json（自动生成，首次为空）
# 格式: { "your-api-key": { "name": "my-key", "enabled": true, ... } }

# 3. 配置代理源
# 编辑 data/sources.json（自动生成）

# 4. 启动
bun run gate.ts

# 服务监听 http://127.0.0.1:13339
```

### Docker 部署

```bash
# 使用 docker-compose（推荐）
docker compose up -d

# 或手动构建
docker build -t opencode-gate .
docker run -d \
  --name opencode-gate \
  -p 13339:13339 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/keys.json:/app/keys.json \
  -e WARP_MODE=on \
  -e WARP_HOST=host.docker.internal \
  opencode-gate
```

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `13339` | 监听端口 |
| `API_KEY` | `admin123` | 管理后台认证密钥 |
| `MAX_ACTIVE_KEYS` | `20` | 最大并发活跃 Key 数 |
| `SLOTS_PER_KEY` | `3` | 每个 Key 分配的代理 Slot 数 |
| `WARP_MODE` | `off` | WARP 模式：`on` / `off` |
| `WARP_HOST` | `127.0.0.1` | WARP SOCKS5 主机 |
| `WARP_SOCKS5_PORT` | `1080` | WARP SOCKS5 端口 |
| `PROXY_REFRESH_MS` | `300000` | 代理源刷新间隔（ms） |
| `PROXY_PROBE_TIMEOUT` | `8000` | 代理探活超时（ms） |
| `TCP_FAST_CHECK_TIMEOUT` | `2000` | TCP 快速检测超时（ms） |
| `FALLBACK_PROXY` | `""` | 自定义 Fallback 代理地址 |
| `ZENPROXY_KEY` | `""` | ZenProxy API Key |

### API Key 管理

Key 配置存储在 `keys.json`，支持以下字段：

```json
{
  "sk-your-key-hex": {
    "name": "my-key",
    "enabled": true,
    "maxConcurrency": 3,
    "maxRequests": 1000,
    "expiresAt": "2026-12-31T23:59:59.000Z"
  }
}
```

### 代理源格式

支持三种源类型：
- **text** — 纯文本，每行一个代理地址
- **json** — JSON 数组格式
- **scraper** — 页面抓取

---

## 📖 API 文档

### OpenAI 兼容接口

```
POST /openai/v1/chat/completions
```
完全兼容 OpenAI Chat API 格式，支持 `stream: true/false`。

```
POST /openai/v1/models
GET  /openai/v1/models
```

### 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/status` | 网关状态总览 |
| `GET` | `/api/keys` | 列出所有 API Key |
| `POST` | `/api/keys` | 创建新 Key |
| `PUT` | `/api/keys/:key` | 更新 Key 配置 |
| `DELETE` | `/api/keys/:key` | 删除 Key |
| `GET` | `/api/models` | 可用模型列表 |
| `GET` | `/api/proxies` | 代理池列表 |
| `POST` | `/api/proxies` | 批量导入代理 |
| `DELETE` | `/api/proxies/:addr` | 删除代理 |
| `GET` | `/api/sources` | 代理源列表 |
| `POST` | `/api/sources` | 添加代理源 |
| `DELETE` | `/api/sources/:name` | 删除代理源 |
| `GET` | `/api/audit` | 审计日志统计 |
| `GET` | `/api/logs` | 系统日志 |
| `GET` | `/api/config` | 获取配置 |
| `POST` | `/api/config` | 更新配置 |
| `POST` | `/api/config/reload` | 热重载配置 |
| `POST` | `/api/warp` | WARP 控制 |
| `POST` | `/api/refresh` | 刷新候选池 |
| `POST` | `/api/slots/fill` | 填充槽位 |
| `POST` | `/api/promote` | 提升代理优先级 |
| `POST` | `/api/released/probe` | 备用候选测活 |
| `POST` | `/api/fallback/test` | 测试 Fallback |
| `POST` | `/api/sources/refresh` | 刷新所有源 |

### `/api/status` 响应示例

```json
{
  "ok": true,
  "uptime": 3600,
  "stats": {
    "total": 1523,
    "success": 1488,
    "rateLimited": 12,
    "errors": 23
  },
  "activeKeys": 3,
  "maxActiveKeys": 20,
  "slotCount": 60,
  "slotsReady": 9,
  "warpAvailable": true,
  "warpStatus": "running",
  "warpMode": "on",
  "candidatesCount": 187,
  "releasedCandidatesCount": 20
}
```

---

## 🖥 管理面板

### 仪表盘
实时网关状态、请求统计、缓存命中率、候选池规模、Key 使用概览。

### 用量审计
按日/按 Key 的请求量、Token 消耗、缓存命中趋势分析。

### 密钥管理
创建/编辑/启用/禁用 API Key，设置并发限制、请求配额和过期时间。

### 代理池
实时代理健康监控（质量分级 S/A/B/C），延迟显示，一键提升优先级。

### 代理源
管理上游数据源，支持 text/json/scraper 三种格式，实时查看代理数量。

### 系统配置
Web 界面热修改所有配置项，前端校验 + 保存反馈。

### Chat 测试
在线测试 OpenAI 兼容接口，支持 **流式 SSE 逐 token 渲染** 和普通模式，密钥/模型可选。

### 系统日志
实时滚动日志查看，自动刷新，一键回到顶部。

---

## 🐳 部署指南

### 远程服务器部署

```bash
# 1. 传输镜像到远程
docker save opencode-gate-custom -o opencode-gate.tar
scp opencode-gate.tar user@remote:/path/

# 2. 远程加载
docker load -i opencode-gate.tar

# 3. docker-compose.yml
version: '3'
services:
  opencode-gate:
    image: opencode-gate-custom
    ports:
      - "13339:13339"
    volumes:
      - ./data:/app/data
      - ./public:/app/public
      - ./keys.json:/app/keys.json
    environment:
      - WARP_MODE=on
      - WARP_HOST=192.168.1.x
      - API_KEY=admin123
    restart: unless-stopped
```

### Nginx 反代（可选）

```nginx
server {
    listen 443 ssl;
    server_name gate.example.com;

    location / {
        proxy_pass http://127.0.0.1:13339;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }
}
```

---

## ⚡ 性能优化

### 已实现的优化

| 优化项 | 说明 | 收益 |
|--------|------|------|
| 🔌 Agent 连接池 | LRU 缓存 50 个 agent，避免重复 TLS 握手 | 请求延迟降低 30-50% |
| 📝 审计异步写入 | 攒批 50 条 + 5s 定时 flush | 事件循环零阻塞 |
| 🔄 WARP 自动恢复 | 30s 探活 + 断线自动重连 | 兜底链路高可用 |
| 💾 模型缓存持久化 | 写文件，启动加载，1h 有效 | 首次请求 0 等待 |
| 🧹 优雅退出 | SIGINT/SIGTERM 自动 flush | 数据零丢失 |

### 调优建议

```
# 高并发场景
MAX_ACTIVE_KEYS=50
SLOTS_PER_KEY=5
PROXY_PROBE_TIMEOUT=5000

# 低延迟场景
PROXY_REFRESH_MS=60000
TCP_FAST_CHECK_TIMEOUT=1000

# 稳定优先
FALLBACK_PROXY=socks5://127.0.0.1:1080
WARP_MODE=on
```

---

## 🛠 技术栈

| 层 | 技术 |
|:---|:-----|
| **运行时** | Bun 1.3+ / Node.js 22+ |
| **代理** | hpagent (HTTP), socks-proxy-agent (SOCKS5) |
| **前端** | Tailwind CDN + Stitch Design System + Material Symbols |
| **构建** | TypeScript → Bun 原生执行 |
| **部署** | Docker, docker-compose |
| **兜底** | Cloudflare WARP, ZenProxy |

---

## 📸 截图

> *管理面板包含 7 个功能页面：仪表盘、用量审计、密钥管理、代理池、代理源、系统配置、系统日志 + Chat 测试*

---

## 📄 License

MIT © 2026 spfnas

---

<div align="center">
  <sub>Built with ❤️ for the open-source community</sub>
  <br />
  <sub>⭐ Star if you find it useful! ⭐</sub>
</div>
