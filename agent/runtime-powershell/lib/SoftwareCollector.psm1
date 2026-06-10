#requires -version 5.1
# Installed-software collector. v0.4.0+. Reads the standard uninstall hives.
# Returns an array of { name, version, publisher, install_date, architecture }
# ready for the agent-heartbeat payload's software_inventory section.

function Get-SoftwareInventoryPayload {
    [CmdletBinding()]
    param()

    $paths = @(
        @{ Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*';            Arch = 'x64' },
        @{ Path = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'; Arch = 'x86' }
    )

    $out = New-Object System.Collections.Generic.List[hashtable]
    foreach ($p in $paths) {
        try {
            Get-ItemProperty -Path $p.Path -ErrorAction SilentlyContinue | ForEach-Object {
                $name = $_.DisplayName
                if (-not $name) { return }
                # Skip system components and updates by default.
                if ($_.SystemComponent -eq 1) { return }
                if ($_.ParentKeyName)         { return }   # patches
                if ($name -match '^(KB\d+|Update for |Security Update for |Hotfix )') { return }

                $out.Add(@{
                    name         = [string]$name
                    version      = if ($_.DisplayVersion) { [string]$_.DisplayVersion } else { $null }
                    publisher    = if ($_.Publisher)      { [string]$_.Publisher }      else { $null }
                    install_date = if ($_.InstallDate)    { [string]$_.InstallDate }    else { $null }
                    architecture = $p.Arch
                }) | Out-Null
            }
        } catch { continue }
    }

    # Dedup by (name, version, architecture) — same package listed in both 64- and 32-bit hives is rare,
    # but we want one row per actual install.
    $seen = @{}
    $deduped = @()
    foreach ($s in $out) {
        $key = "$($s.name)|$($s.version)|$($s.architecture)"
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $deduped += $s
    }
    return $deduped
}

Export-ModuleMember -Function Get-SoftwareInventoryPayload
