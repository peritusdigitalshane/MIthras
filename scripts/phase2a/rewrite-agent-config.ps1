# Rewrite C:\ProgramData\PeritusSecure\config.dat so api_base_url points to a new value.
# Must be run as Administrator. Uses DPAPI LocalMachine — must run on the same machine
# that wrote the config originally.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$NewApiBaseUrl
)

$ConfigPath = 'C:\ProgramData\PeritusSecure\config.dat'
if (-not (Test-Path $ConfigPath)) { throw "Config not found at $ConfigPath" }

Import-Module 'C:\ProgramData\PeritusSecure\install\lib\SecureConfig.psm1' -Force

$cfg = Read-SecureConfig -Path $ConfigPath
Write-Host "Current api_base_url: $($cfg['api_base_url'])"
$cfg['api_base_url'] = $NewApiBaseUrl
Save-SecureConfig -Path $ConfigPath -Config $cfg
$verify = Read-SecureConfig -Path $ConfigPath
Write-Host "Rewrote api_base_url to: $($verify['api_base_url'])"
