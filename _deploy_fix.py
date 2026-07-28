"""传输并部署修复版到3336"""
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    print("Connected!")
    
    # 上传 tar
    sftp = ssh.open_sftp()
    tar = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate\opencode-gate.tar"
    print("Uploading 67MB...")
    sftp.put(tar, "/home/spfnas/opencode-gate/opencode-gate.tar")
    sftp.close()
    print("Uploaded!")
    
    # 重建容器
    stdin, stdout, stderr = ssh.exec_command(
        "cd /home/spfnas/opencode-gate && "
        "docker load -i opencode-gate.tar && "
        "docker stop opencode-gate 2>/dev/null; docker rm opencode-gate 2>/dev/null; "
        "docker compose up -d --force-recreate 2>&1",
        timeout=60
    )
    out = stdout.read().decode("utf-8", errors="replace").strip()
    print("Deploy:", out[:300])
    
    time.sleep(5)
    
    # 验证
    stdin, stdout, stderr = ssh.exec_command("docker logs opencode-gate --tail 10 2>&1")
    print("Logs:", stdout.read().decode("utf-8", errors="replace").strip())

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
