#!/usr/bin/env bun 

/**
 * opencode-free-gate — SingBox 反代网关
 * 去掉公共代理池，改用 sing-box 订阅节点 + 429 自动切换 + 直连兜底
 */

import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';

// ═══════════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════════

interface ApiKeyRecord {
  key: string; name: string; enabled: boolean;
  createdAt: number; lastUsedAt: number;
  totalRequests: number; totalTokens: number;
  maxConcurrency: number; maxRequests: number;
  requestCount: number; expiresAt: number;
}

interface AuditEntry {
  ts: number; keyId: string; model: string;
  promptTokens: number; completionTokens: number; totalTokens: number;
  cacheCreation: number; cacheRead: number;
  latencyMs: number; status: number;
}

// ═══════════════════════════════════════════════════════════
//  持久化文件路径
// ═══════════════════════════════════════════════════════════

const DATA_DIR = process.env.DATA_DIR || process.cwd();
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const MODELS_CACHE_FILE = path.join(DATA_DIR, 'models_cache.json');
const SINGBOX_CONFIG_DIR = path.join(process.cwd(), 'singbox');
const SUBSCRIPTION_FILE = path.join(DATA_DIR, 'subscription.json');

// ═══════════════════════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════════════════════

const UPSTREAM = 'https://opencode.ai/zen';
const PORT = parseInt(process.env.PORT || '13339');
const MAX_RETRIES = 3;
const TIMEOUT = 15000;
const STREAM_TIMEOUT = 300000;

// SingBox 配置
const SINGBOX_HOST = process.env.SINGBOX_HOST || '127.0.0.1';
const SINGBOX_HTTP_PORT = parseInt(process.env.SINGBOX_HTTP_PORT || '10800');
const SINGBOX_SOCKS_PORT = parseInt(process.env.SINGBOX_SOCKS_PORT || '10801');
const SINGBOX_API_PORT = parseInt(process.env.SINGBOX_API_PORT || '9090');
const SINGBOX_MODE = process.env.SINGBOX_MODE || 'on';

const SINGBOX_SOCKS_URL = `socks5h://${SINGBOX_HOST}:${SINGBOX_SOCKS_PORT}`;
const SINGBOX_API_URL = `http://${SINGBOX_HOST}:${SINGBOX_API_PORT}`;

const API_KEY = process.env.API_KEY || 'admin123';
const START_TIME = Date.now();

// ═══════════════════════════════════════════════════════════
//  全局状态
// ═══════════════════════════════════════════════════════════

let apiKeys: Record<string, ApiKeyRecord> = {};
let activeRequests: Record<string, number> = {};
let cachedModels: any[] = [];
let cachedModelsTime = 0;
let stats = { total: 0, success: 0, rateLimited: 0, errors: 0 };
let singboxNodeIndex = 0;
let singboxNodes: string[] = [];
let singboxOk = false;

const recentLogs: string[] = [];
const MAX_LOGS = 500;
const auditLog: AuditEntry[] = [];
const MAX_AUDIT = 10000;

// ═══════════════════════════════════════════════════════════
//  日志捕获
// ═══════════════════════════════════════════════════════════

function logCapture(s: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${s}`;
  recentLogs.push(line);
  if (recentLogs.length > MAX_LOGS) recentLogs.shift();
}
const _origLog = console.log;
console.log = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  logCapture(msg); _origLog.apply(console, args);
};
const _origError = console.error;
console.error = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  logCapture(`❌ ${msg}`); _origError.apply(console, args);
};

// ═══════════════════════════════════════════════════════════
//  上游 Header 白名单（兼容旧 opencode-gate 行为）
//  只转发这些 header，避免把客户端的 UA/accept-encoding 等脏数据传给上游
// ═══════════════════════════════════════════════════════════

const FORWARD = [
  'authorization', 'x-opencode-project', 'x-opencode-session',
  'x-opencode-request', 'x-opencode-client', 'content-type',
  'accept', 'anthropic-version', 'anthropic-beta',
];

function collectHeadersFromReq(nodeReq: http.IncomingMessage): Record<string, string> {
  const h: Record<string, string> = {};
  for (const k of FORWARD) {
    if (k === 'authorization') continue;
    const v = nodeReq.headers[k];
    if (v) h[k] = Array.isArray(v) ? v[0] : v;
  }
  h['authorization'] = 'Bearer public';
  if (!h['x-opencode-client']) h['x-opencode-client'] = 'desktop';
  if (!h['content-type']) h['content-type'] = 'application/json';
  return h;
}

// ═══════════════════════════════════════════════════════════
//  SingBox 管理
// ═══════════════════════════════════════════════════════════

function loadSingboxNodes() {
  try {
    const nodesFile = path.join(SINGBOX_CONFIG_DIR, 'nodes.json');
    if (!fs.existsSync(nodesFile)) {
      singboxNodes = [];
      singboxNodeIndex = 0;
      return;
    }
    const data = JSON.parse(fs.readFileSync(nodesFile, 'utf-8'));
    singboxNodes = data.nodes || [];
    singboxNodeIndex = 0;
    console.log(`[SingBox] 已加载 ${singboxNodes.length} 个节点`);
  } catch (e: any) {
    console.error(`[SingBox] 加载节点失败: ${e.message}`);
    singboxNodes = [];
  }
}

async function initSingboxNode(): Promise<void> {
  if (singboxNodes.length === 0) return;
  const {SocksProxyAgent} = await import('socks-proxy-agent');
  const httpsMod = await import('node:https');
  // 逐个测试节点，找到第一个能连 opencode.ai 的
  const getRes = await fetch(`${SINGBOX_API_URL}/proxies/manual`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  const all = getRes && getRes.ok ? (await getRes.json() as any).all || [] : singboxNodes;
  const maxTest = Math.min(all.length, 60);
  for (let i = 0; i < maxTest; i++) {
    const node = all[i];
    try {
      await fetch(`${SINGBOX_API_URL}/proxies/manual`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: node }),
        signal: AbortSignal.timeout(3000),
      });
      await new Promise(r => setTimeout(r, 150));
    } catch {}
    const agent = new SocksProxyAgent(`socks5h://${SINGBOX_HOST}:${SINGBOX_SOCKS_PORT}`, { timeout: 8000 }) as unknown as https.Agent;
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = httpsMod.request('https://opencode.ai/zen/v1/models', {
          headers: { 'authorization': 'Bearer public', 'x-opencode-client': 'desktop' },
          agent, rejectUnauthorized: false, signal: AbortSignal.timeout(6000),
        }, (r) => { resolve(r.statusCode === 200); });
        req.on('error', () => resolve(false));
        req.end();
      });
      if (ok) {
        singboxOk = true;
        console.log(`[SingBox] 初始化到可用节点: ${node} (index ${i}/${all.length})`);
        return;
      }
    } catch {}
  }
  singboxOk = false;
  console.warn('[SingBox] 前 60 个节点均不可用，将回退直连');
}

