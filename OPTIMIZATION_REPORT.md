# opencode-gate 项目深度调研报告

> 调研日期：2026-07-25
> 文件：`_opencode-gate/gate.ts`（2144行）、`_opencode-gate/public/index.html`、`_opencode-gate/package.json`

---

## 一、项目架构总览

| 维度 | 现状 |
|------|------|
| 运行时 | Bun（单文件 tsx） |
| 后端 | Node.js http 模块手写服务器，2144 行单文件 |
| 前端 | Vanilla JS + 内联 HTML，无框架 |
| 代理协议 | HTTP / SOCKS5 |
| 认证代理 | 支持 `user:pass@ip:port` 格式（fullAddr + address 分离） |
| 测活机制 | TCP 快速筛选（2s）→ HTTP 深度探活（8s） |
| 备用池 | 释放后 IP 进入备用池，连续成功 2 次提拔回活跃池 |
| 持久化 | JSON 文件（keys.json, sources.json, custom_proxies.json, released_candidates.json） |
| 部署 | Docker + macvlan 网络（99.pfnas.top） |

---

## 二、发现的问题与优化点

### 🔴 P0 — 严重问题

#### 1. `dispatch()` 中 `retry` 参数未使用
```typescript
async function dispatch(..., retry = 0, triedAddrs = new Set<string>()): Promise<...> {
```
`retry` 参数声明了但从未在函数体内使用。重试逻辑不完整——当所有 slot 失败后 fallback 到 WARP/自定义 fallback/ZenProxy/直连，但**不会重试**已失败的 slot。

**建议**：实现真正的重试机制，在 fallback 链之后如果仍失败，可重新从 pool 中选未尝试的 slot 重试。

#### 2. `replaceFailedSlot()` 异步竞态
```typescript
probe(replacement).then(r => { ... pool.slots.push(newSlot) ... });
```
`probe()` 是异步的，但 `replaceFailedSlot()` 是同步的。多个并发请求同时触发 `replaceFailedSlot()` 可能导致：
- 同一个 replacement 被分配给多个 pool
- `pool.slots` 在异步回调中被并发修改

**建议**：给 `replaceFailedSlot` 加锁，或改为异步函数。

#### 3. `probe()` 每次创建新 Agent，无连接复用
```typescript
const agent = makeAgent(url, item.protocol as 'http' | 'socks5');
// ... probe 结束
agent.destroy();
```
每个代理探活都新建并销毁 Agent，无法复用 TCP 连接。当候选池有 30000+ 代理时，每次 `refreshCandidates()` 会创建 30000+ 个 Agent 对象。

**建议**：实现 Agent 连接池，按协议/代理地址缓存 Agent 实例。

#### 4. 文件持久化无原子写入
```typescript
fs.writeFileSync(RELEASED_CANDIDATES_FILE, JSON.stringify(data, null, 2), 'utf-8');
```
`writeFileSync` 不是原子的。如果进程在写入中途崩溃，文件会损坏。

**建议**：先写入临时文件，再 `rename` 原子替换。

#### 5. `audit.jsonl` 无轮转机制
审计日志无限增长，最终会撑满磁盘。

**建议**：按天轮转，或限制最大文件大小（如 100MB），超过后截断。

---

### 🟠 P1 — 重要优化

#### 6. `sourceCounts` 显示问题（已知）
API 返回所有源显示相同数量（31175），而非各自独立数量。问题在 `loadCandidates()` 中 `newCounts[s.name] = items.length` 的赋值逻辑——`Promise.allSettled` 的 fulfilled 结果中 `items.length` 是当前源的数量，但所有源共享同一个 `newCounts` 对象。

**建议**：检查 `fetchSource` 返回的数组是否被正确计数，确认 `newCounts` 在每个源独立赋值。

#### 7. `probeReleasedCandidates()` 串行处理
备用池测活是串行的，每个代理都要等 TCP + HTTP 完成。备用池有 100 个代理时，120 秒间隔内可能来不及测活完。

**建议**：使用 `Promise.all` 并发探活，但限制并发数（如 `p-limit` 或手动分批）。

#### 8. `refreshCandidates()` 无并发控制
```typescript
const results = await Promise.allSettled(proxySources.map(async (s) => {
    const items = await fetchSource(s);
```
所有源同时请求，如果源很多且响应慢，会导致大量并发连接。

**建议**：限制并发请求数（如最多 4 个源同时请求）。

#### 9. 前端无实时更新
仪表盘需要手动点击"刷新"按钮才能更新数据。用户体验差。

