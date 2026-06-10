# AppDiscoveryCollector.psm1 -- v0.5.4
#
# Populates wdac_discovered_apps via /agent-app-control/observed regardless of
# whether the endpoint has an assigned WDAC rule_set. This is what feeds the
# /policies > Application Control UI -- without it, the UI is empty until
# someone manually assigns a rule_set, which is a bad first-run experience.
#
# Sources:
#   1. Running processes (Get-Process | unique main-module paths) -- the most
#      relevant data, since these are EXEs actually in use right now.
#   2. Installed apps with InstallLocation pointing at a real directory -- we
#      pick the largest .exe in the install root as the "primary" binary.
#
# Hashes are deliberately skipped (set to empty string) -- SHA256 over every
# Program Files exe is slow and not needed for the App Control UI's display
# purpose. If hashes are later required for rule-building they can be computed
# server-side on demand.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

function _AdcLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'collectors.log') -Value "[$(Get-Date -Format o)] [$lvl] app-discovery: $msg" -Encoding UTF8
    } catch {}
}

function _TryFileVersionInfo {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    try { return [Diagnostics.FileVersionInfo]::GetVersionInfo($Path) } catch { return $null }
}

function Get-RunningAppsForDiscovery {
    # Snapshot currently-running processes; one row per unique MainModule path.
    $seen = @{}
    $out  = New-Object System.Collections.Generic.List[hashtable]
    try {
        Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $p = $null
                try { $p = $_.MainModule.FileName } catch {}
                if (-not $p) { return }
                $key = $p.ToLowerInvariant()
                if ($seen.ContainsKey($key)) { return }
                $seen[$key] = $true

                $vi = _TryFileVersionInfo -Path $p
                $out.Add(@{
                    file_name    = [IO.Path]::GetFileName($p)
                    file_path    = $p
                    file_hash    = ''                       # deliberate -- see header
                    publisher    = if ($vi) { $vi.CompanyName }     else { $null }
                    product_name = if ($vi) { $vi.ProductName }     else { $null }
                    file_version = if ($vi) { $vi.FileVersion }     else { $null }
                    exec_count   = 1
                }) | Out-Null
            } catch {}
        }
    } catch { _AdcLog 'Warn' "Get-Process failed: $_" }
    return ,$out.ToArray()
}

function Get-InstalledAppsForDiscovery {
    # Walk HKLM Uninstall hives. For entries with a usable InstallLocation,
    # find the largest .exe in the install root and report it as the primary
    # executable. Falls back to UninstallString's EXE if no InstallLocation.
    $seen = @{}
    $out  = New-Object System.Collections.Generic.List[hashtable]
    $hives = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    foreach ($hive in $hives) {
        try {
            Get-ItemProperty -Path $hive -ErrorAction SilentlyContinue | ForEach-Object {
                $name = $_.DisplayName
                if (-not $name) { return }
                if ($_.SystemComponent -eq 1) { return }
                if ($_.ParentKeyName)         { return }
                if ($name -match '^(KB\d+|Update for |Security Update for |Hotfix )') { return }

                $loc = $_.InstallLocation
                $candidate = $null

                if ($loc -and (Test-Path -LiteralPath $loc -ErrorAction SilentlyContinue)) {
                    try {
                        # Largest .exe in the immediate install root -- usually the launcher.
                        $exe = Get-ChildItem -LiteralPath $loc -Filter '*.exe' -File -ErrorAction SilentlyContinue |
                               Sort-Object -Property Length -Descending |
                               Select-Object -First 1
                        if ($exe) { $candidate = $exe.FullName }
                    } catch {}
                }

                if (-not $candidate -and $_.UninstallString) {
                    # Extract an .exe path from UninstallString (best effort).
                    $m = [regex]::Match($_.UninstallString, '("([^"]+\.exe)"|([A-Za-z]:\\[^\s"]+\.exe))')
                    if ($m.Success) {
                        $p = if ($m.Groups[2].Value) { $m.Groups[2].Value } else { $m.Groups[3].Value }
                        if ($p -and (Test-Path -LiteralPath $p -ErrorAction SilentlyContinue)) {
                            $candidate = $p
                        }
                    }
                }

                if (-not $candidate) { return }

                $key = $candidate.ToLowerInvariant()
                if ($seen.ContainsKey($key)) { return }
                $seen[$key] = $true

                $vi = _TryFileVersionInfo -Path $candidate
                $publisher = $_.Publisher
                if (-not $publisher -and $vi) { $publisher = $vi.CompanyName }

                $out.Add(@{
                    file_name    = [IO.Path]::GetFileName($candidate)
                    file_path    = $candidate
                    file_hash    = ''
                    publisher    = if ($publisher) { [string]$publisher } else { $null }
                    product_name = if ($_.DisplayName) { [string]$_.DisplayName } else { $null }
                    file_version = if ($_.DisplayVersion) { [string]$_.DisplayVersion } elseif ($vi) { $vi.FileVersion } else { $null }
                    exec_count   = 1
                }) | Out-Null
            }
        } catch { _AdcLog 'Warn' "hive scan failed for ${hive}: $_" }
    }
    return ,$out.ToArray()
}

function Get-AppDiscoveryPayload {
    # Union of running + installed, dedup by file_path. Cap so a single push
    # doesn't blow past edge-runtime CPU limits or the upsert batch size.
    [CmdletBinding()]
    param([int]$MaxItems = 250)

    $running   = Get-RunningAppsForDiscovery
    $installed = Get-InstalledAppsForDiscovery

    $merged = @{}
    foreach ($a in $running)   { $merged[$a.file_path.ToLowerInvariant()] = $a }
    foreach ($a in $installed) {
        $k = $a.file_path.ToLowerInvariant()
        if (-not $merged.ContainsKey($k)) { $merged[$k] = $a }
    }

    $all = @($merged.Values)
    if ($all.Count -gt $MaxItems) { $all = $all[0..($MaxItems - 1)] }

    _AdcLog 'Info' ("collected={0} (running={1} installed={2}) cap={3}" -f $all.Count, $running.Count, $installed.Count, $MaxItems)
    return ,$all
}

Export-ModuleMember -Function Get-AppDiscoveryPayload, Get-RunningAppsForDiscovery, Get-InstalledAppsForDiscovery
