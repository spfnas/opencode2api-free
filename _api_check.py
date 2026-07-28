"""检查3336服务器API是否正常"""
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

def run(cmd, timeout=15):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode("utf-8", errors="replace").strip()

try:
    ssh.connect("99.pfnas.top", port=3336, username="spfnas", password="Qq2290903617.", timeout=15)
    
    # 测试各个 API 端点
    tests = [
        ("status", "/api/status"),
        ("models", "/api/models"),
        ("keys", "/api/keys"),
        ("proxies", "/api/proxies"),
        ("sources", "/api/sources"),
        ("audit", "/api/audit"),
    ]
    
    with open("api_check.txt", "w", encoding="utf-8") as f:
        for name, path in tests:
            out = run(f"curl -s -H 'Authorization: Bearer admin123' http://192.168.1.202:13339{path} | head -c 200")
            f.write(f"--- {name} ---\n{out}\n\n")
    
    print("OK")

except Exception as e:
    print(f"Error: {e}")
finally:
    ssh.close()
