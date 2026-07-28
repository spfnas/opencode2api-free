$password = "Qq2290903617."
$user = "spfnas"
$hostname = "99.pfnas.top"
$port = 3336
$cmd = "echo CONNECTED && docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Windows\System32\OpenSSH\ssh.exe"
$psi.Arguments = "-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 -p $port $user@$hostname $cmd"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)
Start-Sleep -Milliseconds 2000
$p.StandardInput.WriteLine($password)
$p.StandardInput.Close()
$output = $p.StandardOutput.ReadToEnd()
$err = $p.StandardError.ReadToEnd()
$p.WaitForExit(15000)

if ($output) { Write-Host "OUT:$output" }
if ($err) { Write-Host "ERR:$err" }
Write-Host "EXIT:$($p.ExitCode)"
