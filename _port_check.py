"""检查3336端口映射和访问方式"""
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

def run(cmd, timeout=15):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode("utf-8", errors="replace").strip()

try:
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    
    with open("port_check.txt", "w", encoding="utf-8") as f:
        # 端口映射
        out = run("docker port opencode-gate")
        f.write("=== Port Mapping ===\n")
        f.write(out + "\n\n")
        
        # 容器网络
        out = run("docker inspect opencode-gate --format '{{json .NetworkSettings.Networks}}' | python3 -m json.tool 2>/dev/null || docker inspect opencode-gate --format '{{json .NetworkSettings.Networks}}'")
        f.write("=== Network ===\n")
        f.write(out + "\n\n")
        
        # 宿主机端口
        out = run("ss -tlnp | grep -E '13339|8080' || netstat -tlnp | grep -E '13339|8080'")
        f.write("=== Listening Ports ===\n")
        f.write(out + "\n\n")
        
        # docker-compose.yml
        out = run("cat /home/spfnas/opencode-gate/docker-compose.yml")
        f.write("=== docker-compose.yml ===\n")
        f.write(out + "\n\n")
        
        # 测试本地访问
        out = run("curl -s -o /dev/null -w '%{http_code}' http://192.168.1.202:13339/ 2>/dev/null")
        f.write("=== Local curl to 192.168.1.202:13339 ===\n")
        f.write("HTTP: " + out + "\n\n")
        
        # 测试 localhost
        out = run("curl -s -o /dev/null -w '%{http_code}' http://localhost:13339/ 2>/dev/null")
        f.write("=== Local curl to localhost:13339 ===\n")
        f.write("HTTP: " + out + "\n")
    
    print("OK")

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
