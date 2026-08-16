#!/usr/bin/env python3
"""每日反代 IP 任务：重测反代 IP 池 → 生成 proxyip 订阅 → 更新 opencode-gate

链路（2026-08-12 建立）：
  1. 从两个反代 IP 源拉取并去重
  2. 并发测试反代 IP 可用性（curl --resolve 到 opencode.ai 200）
  3. 可用反代 IP 与 CF 优选入口 IP 配对，生成 VLESS 节点（path 注入 /proxyip=反代IP:443）
  4. 覆盖 public/proxyip_sub.txt（gate 静态服务自拉取）
  5. 触发 opencode-gate POST /api/subscription 重新生成 sing-box 配置

用法: python3 daily_proxyip.py [--subscribe]
      --subscribe   触发 opencode-gate 拉订阅（默认只生成文件）
"""
import subprocess
import concurrent.futures as cf
import sys, time, json, os, base64, binascii

# ── 配置 ──
PROXY_SOURCES = [
    "https://raw.githubusercontent.com/xxzh72/yxym/refs/heads/main/proxyip.txt",
    "https://raw.githubusercontent.com/xgonce/Cloudflare_IP/refs/heads/main/result.csv",
    "https://raw.githubusercontent.com/Xiaobei09/proxyip/refs/heads/main/data/all.txt",
    "https://raw.githubusercontent.com/luuaiyan/CloudflareProxyIP/main/CF-ProxyIP.csv",
    "https://raw.githubusercontent.com/ymyuuu/IPDB/main/BestProxy/proxy.txt",
    "https://ipdb.api.030101.xyz/?type=proxy",
]
ENTRY_FILE = "/home/spfnas/opencode-gate/cf_batch2_test_result.txt"
OUT_FILE = "/home/spfnas/opencode-gate/public/proxyip_sub.txt"
WORK_DIR = "/tmp/proxyip_daily"
UUID = "aa549d69-655a-4d03-83b7-a96b50bf6dc8"
WORKER = "sub.spfnas.dpdns.org"
OPENCODE_TIMEOUT = 8
MAX_WORKERS = 64
TARGET_NODES = 100   # 用户要求：100 个可用节点即可，不够再跑
GATE_BASE = "http://192.168.1.202:13339"
GH_REPO = "spfnas/opencode2api-free"   # GitHub 同步目标（gh api 上传）
GH_FILE = "proxyip_sub.txt"            # GitHub 上的路径
GATE_KEY = "admin123"
SUB_URL = "http://localhost:13339/proxyip_sub.txt"

def fetch_sources():
    all_ips = set()
    for url in PROXY_SOURCES:
        try:
            r = subprocess.run(["curl", "-sL", "-m", "30", url], capture_output=True, text=True, timeout=40)
            if r.returncode != 0: continue
            for line in r.stdout.splitlines():
                line = line.strip().replace("\ufeff", "")
                if not line or line.startswith("#"): continue
                if line.startswith("IP,") or ",cf-meta-ip" in line: continue
                ip = line.split(",")[0].strip()
                # 兼容 ip:port#国家 与 纯 IP
                ip = ip.split(":")[0].split("#")[0].strip()
                if ip and ip.count(".") == 3 and ":" not in ip:
                    all_ips.add(ip)
        except Exception as e:
            print(f"[1/5] 源 {url} 失败: {e}", flush=True)
    print(f"[1/5] 去重后 {len(all_ips)} 个反代 IP", flush=True)
    return sorted(all_ips)

def test_proxy(ip):
    try:
        req = "req_" + binascii.hexlify(os.urandom(8)).decode()
        r = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "--resolve", f"opencode.ai:443:{ip}",
             "--connect-timeout", str(OPENCODE_TIMEOUT),
             "--max-time", str(OPENCODE_TIMEOUT),
             "https://opencode.ai/zen/v1/models",
             "-H", "Authorization: Bearer public",
             "-H", "x-opencode-client: cli",
             "-H", "User-Agent: opencode/1.18.16 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
             "-H", "x-opencode-session: ses_test_proxy",
             "-H", f"x-opencode-request: {req}",
             "-H", "x-opencode-project: prj_test_proxy"],
            capture_output=True, text=True, timeout=OPENCODE_TIMEOUT+3)
        return r.stdout.strip()
    except: return "ERR"

