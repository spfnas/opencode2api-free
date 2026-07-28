import https from 'node:https';
import http from 'node:http';
import { HttpsProxyAgent } from 'hpagent';

const UPSTREAM = 'https://opencode.ai/zen/v1/models';

async function main() {
  // Test 1: HttpsProxyAgent with HTTP proxy
  console.log('=== Test 1: HttpsProxyAgent + HTTP proxy ===');
  const agent1 = new HttpsProxyAgent({
    proxy: 'http://174.137.134.182:2999',
    keepAlive: false,
    timeout: 15000,
  });
  await new Promise<void>((resolve) => {
    const req = https.request(UPSTREAM, {
      method: 'GET',
      headers: { accept: 'application/json' },
      agent: agent1,
      rejectUnauthorized: false,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`  Status: ${res.statusCode}`);
        console.log(`  Body: ${d.slice(0, 100)}`);
        resolve();
      });
    });
    req.on('error', e => { console.log(`  Error: ${e.message}`); resolve(); });
    req.end();
  });

  // Test 2: Direct HTTPS
  console.log('\n=== Test 2: Direct HTTPS ===');
  await new Promise<void>((resolve) => {
    const req = https.request(UPSTREAM, {
      method: 'GET',
      headers: { accept: 'application/json' },
      rejectUnauthorized: false,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`  Status: ${res.statusCode}`);
        console.log(`  Body: ${d.slice(0, 100)}`);
        resolve();
      });
    });
    req.on('error', e => { console.log(`  Error: ${e.message}`); resolve(); });
    req.end();
  });

  // Test 3: Try with socks5 proxy
  console.log('\n=== Test 3: SocksProxyAgent + SOCKS5 proxy ===');
  try {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    const agent3 = new SocksProxyAgent({
      hostname: '206.123.156.223',
      port: 10810,
      type: 5,
      timeout: 15000,
    });
    await new Promise<void>((resolve) => {
      const req = https.request(UPSTREAM, {
        method: 'GET',
        headers: { accept: 'application/json' },
        agent: agent3 as unknown as https.Agent,
        rejectUnauthorized: false,
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          console.log(`  Status: ${res.statusCode}`);
          console.log(`  Body: ${d.slice(0, 100)}`);
          resolve();
        });
      });
      req.on('error', e => { console.log(`  Error: ${e.message}`); resolve(); });
      req.end();
    });
  } catch(e) {
    console.log(`  Import error: ${e}`);
  }
}

main().catch(e => console.error(e));
