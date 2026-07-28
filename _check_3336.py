"""检查 3336 服务器 opencode-gate 状态"""
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode("utf-8", errors="replace").strip(), stderr.read().decode("utf-8", errors="replace").strip()

try:
    print("=== 连接 99.pfnas.top:3336 ===")
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    print("Connected!\n")
    
    # Docker 容器
    out, err = run("docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'")
    print("=== Containers ===")
    print(out)
    
    # Docker 镜像
    out, err = run("docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'")
    print("\n=== Images ===")
    print(out)
    
    # 看看 opencode-gate 目录
    out, err = run("ls -la /home/spfnas/opencode-gate/ 2>/dev/null || echo NOT_FOUND")
    print("\n=== /home/spfnas/opencode-gate/ ===")
    print(out)
    
    # docker-compose.yml 内容
    out, err = run("cat /home/spfnas/opencode-gate/docker-compose.yml 2>/dev/null || echo NOT_FOUND")
    print("\n=== docker-compose.yml ===")
    print(out)

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
