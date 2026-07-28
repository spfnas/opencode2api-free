#!/usr/bin/env python3
import paramiko
s = paramiko.SSHClient()
s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('99.pfnas.top', 3336, 'spfnas', 'Qq2290903617.', timeout=15)

# Check container working dir
cmds = [
    "docker exec opencode-gate pwd",
    "docker exec opencode-gate ls -la",
    "docker inspect opencode-gate --format='{{.Config.WorkingDir}}'",
    "docker exec opencode-gate ls /app/ 2>/dev/null; docker exec opencode-gate ls /opencode-gate/ 2>/dev/null; echo '---'",
]
for cmd in cmds:
    i,o,e = s.exec_command(cmd, timeout=5)
    out = o.read().decode().strip()[:300]
    print(f"$ {cmd}")
    print(f"  {out}\n")

s.close()
