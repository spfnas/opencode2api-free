// ═══════════════════════════════════════════════════════════
//  opencode-free-gate — 工具函数
// ═══════════════════════════════════════════════════════════

import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';
import type { ProxyItem } from './types.js';

// ── 原子写入 ──

export function atomicWrite(filePath: string, data: string): void {
  const tmpPath = filePath + '.tmp' + crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(tmpPath, data, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ── HTTP 工具 ──

export function sendJson(nodeRes: http.ServerResponse, status: number, data: any) {
  const body = JSON.stringify(data);
  nodeRes.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  nodeRes.end(body);
}

export function sendCors(nodeRes: http.ServerResponse) {
  nodeRes.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': '*',
  });
  nodeRes.end();
}

export function accessLog(nodeReq: http.IncomingMessage, status: number, latencyMs: number, extra?: string) {
  const ip = nodeReq.headers['x-forwarded-for'] || nodeReq.socket.remoteAddress || '-';
  const method = nodeReq.method || 'GET';
  const url = nodeReq.url || '/';
  const e = extra ? ` (${extra})` : '';
  console.log(`[access] ${ip} ${method} ${url} -> ${status} ${latencyMs}ms${e}`);
}

export function readBody(nodeReq: http.IncomingMessage): Promise<string> {
  const MAX_BODY_SIZE = 1024 * 1024; // 1MB
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    nodeReq.on('data', (c: Buffer) => {
      totalSize += c.length;
      if (totalSize > MAX_BODY_SIZE) {
        nodeReq.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    nodeReq.on('end', () => {
      if (nodeReq.destroyed) return;
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    nodeReq.on('error', (err) => reject(err));
  });
}

export function collectHeadersFromReq(nodeReq: http.IncomingMessage): Record<string, string> {
  const h: Record<string, string> = {};
  for (let i = 0; i < nodeReq.rawHeaders.length; i += 2) {
    const key = nodeReq.rawHeaders[i].toLowerCase();
    const val = nodeReq.rawHeaders[i + 1];
    if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(key)) continue;
    if (!h[key]) h[key] = val;
  }
  return h;
}

// ── 并发控制 ──

export async function pAll<T>(items: T[], fn: (item: T) => Promise<any>, concurrency: number): Promise<void> {
  let idx = 0;
  const next = async (): Promise<void> => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
}

// ── TCP 连通性检测 ──

export function tcpCheck(address: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    // 解析地址（处理 http://user:pass@ip:port 格式）
    let host = address;
    let port = 80;
    if (address.includes('@')) {
      host = address.split('@')[1];
    }
    if (host.includes('://')) {
      host = host.split('://')[1];
    }
    const parts = host.split(':');
    if (parts.length >= 2) {
      host = parts[0];
      port = parseInt(parts[1], 10);
    }
    if (isNaN(port)) { resolve(false); return; }

    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
    socket.connect(port, host);
  });
}

// ── 通用文本解析 ──

export function genericTextParser(data: string): ProxyItem[] {
  return data.split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      // 支持 http://user:pass@ip:port, socks5://ip:port, ip:port, ip:port@user:pass 等格式
      return /(?:^https?:\/\/|^socks5:\/\/)?(?:(?:[^:@]+)(?::[^@]+)?@)?\d+\.\d+\.\d+\.\d+:\d+/.test(line);
    })
    .map(line => {
      let raw = line;
      let protocol = 'http';
      if (raw.startsWith('socks5://')) { protocol = 'socks5'; raw = raw.slice(9); }
      else if (raw.startsWith('http://') || raw.startsWith('https://')) { raw = raw.split('://')[1]; }
      // 提取纯 address (ip:port)，包含认证信息时取 @ 后面的部分
      let address = raw;
      if (address.includes('@')) address = address.split('@')[1];
      return {
        address: address.startsWith('[') ? address.split(']')[0].slice(1) + address.slice(address.indexOf(']') + 1) : address,
        fullAddr: line,
        protocol,
        latency: 999,
        quality_grade: 'C',
      };
    });
}
