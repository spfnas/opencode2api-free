"""构建本地 opencode-gate 镜像并部署到 3336"""
import subprocess, paramiko, time, os

WORKSPACE = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate"

def shell(cmd, timeout=300):
    print(f"$ {cmd}")
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=WORKSPACE, timeout=timeout)
    if r.stdout.strip(): print(r.stdout.strip()[-500:])
    if r.stderr.strip(): print(r.stderr.strip()[-500:])
    return r.returncode

print("=== Step 1: Build Docker Image ===")
shell("docker build -t opencode-gate-local:latest .", timeout=300)

print("\n=== Step 2: Save Image to Tar ===")
tar_path = os.path.join(WORKSPACE, "opencode-gate.tar")
if os.path.exists(tar_path):
    os.remove(tar_path)
shell(f"docker save opencode-gate-local:latest -o \"{tar_path}\"", timeout=300)
size_mb = os.path.getsize(tar_path) / 1024 / 1024
print(f"Image size: {size_mb:.1f} MB")

print("\n=== Step 3: Transfer to 3336 ===")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
print("SSH Connected!")

# 上传 tar
sftp = ssh.open_sftp()
remote_tar = "/home/spfnas/opencode-gate/opencode-gate.tar"
print(f"Uploading {size_mb:.1f}MB...")
sftp.put(tar_path, remote_tar)
sftp.close()
print("Upload done!")

print("\n=== Step 4: Load Image & Redeploy ===")
stdin, stdout, stderr = ssh.exec_command(
    "cd /home/spfnas/opencode-gate && "
    "docker load -i opencode-gate.tar && "
    "docker stop opencode-gate 2>/dev/null; docker rm opencode-gate 2>/dev/null; "
    "docker compose up -d --force-recreate 2>&1",
    timeout=120
)
out = stdout.read().decode("utf-8", errors="replace").strip()
err = stderr.read().decode("utf-8", errors="replace").strip()
print("Deploy output:", out)
if err: print("Deploy err:", err)

time.sleep(5)

print("\n=== Step 5: Verify ===")
stdin, stdout, stderr = ssh.exec_command("docker logs opencode-gate --tail 15 2>&1")
print("Logs:", stdout.read().decode("utf-8", errors="replace").strip())

stdin, stdout, stderr = ssh.exec_command("docker ps --filter name=opencode-gate --format '{{.Names}} {{.Status}}'")
print("Status:", stdout.read().decode("utf-8", errors="replace").strip())

ssh.close()

# 清理本地 tar
os.remove(tar_path)
print("\n=== DONE ===")
