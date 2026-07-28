# opencode-free-gate — 项目简介（Stitch 前端设计参考）

## 1. 项目概述

**opencode-free-gate** 是一个 Per-Key IP Pool 反代网关，用于将 opencode.ai/zen 的免费模型通过代理 IP 轮换实现无限免费额度。

### 核心架构

```
用户请求 → opencode-gate → 代理IP轮换 → opencode.ai上游
                    ↑
              WARP (全局fallback)
```

**关键机制：**
- 每个 API Key 拥有独立的代理 slot 池（默认 3 slot/Key，最多 20 活跃 Key）
- 上游是 IP 认证配额，代理 IP 轮换 = 免费额度无限
- 失败自动替换 slot，超时自动释放
- WARP 作为全局共享 fallback
- 候选代理自动加载、探活、替换；空闲 Key 自动释放 slot

### 技术栈

- **后端：** Bun/TypeScript (gate.ts)
- **前端：** 纯 HTML/CSS/JS (public/)
- **部署：** Docker Compose + macvlan 网络
- **数据持久化：** JSON 文件 (keys.json, sources.json, audit.jsonl 等)

---

## 2. 前端页面结构（7个页面）

### 2.1 仪表盘 (Dashboard)

**功能：** 系统总览、Key 槽位状态、发送测试

**数据卡片：**
- 运行时间
- 总请求数 / 成功率
- 活跃 Key 数 / 最大 Key 数
- 候选代理数
- WARP 状态
- 槽位就绪数

**Key 槽位表格：**
- Key 名称/标识
- 每个 slot 的地址、延迟、质量等级
- 最后使用时间

**操作按钮：**
- 🔄 刷新代理源
- 🔧 填充槽位
- 📦 加载候选

**测试区域：**
- 模型选择
- 消息输入
- API Key 选择
- 发送按钮 + 结果展示

---

### 2.2 用量审计 (Audit)

**功能：** 请求统计、按 Key/模型/日期统计

**汇总卡片：**
- 总请求数
- 总 Token 数
- 输入 Token
- 输出 Token
- 缓存命中率

**按 Key 统计表格：**
| 字段 | 说明 |
|------|------|
| Key 名称 | 自定义名称 |
| Key | 脱敏显示 (前7位...后4位) |
| 请求数 | 该 Key 的总请求数 |
| Token | 该 Key 的总 Token 消耗 |
| 最后使用 | 时间戳 |

**按模型统计表格：**
| 字段 | 说明 |
|------|------|
| 模型 | 如 deepseek-v4-flash |
| 请求数 | 该模型的调用次数 |
| 输入 | prompt tokens |
| 输出 | completion tokens |
| 总 Token | 总计 |
| 缓存 | cache read tokens |

**每日统计表格：**
| 字段 | 说明 |
|------|------|
| 日期 | YYYY-MM-DD |
| 请求数 | 当日请求数 |
| 总 Token | 当日总消耗 |
| 输入/输出/缓存 | 分项统计 |
| 详情 | 按钮，点击查看当日详情 |

**调用详情（按日期）：**
| 字段 | 说明 |
|------|------|
| 时间 | HH:MM:SS |
| 模型 | 使用的模型 |
| 输入/输出 Token | 分项 |
| 延迟 | 响应时间 (ms) |
| 状态 | HTTP 状态码 |

---

### 2.3 密钥管理 (Keys)

**功能：** API Key 的增删改查

**Key 列表表格：**
| 字段 | 说明 |
|------|------|
| 名称 | 自定义名称 |
| Key | 脱敏显示 |
| 状态 | active/disabled/expired |
| 并发 | 当前/最大 (0=不限) |
| 已用/限额 | 请求数限制 |
| Token | 累计消耗 |
| 到期 | 到期日期 |
| 操作 | 编辑/复制/禁用启用/删除 |

**创建/编辑弹窗字段：**
- 名称
- 最大并发 (0=不限)
- 最大请求数 (0=不限)
- 到期日期 (留空=永不过期)

---

### 2.4 代理池 (Proxies)

**功能：** 查看和管理当前活跃的代理

**活跃代理表格：**
| 字段 | 说明 |
|------|------|
| 地址 | IP:Port |
| 协议 | http/socks5 |
| 延迟 | 响应时间 (ms) |
| 质量等级 | S/A/B/C/D/F |
| 锁定 Key | 被哪个 Key 占用 |

