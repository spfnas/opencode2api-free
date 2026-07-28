#!/usr/bin/env python3
"""Deploy opencode-gate with docker cp."""
import paramiko, os, time

HOST = "99.pfnas.top"; PORT = 3336
USER = "spfnas"; PASS = "Qq2290903617."
LOCAL_DIR = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate"

FILES = [
    ("gate.ts", "/app/gate.ts"),
    ("public/index.html", "/app/public/index.html"),
    ("public/style.css", "/app/public/style.css"),
    ("public/app.js", "/app/public/app.js"),
]

def run(ssh, cmd, timeout=15):
    i,o,e = ssh.exec_command(cmd, timeout=timeout)
    o.channel.recv_exit_status()
    return o.read().decode('utf-8', errors='replace').strip()

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    print("[+] Connected")

    # Upload to temp dir
    tmp = "/tmp/opencode-deploy"
    run(ssh, f"mkdir -p {tmp}/public")
    sftp = ssh.open_sftp()
    ok = 0
    for local_rel, _ in FILES:
        local = os.path.join(LOCAL_DIR, local_rel).replace('\\', '/')
        sftp.put(local, f"{tmp}/{local_rel}")
        ok += 1
        print(f"  [+] {local_rel}")
    sftp.close()
    print(f"[+] Uploaded {ok} files to {tmp}")

    # docker cp
    for local_rel, cont_path in FILES:
        out = run(ssh, f"docker cp {tmp}/{local_rel} opencode-gate:{cont_path}", timeout=10)
        print(f"  cp -> {cont_path}")

    # Verify files
    out = run(ssh, "docker exec opencode-gate ls -la /app/public/", timeout=5)
    print(f"[*] Public dir:\n{out}")
    out = run(ssh, "docker exec opencode-gate wc -c /app/gate.ts", timeout=5)
    print(f"[*] gate.ts size: {out}")

    # Restart
    print("[*] Restarting container...")
    out = run(ssh, "docker restart opencode-gate", timeout=30)
    print(f"    {out}")
    time.sleep(8)

    # Verify API via external URL
    print("[*] Checking external API...")
    import urllib.request
    try:
        r = urllib.request.urlopen("https://code.pfnas.top:88/api/status", timeout=10,
            context=__import__('ssl')._create_unverified_context())
        data = r.read().decode()[:200]
        print(f"  {data}")
    except Exception as e:
        print(f"  API check: {e}")

    # Cleanup
    run(ssh, f"rm -rf {tmp}")
    print("[+] Done")

if __name__ == "__main__":
    main()
