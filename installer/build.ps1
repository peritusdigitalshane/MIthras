<#
.SYNOPSIS
    Build the Mithras Threat Defence Agent installer (.exe) with Inno Setup.

.DESCRIPTION
    1. Stages the agent runtime (agent/runtime-powershell/*) into installer/payload/
    2. Generates the wizard banner images (Mithras blue + shield logo)
    3. Copies mithras.ico into installer/assets/
    4. Invokes ISCC.exe to compile installer/Mithras-Agent.iss
    5. Output: installer/output/MithrasAgent-Setup-{version}.exe

    Inno Setup must be installed. Download from https://jrsoftware.org/isdl.php.
    Default install path C:\Program Files (x86)\Inno Setup 6 is auto-detected;
    override with -InnoSetupPath.

.PARAMETER InnoSetupPath
    Override the path to ISCC.exe if Inno Setup isn't in the default location.

.PARAMETER SkipAssetGen
    Skip regenerating the wizard BMPs. Useful if you have custom-designed
    banners checked into installer/assets/ that you don't want overwritten.

.EXAMPLE
    .\build.ps1
        Builds MithrasAgent-Setup-0.7.13.exe in installer\output\.

.EXAMPLE
    .\build.ps1 -SkipAssetGen
        Re-uses whatever banners are already in installer\assets\.
#>
[CmdletBinding()]
param(
    [string]$InnoSetupPath,
    [switch]$SkipAssetGen,
    [switch]$SkipUpload,
    [string]$UploadHost = 'root@149.28.186.142',
    [string]$UploadDir  = '/opt/peritus-agent-releases'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot      = Split-Path -Parent $InstallerRoot
$AgentRuntime  = Join-Path $RepoRoot 'agent\runtime-powershell'
$AssetsDir     = Join-Path $InstallerRoot 'assets'
$PayloadDir    = Join-Path $InstallerRoot 'payload'
$OutputDir     = Join-Path $InstallerRoot 'output'
$IssFile       = Join-Path $InstallerRoot 'Mithras-Agent.iss'
$AgentVersion  = (Get-Content (Join-Path $AgentRuntime 'agent.version') -Raw).Trim()

function Write-Step { param([string]$Msg) Write-Host "`n[build] $Msg" -ForegroundColor Cyan }

function Resolve-Iscc {
    if ($InnoSetupPath) {
        if (-not (Test-Path $InnoSetupPath)) { throw "ISCC.exe not found at: $InnoSetupPath" }
        return $InnoSetupPath
    }
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe"
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    throw @"
Inno Setup 6 not found.

Install from https://jrsoftware.org/isdl.php (free, ~3 MB), then re-run.
Or pass -InnoSetupPath C:\path\to\ISCC.exe
"@
}

function New-WizardBanner {
    param([int]$Width, [int]$Height, [string]$OutPath, [string]$Variant = 'large')

    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint= [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Mithras gradient -- deep navy to violet, matches the brand on the portal.
    $top    = [System.Drawing.Color]::FromArgb(15, 23, 42)    # slate-900
    $bottom = [System.Drawing.Color]::FromArgb(67, 56, 202)   # indigo-700
    $rect   = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
    $brush  = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $top, $bottom, 90)
    $g.FillRectangle($brush, $rect)

    # Centred shield glyph (simple geometric, not the SVG -- keeps deps zero).
    $shieldColor = [System.Drawing.Color]::FromArgb(245, 158, 11)  # amber-500
    $pen   = New-Object System.Drawing.Pen($shieldColor, 4)
    $fill  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 245, 158, 11))

    $cx = $Width / 2
    $cy = $Height * 0.35
    $shieldW = [Math]::Min($Width * 0.55, 120)
    $shieldH = $shieldW * 1.15
    $points = @(
        (New-Object System.Drawing.PointF([float]($cx),              [float]($cy - $shieldH/2))),
        (New-Object System.Drawing.PointF([float]($cx + $shieldW/2), [float]($cy - $shieldH/4))),
        (New-Object System.Drawing.PointF([float]($cx + $shieldW/2), [float]($cy + $shieldH/4))),
        (New-Object System.Drawing.PointF([float]($cx),              [float]($cy + $shieldH/2))),
        (New-Object System.Drawing.PointF([float]($cx - $shieldW/2), [float]($cy + $shieldH/4))),
        (New-Object System.Drawing.PointF([float]($cx - $shieldW/2), [float]($cy - $shieldH/4)))
    )
    $g.FillPolygon($fill, $points)
    $g.DrawPolygon($pen, $points)

    # Wordmark only on the large banner.
    if ($Variant -eq 'large') {
        $font  = New-Object System.Drawing.Font("Segoe UI Semibold", 18, [System.Drawing.FontStyle]::Bold)
        $brushW = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $g.DrawString("MITHRAS", $font, $brushW, [float]$cx, [float]($cy + $shieldH/2 + 18), $sf)

        $font2 = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
        $brushG = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(203, 213, 225))  # slate-300
        $g.DrawString("THREAT DEFENCE", $font2, $brushG, [float]$cx, [float]($cy + $shieldH/2 + 48), $sf)
    }

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bmp.Dispose()
}

# === STEP 1 -- assets ===
Write-Step "Preparing assets"
if (-not (Test-Path $AssetsDir)) { New-Item -ItemType Directory -Force -Path $AssetsDir | Out-Null }

Copy-Item -Force (Join-Path $AgentRuntime 'mithras.ico') (Join-Path $AssetsDir 'mithras.ico')
Write-Host "  [ok] mithras.ico copied"

if (-not $SkipAssetGen) {
    New-WizardBanner -Width 164 -Height 314 -OutPath (Join-Path $AssetsDir 'wizard-banner.bmp') -Variant 'large'
    Write-Host "  [ok] wizard-banner.bmp (164x314) generated"
    New-WizardBanner -Width 55  -Height 58  -OutPath (Join-Path $AssetsDir 'wizard-small.bmp')  -Variant 'small'
    Write-Host "  [ok] wizard-small.bmp (55x58) generated"
} else {
    Write-Host "  - skipping asset generation (per -SkipAssetGen)"
}

# === STEP 2 -- payload ===
Write-Step "Staging agent runtime into payload/"
if (Test-Path $PayloadDir) { Remove-Item -Recurse -Force $PayloadDir }
New-Item -ItemType Directory -Force -Path $PayloadDir | Out-Null

# Files only -- skip the test/legacy/dev dirs that bloat the installer
$skipPatterns = @('_legacy-extracted', 'testdata', 'tests', '.gitignore')
Get-ChildItem -Path $AgentRuntime -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($AgentRuntime.Length + 1)
    $skip = $false
    foreach ($pat in $skipPatterns) { if ($rel -like "$pat*") { $skip = $true; break } }
    if (-not $skip) {
        $dest = Join-Path $PayloadDir $rel
        $destDir = Split-Path -Parent $dest
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
        Copy-Item $_.FullName $dest -Force
    }
}
$payloadSize = (Get-ChildItem $PayloadDir -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("  [ok] {0:N0} files, {1:N1} MB" -f (Get-ChildItem $PayloadDir -Recurse -File).Count, ($payloadSize / 1MB))

# === STEP 3 -- compile ===
Write-Step "Compiling installer with Inno Setup"
$iscc = Resolve-Iscc
Write-Host "  using $iscc"

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }

& $iscc /Q $IssFile
if ($LASTEXITCODE -ne 0) { throw "ISCC.exe failed with exit code $LASTEXITCODE" }

$installer = Get-ChildItem $OutputDir -Filter 'MithrasAgent-Setup-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "ISCC.exe ran but no installer was produced in $OutputDir" }

$mb = '{0:N1}' -f ($installer.Length / 1MB)
Write-Host ""
Write-Host "  Built: $($installer.FullName)" -ForegroundColor Green
Write-Host "  Size:  $mb MB" -ForegroundColor Green
Write-Host "  Version: $AgentVersion" -ForegroundColor Green

# === STEP 4 -- upload to docker02 ===
# Drops the EXE into the Caddy-served /opt/peritus-agent-releases dir on prod
# and updates the "latest" symlink so the portal's Download button always
# points at the freshest build.
if (-not $SkipUpload) {
    Write-Step "Uploading to $UploadHost`:$UploadDir"
    $remoteName = "MithrasAgent-Setup-$AgentVersion.exe"
    & scp $installer.FullName "${UploadHost}:${UploadDir}/${remoteName}"
    if ($LASTEXITCODE -ne 0) { throw "scp failed with exit code $LASTEXITCODE" }
    & ssh $UploadHost "ln -sf $remoteName $UploadDir/MithrasAgent-Setup-latest.exe && ls -la $UploadDir/MithrasAgent-Setup-*.exe | tail -5"
    if ($LASTEXITCODE -ne 0) { throw "ssh symlink update failed with exit code $LASTEXITCODE" }
    Write-Host "  Live at: https://api.mithras.com.au/agent/$remoteName" -ForegroundColor Green
    Write-Host "  Latest:  https://api.mithras.com.au/agent/MithrasAgent-Setup-latest.exe" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  (Upload skipped per -SkipUpload)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Test on a clean VM:" -ForegroundColor Yellow
Write-Host "  Interactive: just double-click the EXE"
Write-Host "  Silent (with code): MithrasAgent-Setup-$AgentVersion.exe /SILENT /CODE=YOUR-ENROL-CODE"
Write-Host "  Silent uninstall: %ProgramFiles%\Mithras\unins000.exe /SILENT"