**建议**：前端加入自动轮询（每 5-10 秒自动刷新仪表盘数据），使用 `setInterval` + `fetchDashboard()`。

#### 10. `doHttpsStream()` 中 Agent 销毁时机不当
```typescript
res.on('end', () => { try { if (agent) agent.destroy(); } catch {} });
res.on('error', () => { try { if (agent) agent.destroy(); } catch {} });
```
Agent 在响应结束后立即销毁，但流式传输可能还在进行。

**建议**：在 `req.on('error')` 和请求完全结束后再销毁 Agent。

---

### 🟡 P2 — 中等优化

#### 11. `genericTextParser` 与 `parseCustomProxies` 重复逻辑
两个函数都做类似的正则匹配和地址清洗：
- `genericTextParser`: 匹配 `ip:port` 纯文本
- `parseCustomProxies`: 匹配 `http://user:pass@ip:port`、`socks5://ip:port`、`ip:port`

**建议**：提取公共的地址解析和清洗逻辑为独立函数。

#### 12. `tcpCheck()` 内部重复地址清洗
```typescript
const atIdx = address.lastIndexOf('@');
const cleanAddr = atIdx >= 0 ? address.substring(atIdx + 1) : address;
```
`probe()` 调用 `tcpCheck` 时传入的地址已经是清洗过的 `cleanAddr`，但 `tcpCheck` 内部又做了一次 `@` 清洗。这是防御性代码，但逻辑冗余。

**建议**：统一在调用 `tcpCheck` 前清洗地址，`tcpCheck` 只做 `ip:port` 解析。

#### 13. `dispatch()` 中 `triedAddrs` 逻辑不完整
```typescript
for (let i = 0; i < pool.slots.length; i++) {
    const idx = (pool.rrCursor + i) % pool.slots.length;
    const s = pool.slots[idx];
    if (!triedAddrs.has(s.addr)) {
```
轮询从 `rrCursor` 开始，但只跳过 `triedAddrs` 中的地址。如果所有 slot 都在 `triedAddrs` 中，会直接 fallback。但 fallback 链（WARP → 自定义 fallback → ZenProxy → 直连）也没有记录到 `triedAddrs`，可能导致重复尝试。

**建议**：将 fallback 链的尝试也记录到 `triedAddrs`，避免重复。

#### 14. `validateKey()` 中 `maxConcurrency` 检查时机不对
```typescript
if (record.maxConcurrency > 0 && (activeRequests[key] || 0) >= record.maxConcurrency) {
    return { ok: false, reason: '并发数已达上限' };
}
```
并发检查在 `acquireKey()` 之前，但 `acquireKey()` 在 `dispatch()` 之后调用。这意味着并发数可能已经超限但仍被分配 slot。

**建议**：在 `acquireKey()` 之前检查并发数，或在 `dispatch()` 中检查。

#### 15. 没有速率限制（Rate Limiting）
API 端点没有任何速率限制，恶意用户可以疯狂调用 `/api/candidates/load` 或 `/api/sources/refresh` 导致服务过载。

**建议**：对 API 端点加入简单的令牌桶或固定窗口速率限制。

#### 16. `ZENPROXY_RELAY` 和 `FORCE_RELAY` 配置硬编码
```typescript
const ZENPROXY_RELAY = process.env.ZENPROXY_RELAY || 'https://zenproxy.top/api/relay';
const ZENPROXY_KEY = process.env.ZENPROXY_KEY || '';
const FORCE_RELAY = process.env.FORCE_RELAY === '1';
```
这些配置在运行时才读取，但没有提供前端界面让用户动态修改（不像 `fallbackProxy` 和 `warpMode`）。

**建议**：在前端配置页面加入 ZenProxy 设置，或通过 `POST /api/config` 支持动态更新。

---

### 🟢 P3 — 体验优化

#### 17. 前端 `index.html` 425 行，无组件化
纯 vanilla JS，所有逻辑在一个 `<script>` 标签中。随着功能增加，维护成本会很高。

**建议**：考虑用微型框架（如 Alpine.js）或至少按功能模块拆分 JS 文件。

#### 18. 前端无错误恢复
前端 `fetch` 调用没有统一错误处理，网络中断后用户只能看到"加载中..."。

**建议**：加入全局 `fetch` 包装器，统一处理网络错误、超时、重试。

#### 19. 前端无数据缓存
每次切换 tab 都重新请求 API，即使数据没变。

**建议**：前端加入简单的内存缓存，tab 切换时优先显示缓存数据，后台静默刷新。

