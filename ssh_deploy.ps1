$password = "Qq2290903617."
$user = "spfnas"
$hostname = "99.pfnas.top"
$port = 3336

# Create process
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "ssh"
$psi.Arguments = "-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p $port $user@$hostname `"echo CONNECTED && docker ps --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null`""
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$p = [System.Diagnostics.Process]::Start($psi)

# Wait a bit for password prompt
Start-Sleep -Milliseconds 1500

# Send password
$p.StandardInput.WriteLine($password)
$p.StandardInput.Close()

# Read output
$output = $p.StandardOutput.ReadToEnd()
$error = $p.StandardError.ReadToEnd()

$p.WaitForExit(10000)

Write-Host "EXIT_CODE: $($p.ExitCode)"
if ($output) { Write-Host "OUTPUT:`n$output" }
if ($error) { Write-Host "STDERR: $error" }
