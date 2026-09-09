<#
.SYNOPSIS
    Mithras Personal — one-line install for home subscribers.

.DESCRIPTION
    Loaded by the customer pasting:

        iwr -UseBasicParsing "https://api.mithras.com.au/storage/v1/object/public/agent-bundles/install-personal.ps1" | iex
        Install-MithrasPersonal -Code "<enrolment code from welcome email>"

    Defines the Install-MithrasPersonal function. When invoked it:

      1. Verifies the shell is elevated (the underlying install-agent.ps1
         needs admin to create the Windows service).
      2. Downloads the canonical install-agent.ps1 to %TEMP%.
      3. Invokes it with the home-user code as the enrolment token, against
         api.mithras.com.au (the production API).

    Kept deliberately small — every line here is read by the home user in
    the elevated PowerShell window. If something goes wrong, the error
    message is the only support channel they have until the agent is up.
#>

$ErrorActionPreference = 'Stop'

function Install-MithrasPersonal {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Z0-9-]{8,64}$')]
        [string]$Code,

        [string]$ApiBaseUrl = 'https://api.mithras.com.au',

        [string]$BundleUrl  = 'https://api.mithras.com.au/storage/v1/object/public/agent-bundles/install-agent.ps1'
    )

    Write-Host ''
    Write-Host '================================================' -ForegroundColor Cyan
    Write-Host '  Mithras Personal — installing'                 -ForegroundColor Cyan
    Write-Host '================================================' -ForegroundColor Cyan
    Write-Host ''

    # Elevation guard. The underlying install-agent.ps1 has
    # #Requires -RunAsAdministrator, but the failure mode there is a hard
    # script-level parse error that confuses people. Catch it here with a
    # human message instead.
    $current = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host 'This installer needs to run in an elevated PowerShell window.' -ForegroundColor Red
        Write-Host '  1. Close this window.'                                          -ForegroundColor Yellow
        Write-Host '  2. Press the Windows key, type "powershell".'                    -ForegroundColor Yellow
        Write-Host '  3. Right-click "Windows PowerShell" and choose "Run as administrator".' -ForegroundColor Yellow
        Write-Host '  4. Paste the install command again.'                             -ForegroundColor Yellow
        throw 'Elevation required.'
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    # Pull the real installer to disk so it runs as a script (not via iex),
    # preserving its #Requires + param blocks.
    $installerPath = Join-Path $env:TEMP ("mithras-install-{0}.ps1" -f ([guid]::NewGuid().ToString('N')))
    try {
        Write-Host '[1/2] Downloading installer…' -ForegroundColor Gray
        Invoke-WebRequest -UseBasicParsing -Uri $BundleUrl -OutFile $installerPath
    } catch {
        Write-Host ''
        Write-Host 'Could not reach api.mithras.com.au to download the agent.' -ForegroundColor Red
        Write-Host 'Check your internet connection and try again.'             -ForegroundColor Yellow
        Write-Host "  Underlying error: $($_.Exception.Message)"               -ForegroundColor DarkGray
        throw
    }

    try {
        Write-Host '[2/2] Enrolling this PC and starting the agent…' -ForegroundColor Gray
        & $installerPath -ApiBaseUrl $ApiBaseUrl -EnrollmentToken $Code
    } finally {
        Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host '================================================' -ForegroundColor Green
    Write-Host '  Mithras Personal is now protecting this PC.'    -ForegroundColor Green
    Write-Host '================================================' -ForegroundColor Green
    Write-Host ''
    Write-Host 'You will get an email if anything looks off. A monthly summary'
    Write-Host 'lands on the first of each month. Manage your subscription at'
    Write-Host '  https://www.mithras.com.au/account'
    Write-Host ''
}