def test_all(all_ips):
    ok_ips, done = [], 0
    print(f"[2/5] 并发测试 {len(all_ips)} 个 (workers={MAX_WORKERS})...", flush=True)
    start = time.time()
    with cf.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(test_proxy, ip): ip for ip in all_ips}
        for f in cf.as_completed(futures):
            if f.result() == "200": ok_ips.append(futures[f])
            done += 1
            if done % 500 == 0: print(f"  进度 {done}/{len(all_ips)} OK={len(ok_ips)}", flush=True)
    print(f"[2/5] 可用 {len(ok_ips)} ({time.time()-start:.0f}s)", flush=True)
    return sorted(ok_ips)

def test_dialog(ip):
    """对话级验证：models 200 不等于能对话，上游按 IP 风控。只测 max_tokens=5 微对话。"""
    try:
        req = "req_" + binascii.hexlify(os.urandom(8)).decode()
        r = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "--resolve", f"opencode.ai:443:{ip}",
             "--connect-timeout", str(OPENCODE_TIMEOUT),
             "--max-time", str(OPENCODE_TIMEOUT+4),
             "-X", "POST", "https://opencode.ai/zen/v1/chat/completions",
             "-H", "Content-Type: application/json",
             "-H", "Authorization: Bearer public",
             "-H", "x-opencode-client: cli",
             "-H", "User-Agent: opencode/1.18.16 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
             "-H", "x-opencode-session: ses_dialog_test",
             "-H", f"x-opencode-request: {req}",
             "-H", "x-opencode-project: prj_dialog_test",
             "-d", '{"model":"deepseek-v4-flash-free","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'],
            capture_output=True, text=True, timeout=OPENCODE_TIMEOUT+6)
        return r.stdout.strip()
    except: return "ERR"

def filter_dialog_ok(ok_ips):
    """从 models 200 的池里串行对话验证，凑满 TARGET_NODES 个能对话的即停。"""
    dialog_ok = []
    for ip in ok_ips:
        code = test_dialog(ip)
        if code == "200":
            dialog_ok.append(ip)
            print(f"    DIALOG OK {ip} ({len(dialog_ok)}/{TARGET_NODES})", flush=True)
            if len(dialog_ok) >= TARGET_NODES:
                break
    print(f"[2b/5] 能对话的反代 IP: {len(dialog_ok)} 个（目标 {TARGET_NODES}）", flush=True)
    return dialog_ok

def geo_annotate(ips):
    """ip-api 批量标注中文国家（lang=zh-CN）。100 个/批，够用即停。"""
    print(f"[2c/5] ip-api 地区标注 ({len(ips)} 个反代 IP)...", flush=True)
    geo = {}
    batch_size = 100
    for i in range(0, len(ips), batch_size):
        batch = ips[i:i+batch_size]
        url = "http://ip-api.com/batch?lang=zh-CN&fields=query,country,countryCode"
        payload = json.dumps([{"query": ip} for ip in batch])
        try:
            r = subprocess.run(["curl", "-s", "-m", "15", "-X", "POST", url,
                                "-H", "Content-Type: application/json",
                                "-d", payload],
                               capture_output=True, text=True, timeout=20)
            data = json.loads(r.stdout)
            for item in data:
                if isinstance(item, dict) and item.get("query"):
                    country = item.get("country", "?")
                    # 统一 ip-api 中文名差异
                    country = {"俄罗斯联邦": "俄罗斯"}.get(country, country)
                    geo[item["query"]] = (country, item.get("countryCode", "?"))
        except Exception as e:
            print(f"[2c/5] geo error: {e}", flush=True)
        time.sleep(1.0)
    print(f"[2c/5] 标注完成: {len(geo)}/{len(ips)}", flush=True)
    return geo


