# opencode-gate 技术文档

> Per-Key IP Pool 反代网关 — 为 opencode.ai/zen 免费 AI 模型提供多 IP 轮询代理加速

## 项目概述

opencode-gate 是一个 TypeScript 编写的反向代理网关，专为 [opencode.ai/zen](https://opencode.ai/zen) 的免费 AI 模型（`-free` 后缀）设计。它通过聚合多个公共代理源、订阅节点、WARP 隧道和自定义代理，为每个 API Key 维护独立的代理 Slot 池，实现请求级轮询调度和故障自动替换，避免单 IP 速率限制（429）或连接失败。

**核心特性：**
- 每个 API Key 独立持有 3 个代理 Slot（`SLOTS_PER_KEY`），全局最多 20 个 Key 同时活跃（`MAX_ACTIVE_KEYS`）
- 请求级 Round-Robin 轮询，不仅故障时切换，正常请求也均匀分布
- 失败 Slot 自动探活替换，释放后立即回收
- 五级 Fallback 链：Pool Slots → WARP → Custom Proxies → ZenProxy Relay → 直连
- 内置订阅管理、审计日志、Key 管理 REST API
- 支持流式（SSE）和非流式 OpenAI 兼容请求转发

## 架构

```
                        ┌─────────────────────────────────┐
                        │        HTTP Server (:13339)      │
                        │   /v1/* → dispatch()             │
                        │   /api/* → management endpoints   │
                        └──────────┬──────────────────────┘
                                   │
                        ┌──────────▼──────────────────────┐
                        │       dispatch(authKey, pool)    │
                        │  1. RR select slot from pool     │
                        │  2. fallback → WARP              │
                        │  3. fallback → customSlots       │
                        │  4. fallback → ZenProxy relay    │
                        │  5. fallback → 直连              │
                        └──────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
      Per-Key Slot Pools     WARP (global)       Custom Proxies
      ┌──────┬──────┬─      ┌──────────┐       ┌──────────────┐
      │Key A │Key B │ ...   │ socks5   │       │ http/socks5  │
      │s1,s2,s3│s1,s2,s3│   │ 172.17.. │       │ (CUSTOM_PROXIES)
      └──────┴──────┴─      └──────────┘       └──────────────┘
                                   │
                        ┌──────────▼──────────┐
                        │    Candidate Pool     │
                        │  (candidates[] 聚合)   │
                        └──────────┬──────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
    Proxy Sources            Subscriptions           Proxy Pool
  (sources.json)        (CLASH_SUBSCRIBE_URLS)    (PROXY_POOL_URL)
 speedx-socks5           mihomo YAML parser         external HTTP
 speedx-http             SOCKS5/HTTP 节点提取      "proto://ip:port"
 amux (JSON API)
 hproxy
```

### 入口与启动序列

`gate.ts` 的 `main()` 函数执行顺序：

1. `loadKeys()` → 加载 `keys.json`，确保默认 Key 存在
2. `loadSources()` → 加载 `sources.json`，不存在则使用默认源写回文件
3. `loadCustomProxies()` → 加载 `custom_proxies.json`（历史持久化代理）
4. `loadAuditLog()` → 加载最近 500 条审计日志
5. `probeWarp()` → 如果 `WARP_MODE=on`，探活 WARP 作为全局 fallback
6. `loadCandidates()` → 从所有代理源拉取并去重、按 grade+latency 排序
7. `fetchFromProxyPool()` → 从外部 proxy-pool 获取已验证代理（优先使用）
8. `fetchAllSubscriptions()` → 从 Clash 订阅下载节点，合并入候选池
9. `startSubscriptionRefresh()` → 启动 8h 定时订阅刷新
10. `initCustomSlots()` → 探活 `CUSTOM_PROXIES` 中的自定义代理
11. 启动定时刷新候选池（`PROXY_REFRESH_MS`，默认 5 分钟）
12. `server.listen(PORT)` → 启动 HTTP 服务

## 工作原理

### Key 分配与 Slot 池

1. 客户端请求 `Authorization: Bearer <key>` 发往 `/v1/*`
2. `dispatch()` 调用 `getKeySlotPool(keyId)`
   - 若该 Key 已有 Pool → 直接使用（非空）
   - 否则调用 `allocateKeySlots(keyId)`
     - 检查全局 Key 数量 ≤ `MAX_ACTIVE_KEYS`
     - 从未锁定的候选代理中按 grade→latency 排序，取 `SLOTS_PER_KEY * 15` 个
     - 分组并发探活（每次 5 个），直到获得 `SLOTS_PER_KEY` 个可用 Slot
     - 成功 Slot 标记 `lockedBy = keyId`
     - 如果探活全部失败且 WARP 可用，使用 WARP 作为该 Key 的唯一 Slot
3. 响应完成后 `releaseKey(authKey)` 递减并发计数（但 slots 保留）

### 请求调度（dispatch）

每次请求的调度逻辑 `gate.ts:875-1021`：

1. **Round-Robin 选择 Slot**：从 `pool.rrCursor` 开始遍历所有 Slot，跳过已尝试的地址。选中后 `rrCursor` 前移
2. **Pool Slots 耗尽** → 尝试 **WARP Slot**（全局共享）
3. **WARP 不可用** → 尝试 **Custom Slots**（`customSlots[]`，来自 `CUSTOM_PROXIES` env）
4. **均不可用且配置了 `ZENPROXY_KEY`** → **ZenProxy Relay** 兜底
5. **全部失败** → **直连** 兜底

失败处理：
- HTTP 429 或 5xx → `replaceFailedSlot()` 移除该 Slot，从候选池选新代理探活后补入
- 重试 `MAX_RETRIES`（3）次，每次跳过已尝试地址
- 异常或超时同样触发替换

### Slot 替换策略

`replaceFailedSlot(pool, failedAddr)` (`gate.ts:681-712`)：
1. 从 Pool 中移除失败 Slot，释放候选锁定
2. 从 `candidates` 中查找未锁定的代理
3. 异步 `probe()` 探活，成功则 Push 到 Pool 末尾，标记 `lockedBy`

### Round-Robin 调度策略

每个 Key 的 Slot Pool 维护 `rrCursor`，每次 `dispatch()` 选择 Slot 时：

```typescript
const idx = (pool.rrCursor + i) % pool.slots.length;
// ...选中后...
pool.rrCursor = (idx + 1) % pool.slots.length;
```

这确保**每次请求**（而非仅故障时）轮换代理，公平负载均衡。`selectedSlot = null` 时触发 fallback 链向下传递。

## 代理源（Proxy Sources）

### 来源与格式

代理源由 `sources.json` 持久化管理，支持三种类型：

| 类型 | 描述 | Parser |
|------|------|--------|
| `text` | 每行 `ip:port` 的纯文本列表 | `genericTextParser` |
| `json` | JSON 数组，含 `address`, `protocol`, `quality_grade`, `status`, `latency` | 过滤 `S/A/B/C` 且 `active` |
| `subscription` | Clash/mihomo YAML，解析 `proxies[]` 中 type 为 `SOCKS5`/`HTTP` 的节点 | `parseSubscriptionProxyNodes` |

### 默认源

| 名称 | URL | 类型 | 说明 |
|------|-----|------|------|
| `speedx-socks5` | `https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt` | text | SOCKS5 代理列表 |
| `speedx-http` | `https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt` | text | HTTP 代理列表 |
| `amux` | `https://proxy.amux.ai/api/proxies` | json | JSON API，按品质分级 |
| `hproxy` | `https://raw.githubusercontent.com/hproxy-com/free-proxy-list/refs/heads/main/all.txt` | text | HTTP 代理列表 |

### 通过 API 管理

```bash
# 列出所有源
curl http://localhost:13339/api/sources

# 添加新源（必须提供 name + url）
curl -X POST http://localhost:13339/api/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-source","url":"https://example.com/proxies.txt","type":"text"}'

# 删除源
curl -X DELETE http://localhost:13339/api/sources/my-source

# 手动触发候选刷新
curl -X POST http://localhost:13339/api/refresh
```

`type` 可选 `text` 或 `json`。若名称匹配默认源，自动使用对应的 parser；否则 `json` 类型使用 amux parser，`text` 类型使用 `genericTextParser`。

## 订阅系统（Subscription）

### 环境变量

`CLASH_SUBSCRIBE_URLS`（兼容旧名 `CLASH_SUBSCRIBE_URL`）支持逗号或分号分隔的多个订阅 URL：

```bash
CLASH_SUBSCRIBE_URLS="https://example1.com/sub.yaml,https://example2.com/sub.yaml"
```

默认值：`https://raw.githubusercontent.com/ovmvo/FreeSub/refs/heads/main/sub/permanent/mihomo.yaml`

### 解析机制

`parseSubscriptionProxyNodes(yamlText)` (`gate.ts:1807-1829`)：
1. 使用 `js-yaml` 加载 YAML
2. 遍历 `doc.proxies[]`
3. 过滤 `type` 为 `socks5` 或 `http` 的节点
4. 提取 `server:port` 作为 address，设置质量等级为 `A`
5. 去重后合并到 `candidates[]`

### 自动刷新

- 启动时立即拉取一次订阅
- 之后每 8 小时（`SUBSCRIPTION_REFRESH_MS`）定时刷新
- 刷新时仅添加新地址，不影响已有候选

### API 管理

```bash
# 查看当前订阅 URL
curl http://localhost:13339/api/subscriptions

# 运行时替换订阅 URL
curl -X POST http://localhost:13339/api/subscriptions \
  -H 'Content-Type: application/json' \
  -d '{"action":"set","urls":["https://example.com/sub.yaml"]}'

# 恢复默认 URL
curl -X POST http://localhost:13339/api/subscriptions \
  -H 'Content-Type: application/json' \
  -d '{"action":"reset"}'

# 强制立即刷新
curl -X POST http://localhost:13339/api/subscriptions \
  -H 'Content-Type: application/json' \
  -d '{"action":"refresh"}'
```

## WARP 集成

### 配置

```bash
WARP_MODE=off          # on/off，控制是否启用 WARP
WARP_HOST=172.17.0.1   # WARP 容器 SOCKS5 监听地址
WARP_SOCKS5_PORT=1080  # WARP SOCKS5 端口
```

### 工作机制

- WARP 作为**全局共享 fallback**，不独占给某个 Key
- 启动时如果 `WARP_MODE=on`，调用 `probeWarp()` 探活
- `probeWarp(retries=3)` (`gate.ts:515-565`)：使用 SOCKS5 代理请求 `GET /v1/models`，最多重试 3 次，每次间隔 1s
- 成功：设置 `warpSlot`、`warpStatus='running'`，重置连续失败计数
- 失败：指数退避（`backoff = min(60s × failCount, 1h)`），标记 `warpSkipUntil` 跳过后续探活

### 已知限制

- 当前网络环境 WARP 被 GFW 屏蔽：WireGuard UDP 2408 无握手，MASQUE/QUIC 超时，H2/TCP 443 TLS 握手 EOF
- `caomingjun/warp` 容器在该环境下保持 unhealthy

### API 控制

```bash
# 启用 WARP
curl -X POST http://localhost:13339/api/warp \
  -H 'Content-Type: application/json' \
  -d '{"action":"enable","host":"172.17.0.1","port":1080}'

# 禁用 WARP
curl -X POST http://localhost:13339/api/warp \
  -H 'Content-Type: application/json' \
  -d '{"action":"disable"}'
```

## API 参考

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 静态面板（`public/index.html`） |
| `/v1/*`, `/openai/v1/*` | ALL | OpenAI 兼容代理转发 |
| `/api/status` | GET | 完整状态：统计、活跃 Key、Slot、WARP、候选数 |
| `/api/config` | GET | 运行时配置值 |
| `/api/config` | POST | 更新 WARP 模式等 |
| `/api/keys` | GET | 列出所有 API Key 详情 |
| `/api/keys` | POST | 创建新 API Key（自动生成或指定 key） |
| `/api/keys/:key` | PUT | 更新 Key 属性（name/enabled/maxConcurrency/expiresAt） |
| `/api/keys/:key` | DELETE | 删除 Key 并释放 Slot |
| `/api/refresh` | POST | 触发候选池刷新 |
| `/api/candidates/load` | POST | 重新加载候选池（等价于 refresh） |
| `/api/sources/refresh` | POST | 刷新代理源候选 |
| `/api/sources` | GET | 列出代理源 |
| `/api/sources` | POST | 添加代理源 |
| `/api/sources/:name` | DELETE | 删除代理源 |
| `/api/slots/fill` | POST | 手动为指定 Key 分配 Slot |
| `/api/proxies` | GET | 列出候选代理列表（含 lockedBy） |
| `/api/proxies` | POST | 批量添加代理到候选池 |
| `/api/proxies/:addr` | DELETE | 从候选池删除代理（释放关联 Slot） |
| `/api/promote` | POST | 将指定代理提升到候选池首位（`{"addr":"ip:port"}`） |
| `/api/subscriptions` | GET | 查看订阅 URL |
| `/api/subscriptions` | POST | 管理订阅：`set`/`reset`/`refresh` |
| `/api/warp` | POST | 启用/禁用 WARP |
| `/api/models` | GET | 获取缓存的免费模型列表（5 分钟缓存） |
| `/api/audit` | GET | 用量审计聚合（按 Key/Model/日维度） |
| `/api/audit/daily` | GET | 每日审计明细（`?date=2026-07-23`） |
| `/api/logs` | GET | 最近 200 条日志 |

## 配置（环境变量）

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `PORT` | `13339` | HTTP 监听端口 |
| `API_KEY` | `admin123` | 默认管理员 API Key |
| `DATA_DIR` | `cwd()` | 数据持久化目录 |
| `SLOTS_PER_KEY` | `3` | 每个 Key 的 Slot 数（硬编码） |
| `MAX_ACTIVE_KEYS` | `20` | 全局最大活跃 Key 数（硬编码） |
| `TIMEOUT` | `15000` | 普通请求超时（ms） |
| `STREAM_TIMEOUT` | `60000` | 流式请求超时（ms） |
| `MAX_RETRIES` | `3` | 失败后最大重试次数（硬编码） |
| `PROXY_PROBE_TIMEOUT` | `15000` | 代理探活超时（ms） |
| `PROXY_REFRESH_MS` | `300000` | 候选池定时刷新间隔（ms，5 分钟） |
| `WARP_MODE` | `off` | WARP 启用模式：`on`/`off` |
| `WARP_HOST` | `172.17.0.1` | WARP SOCKS5 主机 |
| `WARP_SOCKS5_PORT` | `1080` | WARP SOCKS5 端口 |
| `CUSTOM_PROXIES` | `""` | 逗号分隔的自定义代理地址 |
| `ZENPROXY_RELAY` | `https://zenproxy.top/api/relay` | ZenProxy Relay URL |
| `ZENPROXY_KEY` | `""` | ZenProxy 密钥（为空禁用 relay） |
| `FORCE_RELAY` | `""` | 设为 `1` 时强制使用 relay |
| `PROXY_POOL_URL` | `""` | 外部 proxy-pool API URL |
| `CLASH_SUBSCRIBE_URLS` | FreeSub 默认 YAML | 逗号/分号分隔的订阅 URL |

## Docker 部署

### docker-compose（推荐）

```yaml
services:
  opencode-gate:
    image: opencode-gate:latest
    container_name: opencode-gate
    restart: always
    ports:
      - "13339:13339"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=13339
      - WARP_MODE=off
      - WARP_HOST=172.17.0.1
      - WARP_SOCKS5_PORT=1080
      - API_KEY=admin123
      - DATA_DIR=/app/data
      - PROXY_POOL_URL=http://host.docker.internal:13340/proxies?format=text
      - CLASH_SUBSCRIBE_URLS=https://raw.githubusercontent.com/ovmvo/FreeSub/refs/heads/main/sub/permanent/mihomo.yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### 构建

```bash
docker build -t opencode-gate .
docker compose up -d
```

### docker run

```bash
docker run -d --name opencode-gate \
  -p 13339:13339 \
  -v ./data:/app/data \
  -e API_KEY=admin123 \
  -e WARP_MODE=off \
  opencode-gate:latest
```

### Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN npm install -g tsx --registry=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm install
COPY gate.ts .
COPY public/ public/
CMD ["npx", "tsx", "gate.ts"]
```

使用 `tsx` 直接运行 TypeScript，不加编译步骤。

### Volumes

`./data:/app/data` 持久化以下文件：

| 文件 | 用途 |
|------|------|
| `keys.json` | API Key 记录（含使用量、限额、过期时间） |
| `sources.json` | 代理源列表（添加/删除后自动保存） |
| `custom_proxies.json` | 通过 API 添加的持久化代理 |
| `audit.jsonl` | 逐行追加的审计日志 |

## Slot 调度策略详解

### 分配策略（allocateKeySlots）

```
1. 检查全局 Key 数量 < MAX_ACTIVE_KEYS
2. 从未锁定候选池中按 grade(S/A/B/C) → latency 升序排列
3. 取前 SLOTS_PER_KEY * 15 个作为待探活池
4. 将待探活池分组，每组 groupSize = max(SLOTS_PER_KEY, 5)
5. 每组成员并发探活 probe()，按组序依次处理
6. 每组中探活成功的代理选入 Pool，直到满 SLOTS_PER_KEY 个
7. 若全部失败，回退到 WARP（如果可用）
```

### 调度策略（dispatch）

每请求级别 Round-Robin，而非窄义的"仅故障切换"：

```
1. cursor = pool.rrCursor
2. 遍历 pool.slots[(cursor + i) % n]，选第一个未尝试的
3. 更新 rrCursor = (cursor + 1) % n
4. 请求完成后不重置 cursor
```

这意味着连续请求会依次使用不同代理，天然负载均衡。

### 替换策略（replaceFailedSlot）

```
1. 从 Pool 中移除失败 Slot 的地址
2. 释放该地址的 lockedBy 标记
3. 查找 candidates 中未锁定、未被其他 Slot 占用的地址
4. 异步 probe() 成功后推入 Pool
5. 标记新地址 lockedBy = keyId
```

### 清理策略

定时每 `POOL_CLEANUP_MS`（60s）执行：
- 释放已禁用/过期/超限 Key 的所有 Slot
- 释放空闲超过 `KEY_IDLE_RELEASE_MS`（600s，10 分钟）的 Pool

## 故障排查

### 查看运行状态

```bash
# 完整状态（推荐）
curl http://localhost:13339/api/status | jq .

# 最近 200 条日志
curl http://localhost:13339/api/logs | jq .logs

# Docker 日志
docker logs --tail 50 opencode-gate
```

### 订阅未生效

```bash
# 检查当前订阅 URL
curl http://localhost:13339/api/subscriptions

# 强制刷新
curl -X POST http://localhost:13339/api/subscriptions \
  -H 'Content-Type: application/json' \
  -d '{"action":"refresh"}'

# 检查候选池总数
curl http://localhost:13339/api/status | jq .candidatesCount
```

### WARP 不工作

```bash
# 检查 WARP 状态
curl http://localhost:13339/api/status | jq '{warpAvailable, warpStatus, warpMode}'

# 尝试手动启用（重置退避计数器）
curl -X POST http://localhost:13339/api/warp \
  -H 'Content-Type: application/json' \
  -d '{"action":"enable"}'

# Docker 内检查 WARP 连通性
docker exec opencode-gate wget -q -O- --timeout=5 http://172.17.0.1:1080
```

如果 `warpStatus === 'stopped'` 且 `warpSkipUntil` 未过期，探活会被跳过。可手动 enable 重置计数器。

### Docker 重建

```bash
# 修改 gate.ts 后重建
docker build -t opencode-gate . && docker compose up -d

# 仅修改 docker-compose.yml 配置（无需重建）
docker compose up -d
```

### 性能参考

- 30s 内成功处理约 15 个请求（受代理质量影响）
- 候选池通常 20k-27k 个候选（4 个源 + proxy-pool + 订阅）
- 活跃订阅节点约 129 个 SOCKS5（FreeSub）
- 429 限流触发自动 Slot 替换，不影响后续请求

---

*opencode-gate v0.2.0 — 详见 `gate.ts` 源码注释和 `gate.ts:1-2024` 各模块定义*