**备用候选池表格：**
| 字段 | 说明 |
|------|------|
| 地址 | IP:Port |
| 协议 | http/socks5 |
| 质量等级 | S/A/B/C/D/F |
| 连续失败 | 失败次数 |
| 连续成功 | 成功次数 |

**操作按钮：**
- ➕ 添加代理
- 🔍 测活备用池
- ⬆️ 提拔备用池

---

### 2.5 代理源 (Sources)

**功能：** 管理代理数据源

**源列表表格：**
| 字段 | 说明 |
|------|------|
| 名称 | 如 speedx-socks5, hproxy |
| 类型 | text/json |
| 数量 | 已加载的代理数 |
| 状态 | 正常/错误 |

**创建弹窗字段：**
- 名称
- URL
- 类型 (text/json)

---

### 2.6 配置 (Config)

**功能：** 系统参数配置

**配置项：**
- 端口 (PORT)
- 每 Key slot 数 (SLOTS_PER_KEY)
- 最大活跃 Key 数 (MAX_ACTIVE_KEYS)
- WARP 模式 (on/off)
- WARP 地址
- WARP 端口
- Fallback 代理地址

**操作：**
- 保存配置
- 重新加载
- 测试 Fallback 代理

---

### 2.7 日志 (Logs)

**功能：** 实时日志查看

**日志区域：**
- 自动滚动
- 最近 200 条日志
- 10秒自动刷新

---

## 3. API 端点列表

### 管理 API（需要认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/status | 系统状态概览 |
| GET | /api/logs | 最近日志 |
| GET | /api/audit | 审计汇总 |
| GET | /api/audit/daily?date=YYYY-MM-DD | 每日审计详情 |
| GET | /api/models | 模型列表 |
| GET | /api/keys | 密钥列表 |
| POST | /api/keys | 创建密钥 |
| PUT | /api/keys/:key | 更新密钥 |
| DELETE | /api/keys/:key | 删除密钥 |
| POST | /api/warp | 切换 WARP |
| POST | /api/refresh | 刷新代理 |
| POST | /api/slots/fill | 填充槽位 |
| GET | /api/proxies | 活跃代理列表 |
| POST | /api/proxies | 添加代理 |
| POST | /api/promote | 提拔备用池 |
| POST | /api/released/probe | 测活备用池 |
| POST | /api/fallback/test | 测试 Fallback |
| GET | /api/sources | 代理源列表 |
| POST | /api/sources | 添加代理源 |
| DELETE | /api/sources/:name | 删除代理源 |
| GET | /api/config | 获取配置 |
| POST | /api/config | 更新配置 |
| POST | /api/config/reload | 重新加载配置 |
| POST | /api/candidates/load | 加载候选代理 |
| POST | /api/sources/refresh | 刷新代理源 |

