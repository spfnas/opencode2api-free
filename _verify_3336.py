"""最终验证 3336 opencode-gate"""
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    time.sleep(8)
    
    # 容器日志
    stdin, stdout, stderr = ssh.exec_command("docker logs opencode-gate --tail 25 2>&1")
    log = stdout.read().decode("utf-8", errors="replace").strip()
    
    # 健康检查
    stdin, stdout, stderr = ssh.exec_command("curl -s http://192.168.1.202:13339/api/health 2>/dev/null | head -c 300")
    health = stdout.read().decode("utf-8", errors="replace").strip()
    
    stdin, stdout, stderr = ssh.exec_command("curl -s -H 'Authorization: Bearer admin123' http://192.168.1.202:13339/v1/models 2>/dev/null | head -c 500")
    models = stdout.read().decode("utf-8", errors="replace").strip()
    
    # 容器状态
    stdin, stdout, stderr = ssh.exec_command("docker ps --filter name=opencode --format 'table {{.Names}}\t{{.Status}}'")
    ps = stdout.read().decode("utf-8", errors="replace").strip()
    
    with open("verify_3336.txt", "w", encoding="utf-8") as f:
        f.write("=== Containers ===\n")
        f.write(ps)
        f.write("\n\n=== Logs ===\n")
        f.write(log)
        f.write("\n\n=== Health ===\n")
        f.write(health)
        f.write("\n\n=== Models ===\n")
        f.write(models)
    
    print("OK")

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
