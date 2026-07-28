"""检查3332服务器并恢复opencode-gate"""
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    # 先测试3332端口
    print("=== 连接3332服务器 ===")
    ssh.connect("33.pfnas.top", port=3332, username="spf", password="123456", timeout=15)
    print("Connected!")
    
    # 检查Docker状态
    stdin, stdout, stderr = ssh.exec_command("docker ps -a --format '{{.Names}} {{.Status}}'")
    print("Containers:", stdout.read().decode("utf-8", errors="replace"))
    
    stdin, stdout, stderr = ssh.exec_command("docker images --format '{{.Repository}}:{{.Tag}}'")
    print("Images:", stdout.read().decode("utf-8", errors="replace"))
    
    # 检查opencode-gate目录
    stdin, stdout, stderr = ssh.exec_command("ls -la /home/spf/opencode-gate/ 2>/dev/null || echo NOT_FOUND")
    print("Directory:", stdout.read().decode("utf-8", errors="replace"))
    
except Exception as e:
    print(f"Connection error: {e}")
finally:
    ssh.close()
