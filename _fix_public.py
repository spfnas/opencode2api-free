"""更新宿主机的 public/app.js"""
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    print("Connected!")
    
    # 上传修复后的 app.js
    sftp = ssh.open_sftp()
    local = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate\public\app.js"
    remote = "/home/spfnas/opencode-gate/public/app.js"
    sftp.put(local, remote)
    print("Uploaded app.js")
    
    # 也上传 index.html 确保一致
    local_html = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate\public\index.html"
    remote_html = "/home/spfnas/opencode-gate/public/index.html"
    sftp.put(local_html, remote_html)
    print("Uploaded index.html")
    
    # 上传 style.css
    local_css = r"C:\Users\Administrator\.qwenpaw\workspaces\default\_opencode-gate\public\style.css"
    remote_css = "/home/spfnas/opencode-gate/public/style.css"
    sftp.put(local_css, remote_css)
    print("Uploaded style.css")
    
    sftp.close()
    
    # 重启容器让新文件生效
    stdin, stdout, stderr = ssh.exec_command(
        "docker restart opencode-gate 2>&1",
        timeout=30
    )
    print("Restart:", stdout.read().decode("utf-8", errors="replace").strip())
    
    import time
    time.sleep(5)
    
    # 验证
    stdin, stdout, stderr = ssh.exec_command("docker logs opencode-gate --tail 10 2>&1")
    print("Logs:", stdout.read().decode("utf-8", errors="replace").strip())

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
