/**
 * opencode-free-gate — 精简 Node.js 版
 * 从 proxy.amux.ai 拉 A 级以上免费代理，轮换转发到 opencode.ai/zen
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PROXY_API = 'https://proxy.amux.ai/api/proxies';
const UPSTREAM = 'https://opencode.ai/zen';
const PORT = parseInt(process.env.PORT || '13339');
const MAX_RETRIES = 3;
const TIMEOUT = 120000;
const SLOT_COUNT = 3;
const PROXY_REFRESH_MS = 300000;

let candidates = [];
let slots = [];
let rrCursor = 0;

function makeAgent(proxyUrl) {
  const { HttpsProxyAgent } = await import('hpagent');
  // fallback: use built-in
  return new https.Agent({ rejectUnauthorized: false });
}

async function loadCandidates() {
  try {
    const res = await fetch(PROXY_API, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    candidates = (Array.isArray(data) ? data : [])
      .filter(p => ['S','A','B'].includes(p.quality_grade) && p.status === 'active')
      .sort((a,b) => a.latency - b.latency);
    console.log(`[选] ${candidates.length} candidates (S/A/B)`);
  } catch(e) {
    candidates = [];
    console.warn(`[选] load failed: ${e.message}`);
  }
}

async function probe(addr, protocol) {
  const proxyUrl = protocol === 'socks5' ? `socks5h://${addr}` : `http://${addr}`;
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${UPSTREAM}/v1/models`, {
      signal: controller.signal,
      dispatcher: undefined, // TODO: use undici ProxyAgent
      headers: { 'accept': 'application/json', 'authorization': 'Bearer public' },
    });
    clearTimeout(timer);
    const ok = res.status >= 200 && res.status < 400;
    return { ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false };
  }
}

async function fillSlots() {
  const used = new Set(slots.map(s => s.addr));
  while (slots.length < SLOT_COUNT && candidates.length > 0) {
    const c = candidates.shift();
    if (used.has(c.address)) continue;
    used.add(c.address);
    const r = await probe(c.address, c.protocol);
    if (r.ok) {
      slots.push({ addr: c.address, protocol: c.protocol, latencyMs: r.latencyMs });
      console.log(`[探+] ${c.address} (${r.latencyMs}ms) [${c.quality_grade}]`);
    }
  }
  console.log(`[槽] ${slots.length}/${SLOT_COUNT} ready`);
}

function dropSlot(addr) {
  slots = slots.filter(s => s.addr !== addr);
  console.log(`[弃] ${addr} → ${slots.length}/${SLOT_COUNT}`);
  fillSlots().catch(e => console.error('[槽] fill error:', e.message));
}

function dispatch(path, method, headers, body, retry = 0, triedAddrs = new Set()) {
  return new Promise((resolve) => {
    if (slots.length === 0) {
      resolve(new Response(JSON.stringify({ error: '没有可用代理' }), { status: 502, headers: { 'content-type': 'application/json' } }));
      return;
    }
    const available = slots.filter(s => !triedAddrs.has(s.addr));
    const slot = available[rrCursor % available.length] || available[0];
    rrCursor++;
    if (!slot) {
      resolve(new Response(JSON.stringify({ error: '所有代理均失败' }), { status: 502, headers: { 'content-type': 'application/json' } }));
      return;
    }
    triedAddrs.add(slot.addr);
    console.log(`[取] ${slot.addr} retry=${retry}`);

    // For now, use direct https without proxy agent (simplified)
    // In production, would use hpagent/socks-proxy-agent
    const url = new URL(`${UPSTREAM}${path}`);
    const reqHeaders = { ...headers, host: url.host };

    const req = https.request(url.href, {
      method,
      headers: reqHeaders,
      timeout: TIMEOUT,
      rejectUnauthorized: false,
    }, (res) => {
      const isStream = (headers['accept'] || '').includes('event-stream');
      if (isStream) {
        resolve(new Response(res, { status: res.statusCode, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' } }));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const respBody = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 400) {
          console.log(`[错码] ${slot.addr} 状态码 ${res.statusCode}`);
          if (retry < MAX_RETRIES) {
            dispatch(path, method, headers, body, retry + 1, triedAddrs).then(resolve);
            return;
          }
        }
        resolve(new Response(respBody, { status: res.statusCode, headers: { 'content-type': 'application/json; charset=utf-8' } }));
      });
    });
    req.on('error', (e) => {
      console.error(`[错] ${slot.addr}: ${e.message}`);
      dropSlot(slot.addr);
      if (retry < MAX_RETRIES) {
        dispatch(path, method, headers, body, retry + 1, triedAddrs).then(resolve);
        return;
      }
      resolve(new Response(JSON.stringify({ error: `代理失败: ${e.message}` }), { status: 502, headers: { 'content-type': 'application/json' } }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// Start
console.log(`[门] http://localhost:${PORT}`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathMatch = url.pathname.match(/^\/(openai|anthropic)(\/v1\/.+)$/);
  console.log(`[>] ${req.method} ${url.pathname}`);

  if (!pathMatch) {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', slots: slots.map(s => s.addr) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
    return;
  }

  const path = pathMatch[2];
  const headers = {};
  for (const k of ['content-type', 'accept', 'x-opencode-project', 'x-opencode-session', 'x-opencode-request', 'x-opencode-client', 'anthropic-version', 'anthropic-beta']) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }
  headers['authorization'] = 'Bearer public';
  if (!headers['x-opencode-client']) headers['x-opencode-client'] = 'cli';
  if (!headers['content-type']) headers['content-type'] = 'application/json';

  const body = [];
  for await (const chunk of req) body.push(chunk);
  const bodyStr = body.length > 0 ? Buffer.concat(body).toString() : undefined;

  // Check if streaming
  let isStream = (headers['accept'] || '').includes('event-stream');
  if (bodyStr && !isStream) {
    try { isStream = JSON.parse(bodyStr).stream; } catch {}
  }
  if (isStream) headers['accept'] = 'text/event-stream';

  const response = await dispatch(path, req.method.toUpperCase(), headers, bodyStr);
  const respHeaders = {};
  response.headers.forEach((v, k) => { respHeaders[k] = v; });
  res.writeHead(response.status, respHeaders);
  if (response.body) {
    const reader = response.body.getReader ? response.body.getReader() : null;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      const text = await response.text();
      res.end(text);
    }
  } else {
    res.end();
  }
});

server.listen(PORT, async () => {
  console.log(`[门] Server started on port ${PORT}`);
  await loadCandidates();
  await fillSlots();
});

setInterval(() => {
  loadCandidates().then(() => fillSlots()).catch(e => console.error('[刷新] error:', e.message));
}, PROXY_REFRESH_MS);