async function checkSingboxHealth(): Promise<boolean> {
  if (SINGBOX_MODE !== 'on') { singboxOk = false; return false; }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${SINGBOX_API_URL}/proxies`, { signal: controller.signal });
    clearTimeout(timer);
    singboxOk = res.ok;
    return res.ok;
  } catch {
    singboxOk = false;
    return false;
  }
}

async function switchSingboxNode(tried: Set<string> = new Set()): Promise<string | null> {
  if (SINGBOX_MODE !== 'on') return null;
  try {
    // 获取 manual selector 的全部节点和当前选中
    const getRes = await fetch(`${SINGBOX_API_URL}/proxies/manual`, { signal: AbortSignal.timeout(3000) });
    if (!getRes.ok) return null;
    const data = await getRes.json() as any;
    const all = data.all || [];
    const now = data.now || '';
    if (all.length === 0) return null;
    // 顺序找下一个未尝试的节点
    const startIdx = all.indexOf(now);
    for (let i = 1; i <= all.length; i++) {
      const idx = (startIdx + i) % all.length;
      const node = all[idx];
      if (tried.has(node)) continue;
      const putRes = await fetch(`${SINGBOX_API_URL}/proxies/manual`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: node }),
        signal: AbortSignal.timeout(3000),
      });
      if (putRes.ok) {
        console.log(`[SingBox] 切换节点 → ${node} (${idx}/${all.length})`);
        return node;
      }
    }
    return null;
  } catch (e: any) {
    console.warn(`[SingBox] 切换节点异常: ${e.message}`);
    return null;
  }
}

async function reloadSingboxConfig(): Promise<boolean> {
  if (SINGBOX_MODE !== 'on') return false;
  try {
    // 通过 Docker socket 重启 opengate-singbox 容器
    const sockPath = '/var/run/docker.sock';
    if (!fs.existsSync(sockPath)) {
      console.warn('[SingBox] Docker socket 不可用，跳过重载');
      return false;
    }
    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(sockPath, () => {
        client.write(
          'POST /containers/opengate-singbox/restart HTTP/1.1\r\n' +
          'Host: localhost\r\n' +
          'Content-Length: 0\r\n' +
          '\r\n'
        );
      });
      let resp = '';
      client.on('data', (chunk) => { resp += chunk.toString(); });
      client.on('end', () => {
        if (resp.includes('204') || resp.includes('200')) resolve();
        else reject(new Error(resp.split('\r\n')[0]));
      });
      client.on('error', reject);
      client.setTimeout(10000, () => { client.destroy(); reject(new Error('timeout')); });
    });
    console.log('[SingBox] 配置已重载，容器已重启');
    // 等待 sing-box 启动
    await new Promise(resolve => setTimeout(resolve, 3000));
    await checkSingboxHealth();
    loadSingboxNodes();
    return true;
  } catch (e: any) {
    console.error(`[SingBox] 重载失败: ${e.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  订阅管理
// ═══════════════════════════════════════════════════════════

interface SubscriptionConfig {
  url: string;
  token: string;
  updatedAt: number;
}

function loadSubscription(): SubscriptionConfig | null {
  try {
    if (!fs.existsSync(SUBSCRIPTION_FILE)) return null;
    return JSON.parse(fs.readFileSync(SUBSCRIPTION_FILE, 'utf-8'));
  } catch { return null; }
}

function saveSubscription(sub: SubscriptionConfig) {
  fs.writeFileSync(SUBSCRIPTION_FILE, JSON.stringify(sub, null, 2), 'utf-8');
}

// 生成 sing-box 配置（复用 glm-proxy 的 vless 解析逻辑）
async function generateSingboxConfig(sub: SubscriptionConfig): Promise<number> {
  // 拉取订阅
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let raw: string;
  try {
    const res = await fetch(sub.url, {
      headers: { 'user-agent': 'curl/8.0' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`订阅拉取失败 HTTP ${res.status}`);
    raw = await res.text();
  } catch (e: any) {
    clearTimeout(timer);
    throw new Error(`订阅拉取异常: ${e.message}`);
  }
  clearTimeout(timer);

  // base64 解码
  let decoded = '';
  try {
    const normalized = raw.replace(/\s+/g, '');
    decoded = Buffer.from(normalized, 'base64').toString('utf-8');
    if (!decoded.trim().startsWith('vless://')) throw new Error('not vless');
  } catch {
    decoded = raw;
  }

  // 解析 vless:// 行
  const lines = decoded.split('\n').map(l => l.trim()).filter(Boolean);
  let outbounds: any[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith('vless://')) continue;
    const ob = parseVless(line);
    if (ob && !seen.has(ob['tag'])) {
      seen.add(ob['tag']);
      outbounds.push(ob);
    }
  }
  if (outbounds.length === 0) throw new Error('订阅中未解析到任何 vless 节点');

  // 精简节点数量，降低 urltest 测速对上游/CF 配额的消耗（2026-08-11）
  const MAX_SINGBOX_NODES = 50;
  if (outbounds.length > MAX_SINGBOX_NODES) {
    console.log(`[SingBox] 节点数 ${outbounds.length} 超过上限 ${MAX_SINGBOX_NODES}，精简中...`);
    outbounds = outbounds.slice(0, MAX_SINGBOX_NODES);
  }

  const nodeTags = outbounds.map(o => o['tag']);
  const config = {
    log: { level: 'warn' as const, timestamp: true },
    inbounds: [
      { type: 'http' as const, tag: 'http-in', listen: '0.0.0.0', listen_port: SINGBOX_HTTP_PORT },
      { type: 'socks' as const, tag: 'socks-in', listen: '0.0.0.0', listen_port: SINGBOX_SOCKS_PORT },
    ],
    outbounds: [
      { type: 'selector' as const, tag: 'manual', outbounds: nodeTags, default: nodeTags[0] },
      { type: 'urltest' as const, tag: 'auto', outbounds: nodeTags,
        url: 'https://opencode.ai/zen/v1/models', interval: '40m', tolerance: 100, idle_timeout: '60m' },
      ...outbounds,
      { type: 'direct' as const, tag: 'direct' },
      { type: 'block' as const, tag: 'block' },
    ],
    route: {
      rules: [{ inbound: ['http-in', 'socks-in'], outbound: 'auto' }],
      final: 'auto' as const,
    },
    experimental: {
      clash_api: {
        external_controller: `0.0.0.0:${SINGBOX_API_PORT}`,
        external_ui: '',
        secret: '',
        default_mode: 'rule' as const,
      },
    },
  };

  fs.mkdirSync(SINGBOX_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(SINGBOX_CONFIG_DIR, 'singbox_config.json'), JSON.stringify(config, null, 2), 'utf-8');
  fs.writeFileSync(path.join(SINGBOX_CONFIG_DIR, 'nodes.json'), JSON.stringify({ nodes: nodeTags, count: nodeTags.length }), 'utf-8');
  return nodeTags.length;
}

function parseVless(uri: string): any {
  const body = uri.slice('vless://'.length);
  const withHash = body.split('#', 1)[0] || body;
  const at = withHash.lastIndexOf('@');
  if (at === -1) return null;
  const uuid = withHash.slice(0, at);
  let rest = withHash.slice(at + 1);
  let query = '';
  if (rest.includes('?')) { const i = rest.indexOf('?'); query = rest.slice(i + 1); rest = rest.slice(0, i); }
  const params = Object.fromEntries(new URLSearchParams(query));
  const hostPort = rest.split('?')[0];
  const lastColon = hostPort.lastIndexOf(':');
  const host = hostPort.slice(0, lastColon);
  const port = parseInt(hostPort.slice(lastColon + 1), 10);
  if (!host || isNaN(port)) return null;
  return {
    type: 'vless', tag: `n-${host}-${port}`,
    server: host, server_port: port, uuid,
    tls: {
      enabled: params['security'] === 'tls',
      server_name: params['sni'] || params['host'] || host,
      utls: { enabled: true, fingerprint: params['fp'] || 'chrome' },
    },
    transport: { type: 'ws', path: params['path'] || '/', headers: { Host: params['host'] || host } },
  };
}

// ═══════════════════════════════════════════════════════════
//  Key 管理
// ═══════════════════════════════════════════════════════════

function loadKeys() {
  try {
    if (!fs.existsSync(KEYS_FILE)) {
      apiKeys = {};
      // 默认 key
      const defaultKey = 'sk-default';
      apiKeys[defaultKey] = {
        key: defaultKey, name: 'default', enabled: true,
        createdAt: Date.now(), lastUsedAt: 0,
        totalRequests: 0, totalTokens: 0,
        maxConcurrency: 5, maxRequests: 1000000,
        requestCount: 0, expiresAt: Date.now() + 365 * 86400000,
      };
      saveKeys();
      console.log('[Key] 默认 key 已创建');
      return;
    }
    apiKeys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
    console.log(`[Key] 已加载 ${Object.keys(apiKeys).length} 个 key`);
  } catch (e: any) {
    console.error(`[Key] 加载失败: ${e.message}`);
    apiKeys = {};
  }
}

function saveKeys() {
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(apiKeys, null, 2), 'utf-8');
  } catch (e: any) {
    console.error(`[Key] 保存失败: ${e.message}`);
  }
}

function validateKey(key: string): { valid: boolean; record?: ApiKeyRecord; reason?: string } {
  const record = apiKeys[key];
  if (!record) return { valid: false, reason: 'key 不存在' };
  if (!record.enabled) return { valid: false, reason: 'key 已禁用' };
  if (record.expiresAt !== 0 && Date.now() > record.expiresAt) return { valid: false, reason: 'key 已过期' };
  if (record.maxRequests !== 0 && record.requestCount >= record.maxRequests) return { valid: false, reason: '请求次数已达上限' };
  const current = activeRequests[key] || 0;
  if (record.maxConcurrency !== 0 && current >= record.maxConcurrency) return { valid: false, reason: '并发数已达上限' };
  return { valid: true, record };
}

function acquireKey(key: string) {
  activeRequests[key] = (activeRequests[key] || 0) + 1;
}

function releaseKey(key: string) {
  if (activeRequests[key] > 0) activeRequests[key]--;
}

function recordKeyUsage(key: string, tokens: number) {
  const record = apiKeys[key];
  if (record) {
    record.totalRequests++;
    record.totalTokens += tokens;
    record.requestCount++;
    record.lastUsedAt = Date.now();
    saveKeys();
  }
}

// ═══════════════════════════════════════════════════════════
//  审计日志
// ═══════════════════════════════════════════════════════════

function audit(status: number, latencyMs: number, keyId: string, path: string, body?: string) {
  let model = '';
  let promptTokens = 0, completionTokens = 0, totalTokens = 0;
  let cacheCreation = 0, cacheRead = 0;
  try {
    if (body) {
      const parsed = JSON.parse(body);
      model = parsed.model || '';
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || 0;
        completionTokens = parsed.usage.completion_tokens || 0;
        totalTokens = parsed.usage.total_tokens || 0;
        cacheRead = parsed.usage.prompt_cache_hit_tokens || 0;
      }
    }
  } catch {}
  const entry: AuditEntry = {
    ts: Date.now(), keyId, model, promptTokens, completionTokens, totalTokens,
    cacheCreation, cacheRead, latencyMs, status,
  };
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT) auditLog.shift();
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
}

