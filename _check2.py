#!/usr/bin/env python3
import paramiko
s = paramiko.SSHClient()
s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('99.pfnas.top', 3336, 'spfnas', 'Qq2290903617.', timeout=15)

# Check public dir
i,o,e = s.exec_command("docker exec opencode-gate ls -la /app/public/", timeout=5)
print("Public dir:", o.read().decode().strip())

# Also check if there's an index.html
i,o,e = s.exec_command("docker exec opencode-gate head -c 200 /app/public/index.html", timeout=5)
print("Index.html:", o.read().decode().strip()[:200])

s.close()
