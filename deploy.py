#!/usr/bin/env python3
"""Deploy opencode-gate files to 99.pfnas.top - v2."""
import paramiko
import os, sys, time

HOST = "99.pfnas.top"
PORT = 3336
USER = "spfnas"
PASS = "Qq2290903617."

LOCAL_DIR = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate"
FILES = [
    ("gate.ts", "gate.ts"),
    ("public/index.html", "public/index.html"),
    ("public/style.css", "public/style.css"),
    ("public/app.js", "public/app.js"),
]

def run(ssh, cmd, timeout=15):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    return stdout.read().decode('utf-8', errors='replace').strip()

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15)
    print("[+] Connected")

    # Find project directory
    # Find project directory by checking common paths
    out = run(ssh, "ls /home/spfnas/opencode-gate/gate.ts 2>/dev/null && echo HOME || ls /root/opencode-gate/gate.ts 2>/dev/null && echo ROOT || ls /opt/opencode-gate/gate.ts 2>/dev/null && echo OPT || echo NOTFOUND")
    print(f"[*] Path check: {out[:100]}")

    if "HOME" in out:
        REMOTE = "/home/spfnas/opencode-gate"
    elif "ROOT" in out:
        REMOTE = "/root/opencode-gate"
    elif "OPT" in out:
        REMOTE = "/opt/opencode-gate"
    else:
        REMOTE = "/home/spfnas/opencode-gate"
    print(f"[+] Using remote dir: {REMOTE}")
    
    # Also check where the app is
    for p in ["/home/spfnas/opencode-gate", "/root/opencode-gate", "/opt/opencode-gate", "/app"]:
        out2 = run(ssh, f"ls {p}/gate.ts 2>/dev/null && echo OK || true")
        if "OK" in out2:
            REMOTE = p
            print(f"[+] Found project at: {REMOTE}")
            break
    else:
        REMOTE = "/home/spfnas/opencode-gate"
        print(f"[*] Using: {REMOTE}")

    # Upload files
    sftp = ssh.open_sftp()
    ok = 0
    for local_rel, remote_rel in FILES:
        local = os.path.join(LOCAL_DIR, local_rel).replace('\\', '/')
        remote = f"{REMOTE}/{remote_rel}"
        remote_dir = os.path.dirname(remote)
        try:
            sftp.stat(remote_dir)
        except:
            run(ssh, f"mkdir -p {remote_dir}")
        try:
            sftp.put(local, remote)
            print(f"  [+] {local_rel}")
            ok += 1
        except Exception as e:
            print(f"  [-] {local_rel}: {e}")
    sftp.close()
    print(f"[+] Uploaded {ok}/{len(FILES)}")

    # Restart
    print("[*] Restarting container...")
    out = run(ssh, "docker restart opencode-gate", timeout=30)
    print(f"    {out[:100]}")
    time.sleep(6)

    # Verify
    out = run(ssh, "docker ps --filter name=gate --format '{{.Names}} {{.Status}}'")
    print(f"[*] Status: {out}")

    # Test API via container exec
    out = run(ssh, "docker exec opencode-gate curl -s --connect-timeout 5 http://localhost:13339/api/status | head -c 200", timeout=10)
    print(f"[*] API: {out[:150]}")

    ssh.close()
    print("[+] Deploy complete!")

if __name__ == "__main__":
    main()
