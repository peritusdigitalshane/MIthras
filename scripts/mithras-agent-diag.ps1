<#
.SYNOPSIS
    Diagnose why the Mithras Threat Defence agent installer might not be enrolling.
.DESCRIPTION
    Run from an elevated PowerShell on the target endpoint. Produces a readable
    summary and writes a transcript to %TEMP%\mithras-agent-diag.txt.
    Does NOT install or modify anything.
.NOTES
    Paste-and-run friendly:
      iwr https://api.mithras.com.au/agent/mithras-agent-diag.ps1 -UseBasicParsing | iex
    or save and run:
      .\mithras-agent-diag.ps1
#>
[CmdletBinding()]
param(
    [string]$ApiBase = "https://api.mithras.com.au",
    [string]$BinaryPath = "/agent/peritus-secure-agent-0.3.2.zip"
)

$ErrorActionPreference = "Continue"
$Out = Join-Path $env:TEMP "mithras-agent-diag.txt"
Start-Transcript -Path $Out -Force | Out-Null

function Section($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function OK($t)      { Write-Host "  [ OK ] $t" -ForegroundColor Green }
function WARN($t)    { Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function FAIL($t)    { Write-Host "  [FAIL] $t" -ForegroundColor Red }
function INFO($t)    { Write-Host "         $t" -ForegroundColor Gray }

Write-Host ""
Write-Host "Mithras Threat Defence — endpoint diagnostic" -ForegroundColor White
Write-Host "Run at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') on $env:COMPUTERNAME" -ForegroundColor Gray
Write-Host "Transcript: $Out" -ForegroundColor Gray

# 1. Elevation
Section "1. Elevation"
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { OK "Running as Administrator" }
else          { FAIL "NOT elevated. install-agent.ps1 requires elevation. Re-open PowerShell as Administrator." }

# 2. PowerShell + .NET
Section "2. PowerShell environment"
INFO  ("PowerShell version : {0}" -f $PSVersionTable.PSVersion)
INFO  ("Edition            : {0}" -f $PSVersionTable.PSEdition)
INFO  ("OS                 : {0}" -f (Get-CimInstance Win32_OperatingSystem).Caption)
INFO  ("OS build           : {0}" -f (Get-CimInstance Win32_OperatingSystem).BuildNumber)
$tlsOk = [Net.ServicePointManager]::SecurityProtocol -band [Net.SecurityProtocolType]::Tls12
if ($tlsOk) { OK "TLS 1.2 available" }
else        { WARN "TLS 1.2 not currently enabled in this session — enabling for the run"; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }

# 3. Execution policy
Section "3. Execution policy"
Get-ExecutionPolicy -List | ForEach-Object {
    $line = "{0,-18} : {1}" -f $_.Scope, $_.ExecutionPolicy
    if ($_.Scope -eq "MachinePolicy" -and $_.ExecutionPolicy -eq "Restricted") { FAIL $line }
    elseif ($_.ExecutionPolicy -in @("Restricted","AllSigned"))                { WARN $line }
    else                                                                       { INFO $line }
}

# 4. DNS resolution
Section "4. DNS — resolve api.mithras.com.au"
try {
    $dns = Resolve-DnsName -Name "api.mithras.com.au" -Type A -ErrorAction Stop
    foreach ($r in ($dns | Where-Object { $_.IPAddress })) {
        OK ("A record -> {0}" -f $r.IPAddress)
    }
} catch {
    FAIL ("Resolve-DnsName failed: {0}" -f $_.Exception.Message)
    # Fallback to system resolver
    try {
        $ip = [System.Net.Dns]::GetHostAddresses("api.mithras.com.au") | Select-Object -First 1
        INFO ("system resolver -> {0}" -f $ip)
    } catch {
        FAIL ("system resolver also failed: {0}" -f $_.Exception.Message)
    }
}

# 5. TCP reachability
Section "5. TCP reach — api.mithras.com.au:443"
try {
    $tcp = Test-NetConnection -ComputerName "api.mithras.com.au" -Port 443 -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {
        OK ("Port 443 reachable (RTT: {0} ms, via {1})" -f $tcp.PingReplyDetails.RoundtripTime, $tcp.SourceAddress.IPAddress)
    } else {
        FAIL "Port 443 NOT reachable. Firewall / proxy blocking outbound HTTPS?"
        INFO ("Hop list trace: {0}" -f ($tcp.TraceRoute -join " -> "))
    }
} catch {
    FAIL ("Test-NetConnection threw: {0}" -f $_.Exception.Message)
}

# 6. TLS handshake + cert sanity
Section "6. TLS handshake to $ApiBase"
try {
    $h = Invoke-WebRequest -Uri "$ApiBase/auth/v1/settings" -Method Head -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    OK ("HTTPS handshake OK — status {0}" -f $h.StatusCode)
} catch {
    if ($_.Exception.Response) {
        OK ("TLS handshake OK; got HTTP {0} (expected for unauthenticated probe)" -f [int]$_.Exception.Response.StatusCode)
    } else {
        FAIL ("Could not establish HTTPS: {0}" -f $_.Exception.Message)
    }
}

# 7. Binary download (the actual install step that hasn't been happening)
Section "7. Agent binary download — $BinaryPath"
$zip = Join-Path $env:TEMP "peritus-secure-agent-diagtest.zip"
try {
    $url = "$ApiBase$BinaryPath"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
    $sw.Stop()
    $size = (Get-Item $zip).Length
    OK ("Downloaded {0} bytes in {1} ms" -f $size, $sw.ElapsedMilliseconds)
    $sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    INFO ("SHA256: {0}" -f $sha)
    $expected = "323bca0b462752963eb694acf17acb4b8320caeae9e82c8d039c6070de11ba4b"
    if ($sha -eq $expected) { OK "SHA256 matches the server-known value" }
    else                    { WARN ("SHA256 mismatch — expected {0}" -f $expected) }
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
} catch {
    FAIL ("Download failed: {0}" -f $_.Exception.Message)
    if ($_.Exception.Response) {
        INFO ("HTTP status: {0}" -f [int]$_.Exception.Response.StatusCode)
    }
}

# 8. Prior install state
Section "8. Prior install footprint on this machine"
$AgentRoot   = "C:\ProgramData\PeritusSecure"
$InstallRoot = Join-Path $AgentRoot "install"
$ConfigFile  = Join-Path $AgentRoot "config.dat"
$LogDir      = Join-Path $AgentRoot "logs"
INFO ("AgentRoot exists  : {0}" -f (Test-Path $AgentRoot))
INFO ("InstallRoot exists: {0}" -f (Test-Path $InstallRoot))
INFO ("config.dat exists : {0}" -f (Test-Path $ConfigFile))
$svc = Get-Service -Name "PeritusSecureAgent" -ErrorAction SilentlyContinue
if ($svc) {
    INFO ("Service status    : {0} (StartType={1})" -f $svc.Status, $svc.StartType)
    $svcDetail = Get-CimInstance Win32_Service -Filter "Name='PeritusSecureAgent'" -ErrorAction SilentlyContinue
    if ($svcDetail) {
        INFO ("Service PathName : {0}" -f $svcDetail.PathName)
        INFO ("Service Account  : {0}" -f $svcDetail.StartName)
    }
} else {
    INFO "Service           : not installed"
}

# 9. Recent install / service logs (if any)
Section "9. Recent agent / NSSM logs"
if (Test-Path $LogDir) {
    Get-ChildItem $LogDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | ForEach-Object {
        INFO ("{0,-30}  {1,8} bytes  {2}" -f $_.Name, $_.Length, $_.LastWriteTime)
    }
    $latest = Get-ChildItem $LogDir -Filter "*.log" -File -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        Write-Host ""
        INFO ("Tail of {0}:" -f $latest.Name)
        Get-Content $latest.FullName -Tail 25 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }
} else {
    INFO "No log directory yet — agent has never started on this machine."
}

# 10. Proxy + system trust info that often breaks the install silently
Section "10. Proxy / WinHTTP / trust"
INFO ("WinHTTP proxy : {0}" -f ((netsh winhttp show proxy) -join "; ").Trim())
$ieProxy = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue)
if ($ieProxy) {
    INFO ("WinINET proxy : ProxyEnable={0} ProxyServer={1}" -f $ieProxy.ProxyEnable, $ieProxy.ProxyServer)
}
$caCount = (Get-ChildItem Cert:\LocalMachine\Root -ErrorAction SilentlyContinue | Measure-Object).Count
INFO ("Trusted root certs in machine store: {0}" -f $caCount)

Stop-Transcript | Out-Null

Write-Host ""
Write-Host "================================================================" -ForegroundColor White
Write-Host " Diagnostic complete. Full transcript: $Out" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor White
