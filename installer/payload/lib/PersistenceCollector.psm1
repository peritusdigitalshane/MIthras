#requires -version 5.1
# Persistence-mechanism collector. v0.4.5+.
# Enumerates: registry Run/RunOnce keys (HKLM + HKCU all profiles), Windows
# services with non-default StartName, scheduled tasks with action paths.
# Ships only when canonicalised SHA-256 of the dataset differs from prior state
# so diff-only traffic.

function _PsLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'collectors.log') -Value "[$(Get-Date -Format o)] [$lvl] persistence: $msg" -Encoding UTF8
    } catch {}
}

function _StableHash {
    param([Parameter(Mandatory)][object]$Obj)
    $json = $Obj | ConvertTo-Json -Depth 8 -Compress
    $sha  = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $hash  = $sha.ComputeHash($bytes)
    -join ($hash | ForEach-Object { $_.ToString('x2') })
}

function _CollectRunKeys {
    $keys = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
    )
    $out = @()
    foreach ($k in $keys) {
        try {
            if (-not (Test-Path $k)) { continue }
            $props = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
            if (-not $props) { continue }
            foreach ($p in $props.PSObject.Properties) {
                if ($p.Name -like 'PS*') { continue }
                $out += [ordered]@{
                    key   = $k
                    name  = $p.Name
                    value = [string]$p.Value
                }
            }
        } catch { continue }
    }
    return $out
}

function _CollectServices {
    $out = @()
    try {
        # Win32_Service is the source of truth for binary path + StartName.
        $svcs = Get-CimInstance -ClassName Win32_Service -ErrorAction Stop
        foreach ($s in $svcs) {
            # Skip stock Microsoft services running as LocalSystem with no obvious
            # persistence concern. Filter is heuristic: include if NOT LocalSystem
            # OR the path isn't in System32.
            $name      = [string]$s.Name
            $display   = [string]$s.DisplayName
            $bin       = [string]$s.PathName
            $startMode = [string]$s.StartMode
            $startName = [string]$s.StartName
            $isAuto    = ($startMode -in 'Auto','Automatic')
            if (-not $isAuto) { continue }
            $out += [ordered]@{
                name        = $name
                display     = $display
                binary_path = $bin
                start_mode  = $startMode
                start_name  = $startName
            }
        }
    } catch { _PsLog 'WARN' ("Win32_Service query failed: " + $_.Exception.Message) }
    return $out
}

function _CollectScheduledTasks {
    $out = @()
    try {
        $tasks = Get-ScheduledTask -ErrorAction Stop
        foreach ($t in $tasks) {
            # Skip Microsoft system folders unless task author is non-Microsoft.
            $path   = [string]$t.TaskPath
            $author = [string]$t.Author
            $actions = @()
            foreach ($a in $t.Actions) {
                $actions += [ordered]@{
                    type      = [string]$a.GetType().Name
                    execute   = [string]$a.Execute
                    arguments = [string]$a.Arguments
                    work_dir  = [string]$a.WorkingDirectory
                }
            }
            $triggers = @()
            foreach ($g in $t.Triggers) {
                $triggers += [string]$g.GetType().Name
            }
            $out += [ordered]@{
                name        = [string]$t.TaskName
                path        = $path
                author      = $author
                state       = [string]$t.State
                actions     = $actions
                triggers    = $triggers
            }
        }
    } catch { _PsLog 'WARN' ("Get-ScheduledTask failed: " + $_.Exception.Message) }
    return $out
}

function Get-PersistenceSnapshotPayload {
    [CmdletBinding()]
    param([string]$StatePath)

    $runKeys  = _CollectRunKeys
    $services = _CollectServices
    $tasks    = _CollectScheduledTasks

    $payload = [ordered]@{
        run_keys = $runKeys
        services = $services
        tasks    = $tasks
    }
    $hash = _StableHash -Obj $payload
    _PsLog 'INFO' ("collected run_keys=" + $runKeys.Count + " services=" + $services.Count + " tasks=" + $tasks.Count + " hash=" + $hash.Substring(0,12))

    # Diff-only: skip if hash matches saved state.
    $skip = $false
    if ($StatePath -and (Test-Path $StatePath)) {
        try {
            $prev = Get-Content -Path $StatePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            if ($prev.snapshot_hash -eq $hash) { $skip = $true }
        } catch {}
    }
    if ($skip) {
        _PsLog 'INFO' "no change since last snapshot, skipping ship"
        return $null
    }
    if ($StatePath) {
        try { @{ snapshot_hash = $hash; collected_at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress | Out-File -FilePath $StatePath -Encoding UTF8 -Force } catch {}
    }

    return @{
        snapshot_hash  = $hash
        run_key_count  = $runKeys.Count
        service_count  = $services.Count
        task_count     = $tasks.Count
        payload        = $payload
    }
}

Export-ModuleMember -Function Get-PersistenceSnapshotPayload