def main():
    do_sub = "--subscribe" in sys.argv
    os.makedirs(WORK_DIR, exist_ok=True)

    all_ips = fetch_sources()
    if len(all_ips) < 50: print("⚠️ 反代 IP 太少，中止"); sys.exit(1)
    models_ok = test_all(all_ips)
    if len(models_ok) < TARGET_NODES: print(f"⚠️ models 200 太少({len(models_ok)}<{TARGET_NODES})，中止；可手动补跑"); sys.exit(1)
    ok_ips = filter_dialog_ok(models_ok)
    if len(ok_ips) < TARGET_NODES: print(f"⚠️ 能对话的太少({len(ok_ips)}<{TARGET_NODES})，中止；可手动补跑"); sys.exit(1)

    # 反代 IP 地理标注（节点名用）
    geo = geo_annotate(ok_ips)

    entry_ips = []
    if os.path.exists(ENTRY_FILE):
        for l in open(ENTRY_FILE):
            l = l.strip()
            if l.startswith("#") or "tcp=OK" not in l: continue
            entry_ips.append(l.split()[0])
    print(f"[3/5] 入口 IP 池: {len(entry_ips)} 个", flush=True)

    # 生成节点（入口不足时截断）
    max_nodes = min(len(ok_ips), len(entry_ips))
    if max_nodes < 50: print("⚠️ 入口太少，中止"); sys.exit(1)
    nodes = []
    for i in range(max_nodes):
        pip = ok_ips[i]
        entry = entry_ips[i]
        nodes.append(f"vless://{UUID}@{entry}:443?security=tls&type=ws&host={WORKER}"
                     f"&fp=firefox&sni={WORKER}&path=%2Fproxyip%3D{pip}%3A443%3Fed%3D2560"
                     f"&encryption=none#" + ((geo.get(pip, ("?", "?"))[1].lower() + " 【" + geo.get(pip, ("?", "?"))[0] + "】 " + pip) if pip in geo else f"proxyip-{i+1}"))
    with open(OUT_FILE, "w") as f:
        f.write("\n".join(nodes) + "\n")
    print(f"[4/5] 订阅已写入 {OUT_FILE} ({len(nodes)} 节点)", flush=True)

    if do_sub:
        print("[5/5] 触发 gate 拉订阅...", flush=True)
        try:
            r = subprocess.run(
                ["curl", "-s", "-m", "90", "-X", "POST",
                 f"{GATE_BASE}/api/subscription",
                 "-H", "X-API-Key: " + GATE_KEY,
                 "-H", "Content-Type: application/json",
                 "-d", json.dumps({"url": SUB_URL})],
                capture_output=True, text=True, timeout=120)
            print(f"[5/5] gate 响应: {r.stdout.strip()[:200]}", flush=True)
        except Exception as e:
            print(f"[5/5] gate 失败: {e}", flush=True)
    # 同步到 GitHub（gh api 走 api.github.com，git push 的 github.com:443 常被 TLS 掐断）
    if do_sub or "--push" in sys.argv:
        try:
            import base64 as b64
            content = open(OUT_FILE, "rb").read()
            # 已存在的文件需要 sha 才能更新；不存在则直接创建
            sha = ""
            g = subprocess.run(["gh", "api", f"repos/{GH_REPO}/contents/{GH_FILE}"],
                               capture_output=True, text=True, timeout=30)
            if g.returncode == 0:
                try:
                    import json as _json
                    sha = _json.loads(g.stdout).get("sha", "")
                except Exception:
                    sha = ""
            args = ["gh", "api", "--method", "PUT",
                    f"repos/{GH_REPO}/contents/{GH_FILE}",
                    "-f", "message=" + time.strftime("daily: proxyip_sub %Y-%m-%d %H:%M (geo)"),
                    "-f", "content=" + b64.b64encode(content).decode(),
                    "-f", "branch=main"]
            if sha:
                args += ["-f", f"sha={sha}"]
            r = subprocess.run(args, capture_output=True, text=True, timeout=90)
            print(f"[6/5] GitHub 推送: {'OK ' + r.stdout[:80] if r.returncode == 0 else 'FAIL ' + r.stderr[-200:]}", flush=True)
        except Exception as e:
            print(f"[6/5] GitHub 推送异常: {e}", flush=True)
    print("\n✅ 每日反代 IP 任务完成", flush=True)

if __name__ == "__main__":
    main()
