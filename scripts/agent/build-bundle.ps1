#Requires -Version 5.1
<#
.SYNOPSIS
    Build a distributable ZIP of the Mithras Threat Defence Agent.
.DESCRIPTION
    Packages agent/runtime-powershell/ into mithras-agent-<version>.zip in
    the dist/ directory, ready for distribution to customer endpoints.

    The ZIP contains the modular agent + installer + tray + icon. Run
    install-agent.ps1 from the extracted directory as Administrator.

    Optionally also computes SHA256 + uploads to Supabase Storage if
    -UploadStorageUrl + -UploadServiceKey are supplied. The agent-script
    edge function can then serve a one-liner that downloads and runs it.
.PARAMETER OutputDir
    Where to put the built ZIP. Defaults to repo-root/dist/.
.PARAMETER UploadStorageUrl
    Optional. Supabase Storage base URL, e.g. https://api.mithras.com.au/storage/v1
    If provided, the ZIP is uploaded to bucket 'agent-bundles' after build.
.PARAMETER UploadServiceKey
    Optional. Supabase service role key, required when -UploadStorageUrl is set.
.PARAMETER UploadBucket
    Storage bucket name. Default 'agent-bundles'.
#>
[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$UploadStorageUrl,
    [string]$UploadServiceKey,
    [string]$UploadBucket = 'agent-bundles'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$AgentSrc   = Join-Path $RepoRoot 'agent\runtime-powershell'
if (-not $OutputDir) { $OutputDir = Join-Path $RepoRoot 'dist' }

# Read version
$Version = (Get-Content (Join-Path $AgentSrc 'agent.version') -Raw).Trim()
$ZipName = "mithras-agent-$Version.zip"
$ZipPath = Join-Path $OutputDir $ZipName

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

# Stage into a clean temp dir so we control exactly what goes in.
$Stage = Join-Path $env:TEMP "mithras-bundle-$(Get-Random)"
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

try {
    Write-Host "[build-bundle] Staging from $AgentSrc -> $Stage"

    # Files we keep at the top level
    $rootFiles = @(
        'install-agent.ps1', 'uninstall-agent.ps1', 'mithras-agent.ps1',
        'mithras-tray.ps1', 'mithras.ico', 'agent.version',
        'sysmon-config.xml', 'README.md'
    )
    foreach ($f in $rootFiles) {
        $src = Join-Path $AgentSrc $f
        if (Test-Path $src) { Copy-Item -Path $src -Destination $Stage -Force }
        else { Write-Warning "[build-bundle] missing $f in source" }
    }

    # lib/, vendor/, install/ wholesale. install/ ships Force-Remove.ps1
    # so the agent's uninstall_self command can find a break-glass cleanup
    # script at C:\ProgramData\Mithras\install\Force-Remove.ps1.
    Copy-Item -Path (Join-Path $AgentSrc 'lib')     -Destination $Stage -Recurse -Force
    Copy-Item -Path (Join-Path $AgentSrc 'vendor')  -Destination $Stage -Recurse -Force
    Copy-Item -Path (Join-Path $AgentSrc 'install') -Destination $Stage -Recurse -Force

    # Skip tests/, _legacy-extracted/, testdata/, backups/ -- they're not for production.

    # Verify the bundle is complete enough that install-agent.ps1 will succeed.
    foreach ($must in 'install-agent.ps1','mithras-agent.ps1','agent.version','mithras.ico','mithras-tray.ps1','vendor\nssm.exe','lib\HmacAuth.psm1','lib\FirewallAuditCollector.psm1','install\Force-Remove.ps1') {
        $check = Join-Path $Stage $must
        if (-not (Test-Path $check)) { throw "[build-bundle] required file missing from bundle: $must" }
    }

    if (Test-Path $ZipPath) { Remove-Item -Path $ZipPath -Force }
    Write-Host "[build-bundle] Compressing -> $ZipPath"
    Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $ZipPath -CompressionLevel Optimal

    $size   = (Get-Item $ZipPath).Length
    $sha256 = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()

    Write-Host "[build-bundle] Done"
    Write-Host "  file:   $ZipPath"
    Write-Host "  size:   $('{0:N0}' -f $size) bytes"
    Write-Host "  sha256: $sha256"

    # Write a sidecar manifest for the agent-script edge function to read.
    $manifest = [PSCustomObject]@{
        version  = $Version
        filename = $ZipName
        size     = $size
        sha256   = $sha256
        built_at = (Get-Date).ToUniversalTime().ToString('o')
    }
    $manifestPath = Join-Path $OutputDir "mithras-agent-$Version.json"
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding ascii
    Write-Host "  manifest: $manifestPath"

    if ($UploadStorageUrl -and $UploadServiceKey) {
        $url = "$($UploadStorageUrl.TrimEnd('/'))/object/$UploadBucket/$ZipName"
        Write-Host "[build-bundle] Uploading to $url"
        $bytes = [IO.File]::ReadAllBytes($ZipPath)
        try {
            $resp = Invoke-RestMethod -Uri $url -Method PUT -Body $bytes `
                -Headers @{
                    'Authorization' = "Bearer $UploadServiceKey"
                    'Content-Type'  = 'application/zip'
                    'x-upsert'      = 'true'
                } -TimeoutSec 120 -ErrorAction Stop
            Write-Host "[build-bundle] Upload OK: $($resp | ConvertTo-Json -Compress)"
        } catch {
            Write-Warning "[build-bundle] Upload failed: $($_.Exception.Message)"
        }

        # Manifest too -- agent-script will read this to know what to serve.
        $manifestUrl = "$($UploadStorageUrl.TrimEnd('/'))/object/$UploadBucket/latest.json"
        try {
            $resp = Invoke-RestMethod -Uri $manifestUrl -Method PUT `
                -Body ($manifest | ConvertTo-Json -Depth 5) `
                -Headers @{
                    'Authorization' = "Bearer $UploadServiceKey"
                    'Content-Type'  = 'application/json'
                    'x-upsert'      = 'true'
                } -TimeoutSec 30 -ErrorAction Stop
            Write-Host "[build-bundle] Manifest upload OK"
        } catch {
            Write-Warning "[build-bundle] Manifest upload failed: $($_.Exception.Message)"
        }
    }

    return @{ zip = $ZipPath; sha256 = $sha256; size = $size; version = $Version }
} finally {
    Remove-Item -Path $Stage -Recurse -Force -ErrorAction SilentlyContinue
}