### 代理转发 API（需要 Key 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | /v1/chat/completions | OpenAI 兼容聊天 |
| GET | /v1/models | 模型列表 |
| * | /v1/* | 其他 OpenAI 兼容端点 |
| * | /openai/v1/* | OpenAI 路径别名 |

---

## 4. 数据模型

### API Key Record
```typescript
{
  key: string;           // 完整 key
  name: string;          // 自定义名称
  enabled: boolean;      // 是否启用
  createdAt: number;     // 创建时间戳
  lastUsedAt: number;    // 最后使用时间戳
  totalRequests: number; // 总请求数
  totalTokens: number;   // 总 Token 消耗
  maxConcurrency: number; // 最大并发 (0=不限)
  maxRequests: number;   // 最大请求数 (0=不限)
  requestCount: number;  // 当前请求计数
  expiresAt: number;     // 过期时间戳 (0=永不过期)
}
```

### Proxy Item
```typescript
{
  address: string;       // IP:Port
  fullAddr?: string;     // 完整地址 (含认证)
  protocol: string;      // http/socks5
  latency: number;       // 延迟 (ms)
  quality_grade: string; // S/A/B/C/D/F
}
```

### Audit Entry
```typescript
{
  ts: number;            // 时间戳
  keyId: string;         // API Key
  model: string;         // 模型名
  promptTokens: number;  // 输入 Token
  completionTokens: number; // 输出 Token
  totalTokens: number;   // 总 Token
  cacheRead: number;     // 缓存读取
  latencyMs: number;     // 响应延迟
  status: number;        // HTTP 状态码
}
```

### Proxy Source
```typescript
{
  name: string;          // 源名称
  url: string;           // 源 URL
  type: 'text' | 'json'; // 解析类型
  parser: Function;      // 解析函数
}
```

---

## 5. 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 13339 | 监听端口 |
| WARP_MODE | off | WARP 模式 (on/off) |
| WARP_HOST | 192.168.1.201 | WARP 容器地址 |
| WARP_SOCKS5_PORT | 1080 | WARP SOCKS5 端口 |
| API_KEY | admin123 | 管理 API 认证 Key |
| SLOTS_PER_KEY | 3 | 每 Key slot 数 |
| MAX_ACTIVE_KEYS | 20 | 最大活跃 Key 数 |
| DATA_DIR | /app/data | 数据目录 |

---

## 6. 部署架构

```
┌─────────────────────────────────────────────┐
│                Docker Compose               │
│  ┌─────────────┐  ┌─────────────────────┐   │
│  │ opencode-warp│  │   opencode-gate     │   │
│  │ 192.168.1.201│  │  192.168.1.202      │   │
│  │  WARP 代理   │←─│  反代网关 (:13339)  │   │
│  └─────────────┘  └─────────────────────┘   │
│         ↕                ↕                  │
│    qwrt_macnet (macvlan 192.168.1.0/24)     │
└─────────────────────────────────────────────┘
         ↕
    外部访问 (code.pfnas.top:88 反代)
```

### 持久化目录
```
/home/spfnas/opencode-gate/
├── docker-compose.yml
├── gate.ts
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── data/
    ├── keys.json
    ├── sources.json
    ├── custom_proxies.json
    ├── audit.jsonl
    ├── released_candidates.json
    └── fallback_proxy.json
```

---

## 7. 前端设计建议

### 布局
- **左侧边栏：** 导航菜单（7个页面）
- **主内容区：** 页面内容
- **响应式：** 移动端侧边栏可折叠

### 配色方案
- 亮色主题：#f0f2f5 背景，#fff 卡片
- 暗色主题：#0f172a 背景，#1e293b 卡片
- 主色调：#2979ff (蓝色)

### 组件建议
- **统计卡片：** 用于汇总数据展示
- **数据表格：** 用于列表数据展示
- **模态弹窗：** 用于创建/编辑操作
- **Toast 通知：** 用于操作反馈
- **骨架屏：** 用于加载状态
- **实时日志：** 用于日志查看

### 交互建议
- 表格支持排序
- 卡片支持 hover 效果
- 按钮点击有 loading 状态
- 操作有 Toast 反馈
- 日志自动滚动
- 主题切换（亮/暗）

---

## 8. 可用模型列表

| 模型 ID | 说明 |
|---------|------|
| deepseek-v4-flash | DeepSeek V4 Flash |
| mimo-v2.5 | MIMO V2.5 |
| ling-3.0-flash | Ling 3.0 Flash |
| nemotron-3-ultra | Nemotron 3 Ultra |
| north-mini-code | North Mini Code |
| laguna-s-2.1 | Laguna S 2.1 |

---

## 9. 质量等级说明

| 等级 | 说明 |
|------|------|
| S | 优质（延迟 <100ms） |
| A | 良好（延迟 <300ms） |
| B | 一般（延迟 <500ms） |
| C | 较差（延迟 <1000ms） |
| D | 差（延迟 <2000ms） |
| F | 失败（不可用） |

---

## 10. 调用示例

```bash
# 使用 API Key 调用
curl http://localhost:13339/v1/chat/completions \
  -H "Authorization: Bearer admin123" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "hello"}]
  }'

# 获取模型列表
curl http://localhost:13339/v1/models \
  -H "Authorization: Bearer admin123"

# 获取系统状态
curl http://localhost:13339/api/status \
  -H "Authorization: Bearer admin123"
```

---

**项目仓库：** _opencode-gate/ 目录
**本地地址：** http://127.0.0.1:13339
**远程地址：** https://code.pfnas.top:88
**管理 Key：** admin123
