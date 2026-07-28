#!/usr/bin/env python3
"""Deploy opencode-gate with docker cp - v3."""
import paramiko, os, time

HOST = "99.pfnas.top"
PORT = 3336
USER = "spfnas"
PASS = "Qq2290903617."

LOCAL_DIR = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate"
FILES = [
    ("gate.ts", "/app/gate.ts"),
    ("public/index.html", "/app/public/index.html"),
    ("public/style.css", "/app/public/style.css"),
    ("public/app.js", "/app/public/app.js"),
]

def run(ssh, cmd, timeout=15):
    i,o,e = ssh.exec_command(cmd, timeout=timeout)
    exit_code = o.channel.recv_exit_status()
    return o.read().decode('utf-8', errors='replace').strip()

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    print("[+] Connected")

    sftp = ssh.open_sftp()
    
    # Upload to temp dir on host
    tmp = "/tmp/opencode-deploy"
    run(ssh, f"mkdir -p {tmp}/public")
    
    ok = 0
    for local_rel, _ in FILES:
        local = os.path.join(LOCAL_DIR, local_rel).replace('\\', '/')
        remote_tmp = f"{tmp}/{local_rel}"
        try:
            sftp.put(local, remote_tmp)
            print(f"  [+] {local_rel}")
            ok += 1
        except Exception as e:
            print(f"  [-] {local_rel}: {e}")
    sftp.close()
    print(f"[+] Uploaded {ok}/{len(FILES)} to {tmp}")

    # docker cp into container
    print("[*] Copying into container...")
    for local_rel, container_path in FILES:
        src = f"{tmp}/{local_rel}"
        out = run(ssh, f"docker cp {src} opencode-gate:{container_path}", timeout=10)
        print(f"  cp {local_rel} -> {container_path}")

    # Make sure public dirs are complete
    run(ssh, "docker exec opencode-gate ls -la /app/public/", timeout=5)

    # Restart
    print("[*] Restarting container...")
    out = run(ssh, "docker restart opencode-gate", timeout=30)
    print(f"    -> {out[:100]}")
    time.sleep(6)

    # Verify via host curl (inside container won't have curl)
    out = run(ssh, "docker ps --filter name=gate --format '{{.Names}} {{.Status}}'")
    print(f"[*] Status: {out}")

    # Cleanup temp
    run(ssh, f"rm -rf {tmp}")
    print("[+] Temp files cleaned")

    # Verify API
    out = run(ssh, "docker exec opencode-gate wget -qO- --timeout=5 http://127.0.0.1:13339/api/status 2>/dev/null | head -c 300 || true", timeout=10)
    if out:
        print(f"[*] API: {out[:200]}")
    
    print("[+] Deploy complete!")

if __name__ == "__main__":
    main()
