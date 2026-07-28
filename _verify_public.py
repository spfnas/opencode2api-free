"""验证前端文件是否正确"""
import paramiko, base64

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    
    # 检查 app.js 是否还有 fetchAuditDaily
    stdin, stdout, stderr = ssh.exec_command("grep -c 'fetchAuditDaily' /home/spfnas/opencode-gate/public/app.js")
    count = stdout.read().decode("utf-8", errors="replace").strip()
    
    # 检查文件大小
    stdin, stdout, stderr = ssh.exec_command("wc -l /home/spfnas/opencode-gate/public/app.js")
    lines = stdout.read().decode("utf-8", errors="replace").strip()
    
    print(f"fetchAuditDaily count: {count}")
    print(f"app.js lines: {lines}")

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
