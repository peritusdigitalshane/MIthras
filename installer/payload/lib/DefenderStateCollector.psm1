# DefenderStateCollector.psm1 -- v0.6.6
#
# Snapshot of Defender's live state that the SOC operator needs in order to
# triage an endpoint that's gone into a Defender-induced lockdown.
#
# Shape (ships as `defender_state` in heartbeat):
#   {
#     collected_at           : ISO-8601 UTC
#     active_threats         : Array of { threat_id, threat_name, severity, resources[], detection_time }
#     active_threat_count    : int
#     recent_detections_24h  : Array of { threat_id, detected_at, action_success, resource_short }
#     recent_detection_count : int
#     behavior_monitoring    : 'on' | 'off' | 'unknown'
#     realtime_protection    : 'on' | 'off' | 'unknown'
#     tamper_protection      : 'on' | 'off' | 'unknown'
#     mithras_paths_excluded : bool         # are agent paths in MpPreference.ExclusionPath?
#     asr_rules              : Array of { rule_id, mode }   # Audit | Block | Disabled
#     last_quick_scan_at     : ISO-8601 UTC | null
#     last_full_scan_at      : ISO-8601 UTC | null
#   }
#
# The whole payload is small (<5 KB even on a noisy host) and ships every
# heartbeat. Server stores latest snapshot in endpoints.defender_state JSONB
# for the SOC console to render.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$script:MITHRAS_INSTALL = 'C:\ProgramData\Mithras\install'
$script:MITHRAS_AGENT_ROOT = 'C:\ProgramData\Mithras'

# ASR rule GUIDs (Microsoft documented). Names are for display only; the GUID is
# what shows in MpPreference.AttackSurfaceReductionRules_Ids.
$script:ASR_RULE_NAMES = @{
    'BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550' = 'Block executable from email'
    'D4F940AB-401B-4EFC-AADC-AD5F3C50688A' = 'Block child processes from Office'
    '3B576869-A4EC-4529-8536-B80A7769E899' = 'Block Office from creating exes'
    '75668C1F-73B5-4CF0-BB93-3ECF5CB7CC84' = 'Block Office from injecting code'
    'D3E037E1-3EB8-44C8-A917-57927947596D' = 'Block JS/VBS from launching exes'
    '5BEB7EFE-FD9A-4556-801D-275E5FFC04CC' = 'Block obfuscated scripts'
    '92E97FA1-2EDF-4476-BDD6-9DD0B4DDDC7B' = 'Block untrusted Win32 from Office macros'
    '01443614-CD74-433A-B99E-2ECDC07BFC25' = 'Block from email/webmail'
    '9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2' = 'Block credential stealing from LSASS'
    'D1E49AAC-8F56-4280-B9BA-993A6D77406C' = 'Block creation of processes from PSExec/WMI'
    'B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4' = 'Block USB unsigned exes'
    '26190899-1602-49E8-8B27-EB1D0A1CE869' = 'Block from Office communication apps'
    '7674BA52-37EB-4A4F-A9A1-F0F9A1619A2C' = 'Block Adobe Reader child processes'
    'E6DB77E5-3DF2-4CF1-B95A-636979351E5B' = 'Block persistence through WMI subscription'
    'C1DB55AB-C21A-4637-BB3F-A12568109D35' = 'Block ransomware-like behavior'
    '56A863A9-875E-4185-98A7-B882C64B5CE5' = 'Block abuse of vulnerable signed drivers'
}

function _ToIso($dt) {
    if (-not $dt) { return $null }
    try { return ([datetime]$dt).ToUniversalTime().ToString('o') } catch { return $null }
}

function _StringOrUnknown($v, $expectOn) {
    # Defender PowerShell returns nullable booleans; map to 'on' / 'off' / 'unknown'.
    if ($null -eq $v) { return 'unknown' }
    if ($v -eq $true) { return 'on' }
    if ($v -eq $false) { return 'off' }
    return 'unknown'
}