#### 20. 没有健康检查端点
`/api/status` 返回的是运行状态，但不是专门的健康检查。Kubernetes/Docker 健康检查需要专门的端点。

**建议**：加入 `/api/health` 端点，返回 `{ status: 'ok', uptime, version }`。

#### 21. 没有优雅关闭
进程收到 SIGTERM/SIGINT 时直接退出，正在进行的请求会被中断。

**建议**：监听 `process.on('SIGTERM', ...)` 和 `process.on('SIGINT', ...)`，等待进行中的请求完成后再退出。

#### 22. 没有日志级别控制
所有日志都 `console.log`，生产环境日志量太大。

**建议**：加入日志级别（DEBUG/INFO/WARN/ERROR），通过环境变量控制。

#### 23. `DOCKER_BUILDKIT` 缓存利用不充分
Dockerfile 使用 `COPY gate.ts /app/gate.ts`，每次代码变更都会使缓存失效。

**建议**：将 `package.json` 和 `package-lock.json` 的 COPY 放在 gate.ts 之前，利用 Docker 层缓存。

---

## 三、架构优化建议

### 3.1 代码拆分
2144 行单文件难以维护。建议拆分为：
```
gate.ts          # 主入口，启动 HTTP 服务器
src/
  types.ts       # ProxyItem, Slot, KeySlotPool 等类型定义
  config.ts      # 环境变量解析和默认值
  proxy.ts       # 代理管理（候选池、备用池、加载）
  probe.ts       # TCP/HTTP 探活逻辑
  dispatch.ts    # 请求分发和重试逻辑
  api/
    routes.ts    # API 路由定义
    handlers.ts  # 各端点的处理函数
  persist.ts     # 文件持久化（原子写入）
  audit.ts       # 审计日志
```

### 3.2 引入连接池
```typescript
// 代理连接池
class ProxyAgentPool {
  private pool: Map<string, https.Agent> = new Map();
  getAgent(url: string, proto: 'http' | 'socks5'): https.Agent {
    const key = `${proto}://${url}`;
    if (!this.pool.has(key)) {
      this.pool.set(key, makeAgent(url, proto));
    }
    return this.pool.get(key)!;
  }
  destroy() {
    for (const agent of this.pool.values()) agent.destroy();
    this.pool.clear();
  }
}
```

### 3.3 引入配置中心
将硬编码的常量提取为可动态更新的配置对象：
```typescript
interface GateConfig {
  port: number;
  maxActiveKeys: number;
  slotsPerKey: number;
  proxyRefreshMs: number;
  probeTimeout: number;
  tcpCheckTimeout: number;
  releasedProbeInterval: number;
  keyIdleReleaseMs: number;
  poolCleanupMs: number;
  maxRetries: number;
  upstreamTimeout: number;
  streamTimeout: number;
}
```

### 3.4 引入指标导出
```typescript
// /api/metrics 端点（Prometheus 格式）
app.get('/api/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP proxy_candidates_total Total candidate proxies
# TYPE proxy_candidates_total gauge
proxy_candidates_total ${candidates.length}
# HELP proxy_slots_active Active slots
# TYPE proxy_slots_active gauge
${keySlotPools.size * SLOTS_PER_KEY}
`);
});
```

---

## 四、远程部署状态（99.pfnas.top）

| 项目 | 状态 |
|------|------|
| 容器 `opencode-gate` | ✅ 运行中（已用新 gate.ts 重建） |
| 容器 `opencode-warp` | ✅ 运行中（healthy） |
| 网络 | macvlan `qwrt_macnet` |
| Gate IP | 192.168.1.202:13339 |
| WARP IP | 192.168.1.201:1080 |
| 候选代理数 | ~29903 |
| 备用池 | 0（暂无释放的 IP） |
| Fallback | 尚未配置 |

---

## 五、优先级排序

| 优先级 | 优化项 | 影响 |
|:------:|--------|:----:|
| P0 | dispatch 重试机制 | 高 |
| P0 | replaceFailedSlot 异步竞态 | 高 |
| P0 | 文件持久化原子写入 | 高 |
| P0 | audit.jsonl 轮转 | 高 |
| P1 | 探活并发控制 | 中 |
| P1 | 前端自动轮询 | 中 |
| P1 | sourceCounts 修复 | 中 |
| P1 | Agent 连接复用 | 中 |
| P2 | 代码拆分 | 低 |
| P2 | 速率限制 | 低 |
| P2 | 日志级别控制 | 低 |
| P3 | 前端组件化 | 低 |
| P3 | 优雅关闭 | 低 |
| P3 | Prometheus 指标导出 | 低 |
