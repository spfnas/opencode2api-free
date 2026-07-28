"""检查3336服务器opencode-gate日志和状态"""
import paramiko, base64, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode("utf-8", errors="replace").strip(), stderr.read().decode("utf-8", errors="replace").strip()

try:
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    print("Connected!\n")
    
    # 容器日志
    out, err = run("docker logs opencode-gate --tail 30 2>&1")
    print("=== Container Logs ===")
    print(out)
    if err: print(err)
    
    # 健康检查
    print("\n=== Health Check ===")
    out, err = run("curl -s http://localhost:13339/api/health 2>/dev/null | head -c 500")
    print("Health:", out)
    
    out, err = run("curl -s -H 'Authorization: Bearer admin123' http://localhost:13339/v1/models 2>/dev/null | head -c 500")
    print("Models:", out)

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