function loadAuditLog() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return;
    const lines = fs.readFileSync(AUDIT_FILE, 'utf-8').split('\n').filter(Boolean);
    const count = Math.min(lines.length, 500);
    for (let i = lines.length - count; i < lines.length; i++) {
      try { auditLog.push(JSON.parse(lines[i])); } catch {}
    }
    if (auditLog.length > MAX_AUDIT) auditLog.splice(0, auditLog.length - MAX_AUDIT);
    console.log(`[审计] 已加载 ${auditLog.length} 条历史记录`);
  } catch (e: any) {
    console.error(`[审计] 加载失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  模型缓存
// ═══════════════════════════════════════════════════════════

async function fetchModelsFromUpstream(): Promise<any[]> {
  try {
    const res = await fetch(`${UPSTREAM}/v1/models`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const models = data.data || data.models || [];
    cachedModels = models;
    cachedModelsTime = Date.now();
    saveModelsCache();
    return models;
  } catch {
    return cachedModels;
  }
}

function saveModelsCache() {
  try {
    fs.writeFileSync(MODELS_CACHE_FILE, JSON.stringify({ models: cachedModels, time: cachedModelsTime }, null, 2), 'utf-8');
  } catch {}
}

function loadModelsCache() {
  try {
    if (!fs.existsSync(MODELS_CACHE_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(MODELS_CACHE_FILE, 'utf-8'));
    if (data.models) {
      cachedModels = data.models;
      cachedModelsTime = data.time || 0;
      return true;
    }
    return false;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════
//  转发（doHttps / doHttpsStream）
// ═══════════════════════════════════════════════════════════

function doHttps(
  path: string, method: string, headers: Record<string, string>,
  body: string | undefined, agent?: https.Agent,
): Promise<{ status: number; body: string }> {
  const { authorization, Authorization, host, Host, ...cleanHeaders } = headers;
  cleanHeaders['authorization'] = 'Bearer public';
  cleanHeaders['x-opencode-client'] = 'desktop';
  delete cleanHeaders['content-length'];
  delete cleanHeaders['transfer-encoding'];
  delete cleanHeaders['connection'];
  delete cleanHeaders['user-agent'];
  delete cleanHeaders['accept-encoding'];
  delete cleanHeaders['host'];
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    const opts: any = { method, headers: cleanHeaders, signal: ac.signal, rejectUnauthorized: false };
    if (agent) opts.agent = agent;
    const req = https.request(`${UPSTREAM}${path}`, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 200, body: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', reject);
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

function doHttpsStream(
  path: string, method: string, headers: Record<string, string>,
  body: string | undefined, agent?: https.Agent,
): Promise<{ status: number; stream: ReadableStream<Uint8Array>; headers: Record<string, string> }> {
  const { authorization, Authorization, host, Host, ...cleanHeaders } = headers;
  cleanHeaders['authorization'] = 'Bearer public';
  cleanHeaders['x-opencode-client'] = 'desktop';
  delete cleanHeaders['content-length'];
  delete cleanHeaders['transfer-encoding'];
  delete cleanHeaders['connection'];
  delete cleanHeaders['user-agent'];
  delete cleanHeaders['accept-encoding'];
  delete cleanHeaders['host'];
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), STREAM_TIMEOUT);
    const opts: any = { method, headers: cleanHeaders, signal: ac.signal, rejectUnauthorized: false };
    if (agent) opts.agent = agent;
    const req = https.request(`${UPSTREAM}${path}`, opts, (res) => {
      clearTimeout(timer);
      const resHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v) resHeaders[k] = Array.isArray(v) ? v[0] : v;
      }
      res.on('end', () => {});
      res.on('error', () => {});
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          res.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          res.on('end', () => { try { controller.close(); } catch {} });
          res.on('error', (e: Error) => { try { controller.error(e); } catch {} });
        },
      });
      resolve({ status: res.statusCode || 200, stream, headers: resHeaders });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
//  SingBox 出站调度
// ═══════════════════════════════════════════════════════════

async function getSingboxAgent(): Promise<https.Agent | undefined> {
  if (SINGBOX_MODE !== 'on' || !singboxOk) return undefined;
  try {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    return new SocksProxyAgent(SINGBOX_SOCKS_URL, { timeout: TIMEOUT }) as unknown as https.Agent;
  } catch {
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════
//  主请求处理 dispatch
// ═══════════════════════════════════════════════════════════

// 判断是否需要走 sing-box 代理（排除本地直连路径）
function shouldUseProxy(url: string | undefined): boolean {
  if (SINGBOX_MODE !== 'on') return false;
  if (!url) return true;
  const directHosts = ['127.0.0.1', 'localhost', '192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.'];
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return !directHosts.some(h => host.startsWith(h));
}

function extractUsageFromResponse(respBody: string): { tokens: number; model: string } {
  try {
    const parsed = JSON.parse(respBody);
    const model = parsed.model || '';
    const usage = parsed.usage;
    if (usage) {
      return {
        tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
        model,
      };
    }
  } catch {}
  return { tokens: 0, model: '' };
}

async function dispatchNonStream(
  reqPath: string, reqMethod: string, reqHeaders: Record<string, string>,
  reqBody: string, keyId: string,
): Promise<{ status: number; body: string }> {
  // 补 -free 后缀（兼容旧 opencode-gate 行为）
  if (reqBody && reqPath.includes('/chat/completions')) {
    try {
      const parsed = JSON.parse(reqBody);
      if (parsed.model && !parsed.model.endsWith('-free')) {
        parsed.model = parsed.model + '-free';
      }
      reqBody = JSON.stringify(parsed);
    } catch {}
  }
  let lastErr: any = null;
  let directFallback = false;
  const triedNodes = new Set<string>();
  console.log(`[非流式] 开始请求 ${reqPath} singboxOk=${singboxOk} key=${keyId.slice(0,7)}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = Date.now();
    let res: { status: number; body: string };
    try {
      if (directFallback || !singboxOk) {
        res = await doHttps(reqPath, reqMethod, reqHeaders, reqBody);
      } else {
        const agent = await getSingboxAgent();
        if (agent) {
          res = await doHttps(reqPath, reqMethod, reqHeaders, reqBody, agent);
        } else {
          res = await doHttps(reqPath, reqMethod, reqHeaders, reqBody);
        }
      }
    } catch (e: any) {
      lastErr = e;
      if (!directFallback && singboxOk) {
        console.log(`[非流式] 代理连接异常，切换节点: ${e.message?.slice(0, 60) || e}`);
        await switchSingboxNode(triedNodes);
        continue;
      }
      stats.errors++;
      const fb = JSON.stringify({ error: { message: `请求失败: ${e.message || '未知错误'}` } });
      audit(502, 0, keyId, reqPath);
      return { status: 502, body: fb };
    }
    const latency = Date.now() - start;
    console.log(`[非流式] attempt ${attempt} 上游响应 ${res.status} (${latency}ms): ${res.body.slice(0,120)}`);
    if (res.status === 429) {
      stats.rateLimited++;
      console.log(`[429] 上游限流，切换节点 (attempt ${attempt + 1})`);
      if (singboxOk) {
        try {
          const r = await fetch(`${SINGBOX_API_URL}/proxies/manual`, { signal: AbortSignal.timeout(2000) });
          if (r.ok) { const d = await r.json() as any; if (d.now) triedNodes.add(d.now); }
        } catch {}
        await switchSingboxNode(triedNodes);
      }
      if (attempt >= 5) directFallback = true;
      continue;
    }
    if (res.status >= 200 && res.status < 300) stats.success++;
    else if (res.status >= 500) {
      stats.errors++;
      // 500 是上游内部错误，切换节点没用，直接兜底直连
      directFallback = true;
      continue;
    }
    stats.total++;
    audit(res.status, latency, keyId, reqPath, res.body);
    return res;
  }
  // 直连兜底
  try {
    const finalRes = await doHttps(reqPath, reqMethod, reqHeaders, reqBody);
    stats.total++;
    audit(finalRes.status, 0, keyId, reqPath, finalRes.body);
    return finalRes;
  } catch (e: any) {
    lastErr = e;
  }
  stats.errors++;
  const fb = JSON.stringify({ error: { message: `上游请求失败: ${lastErr?.message || '未知错误'}` } });
  audit(502, 0, keyId, reqPath);
  return { status: 502, body: fb };
}async function dispatchStream(
  reqPath: string, reqMethod: string, reqHeaders: Record<string, string>,
  reqBody: string, keyId: string,
): Promise<{ status: number; stream: ReadableStream<Uint8Array>; headers: Record<string, string> }> {
  // 补 -free 后缀（兼容旧 opencode-gate 行为，与非流式一致）
  if (reqBody && reqPath.includes('/chat/completions')) {
    try {
      const parsed = JSON.parse(reqBody);
      if (parsed.model && !parsed.model.endsWith('-free')) {
        parsed.model = parsed.model + '-free';
      }
      reqBody = JSON.stringify(parsed);
    } catch {}
  }
  let lastErr: any = null;
  let directFallback = false;
  const triedNodes = new Set<string>();
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = Date.now();
    let res: { status: number; stream: ReadableStream<Uint8Array>; headers: Record<string, string> };
    try {
      if (directFallback || !singboxOk) {
        res = await doHttpsStream(reqPath, reqMethod, reqHeaders, reqBody);
      } else {
        const agent = await getSingboxAgent();
        if (agent) {
          res = await doHttpsStream(reqPath, reqMethod, reqHeaders, reqBody, agent);
        } else {
          res = await doHttpsStream(reqPath, reqMethod, reqHeaders, reqBody);
        }
      }
    } catch (e: any) {
      lastErr = e;
      if (!directFallback && singboxOk) {
        console.log(`[流式] 代理连接异常，切换节点: ${e.message?.slice(0, 60) || e}`);
        await switchSingboxNode(triedNodes);
        continue;
      }
      stats.errors++;
      const errBody = JSON.stringify({ error: { message: `流式请求失败: ${e.message || '未知错误'}` } });
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(errBody)); controller.close(); } });
      audit(502, 0, keyId, reqPath);
      return { status: 502, stream, headers: {} };
    }
    if (res.status === 429) {
      stats.rateLimited++;
      console.log(`[429] 流式上游限流，切换节点 (attempt ${attempt + 1})`);
      if (singboxOk) {
        try {
          const r = await fetch(`${SINGBOX_API_URL}/proxies/manual`, { signal: AbortSignal.timeout(2000) });
          if (r.ok) { const d = await r.json() as any; if (d.now) triedNodes.add(d.now); }
        } catch {}
        await switchSingboxNode(triedNodes);
      }
      if (attempt >= 5) directFallback = true;
      continue;
    }
    stats.total++;
    if (res.status >= 200 && res.status < 300) stats.success++;
    else if (res.status >= 500) {
      stats.errors++;
      // 500 是上游内部错误，切换节点没用，直接兜底直连
      directFallback = true;
      continue;
    }
    audit(res.status, Date.now() - start, keyId, reqPath);
    return res;
  }
  // 直连兜底
  try {
    const finalRes = await doHttpsStream(reqPath, reqMethod, reqHeaders, reqBody);
    stats.total++;
    audit(finalRes.status, 0, keyId, reqPath);
    return finalRes;
  } catch (e: any) {
    lastErr = e;
  }
  stats.errors++;
  const errBody = JSON.stringify({ error: { message: `流式请求失败: ${lastErr?.message || '未知错误'}` } });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(errBody)); controller.close(); } });
  audit(502, 0, keyId, reqPath);
  return { status: 502, stream, headers: {} };
}function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function json(res: http.ServerResponse, status: number, obj: any) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const PUBLIC_DIR = path.join(process.cwd(), 'public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/** 从 public/ 目录安全地提供静态文件；返回 true 表示已处理响应 */
function serveStatic(res: http.ServerResponse, urlPath: string): boolean {
  try {
    // 解析到 public 目录内的真实路径，防目录穿越
    const safePath = path.normalize(urlPath).replace(/^(\/\/)+/, '/');
    const filePath = path.join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) return false;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  HTTP 服务器
// ═══════════════════════════════════════════════════════════

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const parsed = new URL(url, `http://${req.headers.host || 'localhost'}`);
  const path = parsed.pathname;

  try {
    // ───────────────────────────────────────────────
    //  GET /  — 状态页
    // ───────────────────────────────────────────────
    if (path === '/' && method === 'GET') {
      // 新管理面板：public/index.html 存在则优先返回，否则回退内嵌状态页
      const idxPath = PUBLIC_DIR + '/index.html';
      if (fs.existsSync(idxPath)) {
        const data = fs.readFileSync(idxPath);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(data);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>opencode-gate</title></head>
<body style="font-family:monospace;margin:2em">
<h2>🚀 opencode-gate (SingBox 版)</h2>
<p>运行时间: ${Math.floor((Date.now() - START_TIME) / 1000)}s</p>
<p>SingBox: ${SINGBOX_MODE === 'on' ? (singboxOk ? '✅ 正常' : '❌ 离线') : '⏹️ 关闭'}</p>
<p>节点: ${singboxNodes.length} 个</p>
<p>Key: ${Object.keys(apiKeys).length} 个</p>
<p>请求: ${stats.total} (成功 ${stats.success} / 限流 ${stats.rateLimited} / 错误 ${stats.errors})</p>
<p><a href="/status">/status</a> — <a href="/api/keys">/api/keys</a> — <a href="/api/audit">/api/audit</a> — <a href="/api/logs">/api/logs</a> — <a href="/api/models">/api/models</a></p>
</body></html>`);
      return;
    }

    // ───────────────────────────────────────────────
    //  GET /status  — 简要状态
    // ───────────────────────────────────────────────
    if (path === '/status' && method === 'GET') {
      json(res, 200, {
        uptime: Date.now() - START_TIME,
        singbox: { mode: SINGBOX_MODE, ok: singboxOk, nodes: singboxNodes.length, currentNode: singboxNodeIndex },
        keys: Object.keys(apiKeys).length,
        stats, activeRequests: Object.values(activeRequests).reduce((a, b) => a + b, 0),
        cachedModels: cachedModels.length,
      });
      return;
    }

    // ───────────────────────────────────────────────
    //  GET /api/logs
    // ───────────────────────────────────────────────
    if (path === '/api/logs' && method === 'GET') {
      json(res, 200, { logs: recentLogs.slice(-200) });
      return;
    }

    // ───────────────────────────────────────────────
    //  GET /api/audit
    // ───────────────────────────────────────────────
    if (path === '/api/audit' && method === 'GET') {
      json(res, 200, { audit: auditLog.slice(-500) });
      return;
    }

    // ───────────────────────────────────────────────
    //  GET /api/keys
    // ───────────────────────────────────────────────
    if (path === '/api/keys' && method === 'GET') {
      json(res, 200, { keys: apiKeys });
      return;
    }

    // ───────────────────────────────────────────────
    //  POST /api/keys  — 创建 key
    // ───────────────────────────────────────────────
    if (path === '/api/keys' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const key = body.key || 'sk-' + crypto.randomBytes(16).toString('hex');
      apiKeys[key] = {
        key, name: body.name || 'unnamed', enabled: true,
        createdAt: Date.now(), lastUsedAt: 0,
        totalRequests: 0, totalTokens: 0,
        maxConcurrency: body.maxConcurrency || 5,
        maxRequests: body.maxRequests || 1000000,
        requestCount: 0, expiresAt: body.expiresAt || Date.now() + 365 * 86400000,
      };
      saveKeys();
      json(res, 200, { success: true, key });
      return;
    }

    // ───────────────────────────────────────────────
    //  DELETE /api/keys/:key
    // ───────────────────────────────────────────────
    if (path.startsWith('/api/keys/') && method === 'DELETE') {
      const key = path.slice('/api/keys/'.length);
      if (apiKeys[key]) { delete apiKeys[key]; saveKeys(); json(res, 200, { success: true }); }
      else json(res, 404, { error: 'key 不存在' });
      return;
    }

    // ───────────────────────────────────────────────
    //  GET /api/models
    // ───────────────────────────────────────────────
    if (path === '/api/models' && method === 'GET') {
      json(res, 200, { data: cachedModels, cachedAt: cachedModelsTime });
      return;
    }

    // ───────────────────────────────────────────────
    //  POST /api/models/refresh  — 刷新模型列表
    // ───────────────────────────────────────────────
    if (path === '/api/models/refresh' && method === 'POST') {
      const models = await fetchModelsFromUpstream();
      json(res, 200, { success: true, count: models.length });
      return;
    }

    // ───────────────────────────────────────────────
    //  POST /api/subscription  — 添加订阅
    // ───────────────────────────────────────────────
    if (path === '/api/subscription' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.url) { json(res, 400, { error: 'url 必填' }); return; }
      const sub: SubscriptionConfig = { url: body.url, token: body.token || '', updatedAt: Date.now() };
      try {
        const count = await generateSingboxConfig(sub);
        saveSubscription(sub);
        await reloadSingboxConfig();
        json(res, 200, { success: true, nodes: count, message: `已解析 ${count} 个节点，sing-box 已重载` });
      } catch (e: any) {
        json(res, 500, { error: `生成配置失败: ${e.message}` });
      }
      return;
    }

    // ───────────────────────────────────────────────
    //  GET /api/subscription  — 查看订阅状态
    // ───────────────────────────────────────────────
    if (path === '/api/subscription' && method === 'GET') {
      const sub = loadSubscription();
      json(res, 200, {
        subscription: sub,
        nodes: singboxNodes,
        currentNode: singboxNodes[singboxNodeIndex] || '',
        nodeIndex: singboxNodeIndex,
        singboxOk,
        configFile: fs.existsSync(path.join(SINGBOX_CONFIG_DIR, 'singbox_config.json')),
      });
      return;
    }

    // ───────────────────────────────────────────────
    //  POST /api/singbox/switch  — 手动切换节点
    // ───────────────────────────────────────────────
    if (path === '/api/singbox/switch' && method === 'POST') {
      const node = await switchSingboxNode();
      if (node) json(res, 200, { success: true, node });
      else json(res, 500, { error: '切换失败' });
      return;
    }

    // ───────────────────────────────────────────────
    //  POST /api/singbox/check  — 检查 sing-box 健康
    // ───────────────────────────────────────────────
    if (path === '/api/singbox/check' && method === 'POST') {
      const ok = await checkSingboxHealth();
      json(res, 200, { ok, nodes: singboxNodes.length, currentNode: singboxNodes[singboxNodeIndex] || '' });
      return;
    }

    // ───────────────────────────────────────────────
    //  POST /api/singbox/reload  — 重载 sing-box 配置
    // ───────────────────────────────────────────────
    if (path === '/api/singbox/reload' && method === 'POST') {
      const ok = await reloadSingboxConfig();
      json(res, 200, { success: ok });
      return;
    }

    // ───────────────────────────────────────────────
    //  GET /api/stats  — 详细统计
    // ───────────────────────────────────────────────
    if (path === '/api/stats' && method === 'GET') {
      json(res, 200, {
        stats,
        uptime: Date.now() - START_TIME,
        activeRequests: Object.entries(activeRequests).map(([k, v]) => ({ key: k, count: v })),
        singbox: { ok: singboxOk, nodes: singboxNodes.length },
      });
      return;
    }

    // ───────────────────────────────────────────────
    //  v1/chat/completions  — 非流式
    // ───────────────────────────────────────────────
    if (path === '/v1/chat/completions' && (method === 'POST' || method === 'OPTIONS')) {
      if (method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': '*' }); res.end(); return; }
      const body = await readBody(req);
      const auth = req.headers['authorization'] || '';
      const key = auth.replace(/^Bearer\s+/i, '').trim();
      const v = validateKey(key);
      if (!v.valid) { json(res, 401, { error: { message: v.reason } }); return; }
      acquireKey(key);
      try {
        const parsed = JSON.parse(body);
        const isStream = !!parsed.stream;
        recordKeyUsage(key, 0);
        if (isStream) {
          const result = await dispatchStream(path, method, collectHeadersFromReq(req), body, key);
          res.writeHead(result.status, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
            ...result.headers,
          });
          const reader = result.stream.getReader();
          const pump = async () => {
            try { while (true) { const { done, value } = await reader.read(); if (done) { res.end(); return; } res.write(value); } }
            catch { res.end(); }
          };
          pump();
        } else {
          const result = await dispatchNonStream(path, method, collectHeadersFromReq(req), body, key);
          const usage = extractUsageFromResponse(result.body);
          if (usage.tokens > 0) recordKeyUsage(key, usage.tokens);
          res.writeHead(result.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(result.body);
        }
      } catch (e: any) {
        json(res, 400, { error: { message: `请求解析失败: ${e.message}` } });
      } finally {
        releaseKey(key);
      }
      return;
    }

    // ───────────────────────────────────────────────
    //  v1/* 其他端点 — 代理到上游
    // ───────────────────────────────────────────────
    if (path.startsWith('/v1/')) {
      const auth = req.headers['authorization'] || '';
      const key = auth.replace(/^Bearer\s+/i, '').trim();
      const v = validateKey(key);
      if (!v.valid) { json(res, 401, { error: { message: v.reason } }); return; }
      acquireKey(key);
      try {
        const body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(req);
        const result = await dispatchNonStream(path, method, collectHeadersFromReq(req), body || '', key);
        // /v1/models 只保留 free 模型（兼容旧行为，big-pickle 是隐身免费模型）
        if (path === '/v1/models' && result.status === 200 && result.body) {
          try {
            const parsed = JSON.parse(result.body);
            const all = parsed.data || parsed.models || [];
            const freeModels = all.filter((m: any) => {
              const id = String(m.id || '');
              return id.endsWith('-free') || id === 'big-pickle';
            });
            parsed.data = freeModels;
            parsed.models = freeModels;
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify(parsed));
            return;
          } catch {}
        }
        res.writeHead(result.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(result.body);
      } catch (e: any) {
        json(res, 500, { error: { message: e.message } });
      } finally {
        releaseKey(key);
      }
      return;
    }

    // ───────────────────────────────────────────────
    //  静态文件服务 — public/ 目录（管理面板资源）
    // ───────────────────────────────────────────────
    if (method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/v1/') && path !== '/status' && path !== '/ping') {
      if (serveStatic(res, path)) return;
      // SPA fallback：非 API 路径找不到文件时回退 index.html
      const idxPath = PUBLIC_DIR + '/index.html';
      if (fs.existsSync(idxPath)) {
        const data = fs.readFileSync(idxPath);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(data);
        return;
      }
    }

    // ───────────────────────────────────────────────
    //  404
    // ───────────────────────────────────────────────
    json(res, 404, { error: { message: 'not found' } });

  } catch (e: any) {
    console.error(`[handler] ${e.message}`);
    json(res, 500, { error: { message: e.message } });
  }
}

// ═══════════════════════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════════════════════

const server = http.createServer(handler);

server.on('request', (req, res) => {
  // ping 健康检查
  if (req.url === '/ping') { res.writeHead(200); res.end('pong'); return; }
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n[opencode-gate] SingBox 版启动`);
  console.log(`[opencode-gate] 端口: ${PORT}`);
  console.log(`[opencode-gate] 上游: ${UPSTREAM}`);
  console.log(`[opencode-gate] SingBox: ${SINGBOX_MODE === 'on' ? `Socks5 ${SINGBOX_SOCKS_URL} / API ${SINGBOX_API_URL}` : '关闭'}`);
  console.log(`[opencode-gate] 数据目录: ${DATA_DIR}`);
  console.log(`[opencode-gate] API Key: ${API_KEY}\n`);

  // 加载持久化数据
  loadKeys();
  loadAuditLog();
  if (!loadModelsCache()) await fetchModelsFromUpstream();

  // 初始化 sing-box
  if (SINGBOX_MODE === 'on') {
    loadSingboxNodes();
    const ok = await checkSingboxHealth();
    console.log(`[SingBox] 健康检查: ${ok ? '✅ 正常' : '❌ 离线'}`);
    if (ok) {
      loadSingboxNodes();
      await initSingboxNode();
      if (singboxOk) {
        console.log(`[SingBox] 当前节点: ${singboxNodes[singboxNodeIndex]}`);
      }
    }
  }

  // 定期刷新模型
  setInterval(() => fetchModelsFromUpstream(), 60000);
  // 定期检查 sing-box 健康
  if (SINGBOX_MODE === 'on') {
    setInterval(() => checkSingboxHealth(), 30000);
  }
});

// 优雅关闭
process.on('SIGTERM', () => { console.log('关闭中...'); server.close(); setTimeout(() => process.exit(0), 1000); });
process.on('SIGINT', () => { console.log('关闭中...'); server.close(); setTimeout(() => process.exit(0), 1000); });