function Get-DefenderStatePayload {
    [CmdletBinding()]
    param()

    $payload = [ordered]@{
        collected_at           = (Get-Date).ToUniversalTime().ToString('o')
        active_threats         = @()
        active_threat_count    = 0
        recent_detections_24h  = @()
        recent_detection_count = 0
        behavior_monitoring    = 'unknown'
        realtime_protection    = 'unknown'
        tamper_protection      = 'unknown'
        mithras_paths_excluded = $false
        asr_rules              = @()
        last_quick_scan_at     = $null
        last_full_scan_at      = $null
    }

    # 1. Active threats. Get-MpThreat returns currently-tracked items; an
    # IsActive=true row means the threat is still present on disk / in memory.
    try {
        $threats = @(Get-MpThreat -ErrorAction Stop | Where-Object { $_.IsActive })
        $list = @()
        foreach ($t in $threats) {
            $list += @{
                threat_id      = [string]$t.ThreatID
                threat_name    = [string]$t.ThreatName
                severity_id    = [int]$t.SeverityID
                category_id    = [int]$t.CategoryID
                resources      = @(@($t.Resources) | Select-Object -First 5 | ForEach-Object { [string]$_ })
                detection_time = _ToIso $t.InitialDetectionTime
            }
        }
        # v0.7.6: dropped the leading `,` here and 5 sibling sites. The unary
        # comma double-wrapped these as [[...]] in the heartbeat JSON, which
        # broke the SQL reconciler (it iterated the outer array and got
        # threat_id=NULL on inner elements, then marked every open threat
        # row as Removed). DefenderStateCard.tsx also had a defensive
        # flat() that's now redundant.
        $payload.active_threats      = @($list)
        $payload.active_threat_count = $list.Count
    } catch {
        # Get-MpThreat unavailable on older Defender / Server SKUs without the
        # cmdlet; the SOC will see this as count=0 which is the safe default.
        $payload.active_threats = @()
    }

    # 2. Recent detections (last 24h). Includes successfully-remediated items
    # so the operator sees what triggered the recent lockdown even after
    # Defender's cleanup.
    try {
        $since = (Get-Date).AddHours(-24)
        $detections = @(Get-MpThreatDetection -ErrorAction Stop |
            Where-Object { $_.InitialDetectionTime -gt $since })
        $sorted = @($detections | Sort-Object InitialDetectionTime -Descending | Select-Object -First 20)
        $list = @()
        foreach ($d in $sorted) {
            $resShort = $null
            try {
                $resources = @($d.Resources)
                if ($resources.Count -gt 0) {
                    $r = [string]$resources[0]
                    $resShort = $r.Substring(0, [Math]::Min(200, $r.Length))
                }
            } catch {}
            $list += @{
                threat_id        = [string]$d.ThreatID
                detected_at      = _ToIso $d.InitialDetectionTime
                action_success   = [bool]$d.ActionSuccess
                resource_short   = $resShort
            }
        }
        $payload.recent_detections_24h  = @($list)
        $payload.recent_detection_count = $detections.Count
    } catch {
        $payload.recent_detections_24h = @()
    }

    # 3. MpPreference / MpComputerStatus snapshot.
    try {
        $cs = Get-MpComputerStatus -ErrorAction Stop
        $payload.realtime_protection = _StringOrUnknown $cs.RealTimeProtectionEnabled $true
        $payload.behavior_monitoring = _StringOrUnknown $cs.BehaviorMonitorEnabled    $true
        $payload.tamper_protection   = _StringOrUnknown $cs.IsTamperProtected         $true
        $payload.last_quick_scan_at  = _ToIso $cs.QuickScanEndTime
        $payload.last_full_scan_at   = _ToIso $cs.FullScanEndTime
    } catch {}

    try {
        $pref = Get-MpPreference -ErrorAction Stop
        # Exclusion check: any ExclusionPath that covers our install or root.
        $excl = @($pref.ExclusionPath)
        $payload.mithras_paths_excluded = ($excl -contains $script:MITHRAS_INSTALL) -or
                                          ($excl -contains "$script:MITHRAS_INSTALL\") -or
                                          ($excl -contains $script:MITHRAS_AGENT_ROOT) -or
                                          ($excl -contains "$script:MITHRAS_AGENT_ROOT\") -or
                                          ($excl | Where-Object { $_ -and ($_.TrimEnd('\') -eq $script:MITHRAS_INSTALL.TrimEnd('\')) }).Count -gt 0

        # ASR rules: zip up the parallel Ids / Actions arrays.
        $ids = @($pref.AttackSurfaceReductionRules_Ids)
        $acts = @($pref.AttackSurfaceReductionRules_Actions)
        $rules = @()
        for ($i = 0; $i -lt $ids.Count; $i++) {
            $mode = switch ([int]$acts[$i]) {
                0 { 'Disabled' }
                1 { 'Block' }
                2 { 'Audit' }
                6 { 'Warn' }
                default { 'Unknown' }
            }
            $name = $script:ASR_RULE_NAMES[($ids[$i].ToString().ToUpper())]
            if (-not $name) { $name = $ids[$i] }
            $rules += @{
                rule_id   = [string]$ids[$i]
                rule_name = [string]$name
                mode      = $mode
            }
        }
        $payload.asr_rules = @($rules)
    } catch {
        $payload.asr_rules = @()
    }

    return $payload
}

Export-ModuleMember -Function Get-DefenderStatePayload
