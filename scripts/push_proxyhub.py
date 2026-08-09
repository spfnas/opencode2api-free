#!/usr/bin/env python3
"""
爬取 proxyhub.me 全部免费代理页，过滤出 opencode-gate 支持的协议
（http/socks5），通过 POST /api/proxies 推送到 opencode-gate。
上游 opencode-gate 运行时只支持 socks5/http 两分支，SOCKS4 会跳过。
"""
import re, sys, time, json, urllib.request

BASE = "https://proxyhub.me/zh/all-free-proxy-list.html"
GATE = "http://192.168.1.202:13339/api/proxies"
TOTAL_PAGES = 100
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")

log = open("/home/spfnas/opencode-gate/scripts/proxyhub_push.log", "a", encoding="utf-8")

def out(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, file=sys.stderr)
    log.write(line + "\n")
    log.flush()

def fetch(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8", errors="ignore")
        except Exception as e:
            if i == retries - 1:
                out(f"  拉取失败 {url}: {e}")
                return None
            time.sleep(2)

def parse_page(html):
    rows = []
    m = re.search(r"<tbody[^>]*>(.*?)</tbody>", html, re.S)
    if not m:
        return rows
    for tr in re.findall(r"<tr>.*?</tr>", m.group(1), re.S):
        ip_m = re.search(r'ip-text"[^>]*>([\d.]+)', tr)
        port_m = re.search(r'port-text">(\d+)', tr)
        if not ip_m or not port_m:
            continue
        protos = re.findall(r'protocol-chip[^"]*"[^>]*title="([^"]+)"', tr)
        rows.append((ip_m.group(1), port_m.group(1), protos))
    return rows

def push(proxies):
    """proxies: list of 'ip:port' or 'socks5://ip:port'"""
    if not proxies:
        out("  无代理可推送")
        return 0
    body = json.dumps({"proxies": proxies}).encode()
    req = urllib.request.Request(GATE, data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read().decode())
            out(f"  推送成功: {resp}")
            return resp.get("count", 0)
    except Exception as e:
        out(f"  推送失败: {e}")
        return 0

def main():
    out("========== 开始爬取 proxyhub.me ==========")
    seen = set()
    http, socks5 = [], []
    for page in range(1, TOTAL_PAGES + 1):
        url = BASE if page == 1 else f"{BASE}?page={page}"
        html = fetch(url)
        if not html:
            out(f"  page {page}: 跳过")
            continue
        rows = parse_page(html)
        for ip, port, protos in rows:
            ep = f"{ip}:{port}"
            if ep in seen:
                continue
            seen.add(ep)
            up = [p.upper() for p in protos]
            if any("SOCKS5" in p for p in up):
                socks5.append(f"socks5://{ep}")
            elif any(p in ("HTTP", "HTTPS", "HTTP/HTTPS", "SSL") for p in up):
                http.append(ep)
            # SOCKS4 等跳过
        if page % 10 == 0:
            out(f"  已抓 {page}/{TOTAL_PAGES} 页, 累计 http+{len(http)} socks5+{len(socks5)}")
        time.sleep(0.8)

    out(f"抓取完成: HTTP/HTTPS {len(http)} 条, SOCKS5 {len(socks5)} 条")
    # 分批推送（每批 500）
    added = 0
    for batch in [http[i:i+500] for i in range(0, len(http), 500)]:
        added += push(batch)
    for batch in [socks5[i:i+500] for i in range(0, len(socks5), 500)]:
        added += push(batch)
    out(f"========== 本次新增 {added} 条代理 ==========\n")

if __name__ == "__main__":
    main()
