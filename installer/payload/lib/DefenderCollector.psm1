#requires -version 5.1
# Defender posture + threat collectors. v0.4.3+.
# PowerShell 5.1 compatible — NO ?? / ?. / ?: operators.
# Per-property try/catch so one bad field doesn't kill the whole section under
# Set-StrictMode -Version Latest.

function _LogCollect($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'collectors.log') -Value "[$(Get-Date -Format o)] [$lvl] $msg" -Encoding UTF8
    } catch {}
}

function _TryGet($obj, $name, $caster) {
    # Returns ($caster $obj.$name) or $null on any failure. Strict-mode safe.
    try {
        if ($null -eq $obj) { return $null }
        if (-not $obj.PSObject.Properties[$name]) { return $null }
        $v = $obj.$name
        if ($null -eq $v) { return $null }
        if ($null -eq $caster) { return $v }
        return & $caster $v
    } catch {
        return $null
    }
}

function Get-DefenderStatusPayload {
    [CmdletBinding()]
    param()

    $s = $null
    try {
        $s = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        _LogCollect 'WARN' ("Get-MpComputerStatus threw: " + $_.Exception.Message)
        return $null
    }
    if (-not $s) { _LogCollect 'WARN' 'Get-MpComputerStatus returned null'; return $null }

    $toBool = { param($v) [bool]$v }
    $toInt  = { param($v) try { [int]$v } catch { try { [int64]$v } catch { $null } } }
    $toStr  = { param($v) [string]$v }
    $toIso  = { param($v) try { $v.ToString('o') } catch { $null } }

    $payload = @{
        realtime_protection_enabled  = (_TryGet $s 'RealTimeProtectionEnabled'  $toBool)
        antivirus_enabled            = (_TryGet $s 'AntivirusEnabled'            $toBool)
        antispyware_enabled          = (_TryGet $s 'AntispywareEnabled'          $toBool)
        behavior_monitor_enabled     = (_TryGet $s 'BehaviorMonitorEnabled'      $toBool)
        ioav_protection_enabled      = (_TryGet $s 'IoavProtectionEnabled'       $toBool)
        on_access_protection_enabled = (_TryGet $s 'OnAccessProtectionEnabled'   $toBool)
        nis_enabled                  = (_TryGet $s 'NISEnabled'                  $toBool)
        antivirus_signature_age      = (_TryGet $s 'AntivirusSignatureAge'       $toInt)
        antispyware_signature_age    = (_TryGet $s 'AntispywareSignatureAge'     $toInt)
        antivirus_signature_version  = (_TryGet $s 'AntivirusSignatureVersion'   $toStr)
        nis_signature_version        = (_TryGet $s 'NISSignatureVersion'         $toStr)
        am_running_mode              = (_TryGet $s 'AMRunningMode'               $toStr)
        tamper_protection_source     = (_TryGet $s 'TamperProtectionSource'      $toStr)
        full_scan_age                = (_TryGet $s 'FullScanAge'                 $toInt)
        quick_scan_age               = (_TryGet $s 'QuickScanAge'                $toInt)
        full_scan_end_time           = (_TryGet $s 'FullScanEndTime'             $toIso)
        quick_scan_end_time          = (_TryGet $s 'QuickScanEndTime'            $toIso)
        computer_state               = (_TryGet $s 'ComputerState'               $toInt)
    }
    _LogCollect 'INFO' ("defender_status collected: rtp=" + $payload.realtime_protection_enabled + " sig_age=" + $payload.antivirus_signature_age)
    return $payload
}

function Get-DefenderThreatsPayload {
    [CmdletBinding()]
    param(
        [int]$MaxThreats = 200,
        # v0.7.15: skip the Defender WMI provider for this many seconds after
        # a successful collect. 0 disables the cache (the previous behaviour).
        [int]$CacheTtlSeconds = 300
    )

    # v0.7.15: hot WMI fix.
    #
    # Get-MpThreatDetection + Get-MpThreat go through the Defender Protection-
    # Management WMI provider (hosted by WmiPrvSE). On an endpoint with N
    # historical detections both calls enumerate every record, and the agent's
    # 60-second heartbeat cadence puts that work on WmiPrvSE every minute even
    # though the detection set rarely changes minute-to-minute. We've measured
    # this as the dominant WmiPrvSE CPU consumer on endpoints with EICAR test
    # fixtures or normal day-to-day threat history.
    #
    # Cache the parsed payload at script scope. While the cache is fresh we
    # ship the same payload (server is the source of truth + dedupes by
    # threat_id), but skip the two WMI calls + per-threat catalog lookups
    # entirely. Real new detections still surface within $CacheTtlSeconds
    # (300s default = 5 cycles), which is well under any SLA driven by the
    # alerts pipeline. The cache is in-memory only — restart drops it, so the
    # very first cycle after upgrade pays the full cost.
    if ($CacheTtlSeconds -gt 0 -and (Test-Path Variable:Script:DefenderThreatsCache)) {
        $cached = $script:DefenderThreatsCache
        $ageSec = ((Get-Date) - $cached.fetched_at).TotalSeconds
        if ($ageSec -lt $CacheTtlSeconds) {
            _LogCollect 'INFO' ("threats: cache hit, age=" + [int]$ageSec + "s count=" + $cached.payload.Count)
            return $cached.payload
        }
    }

    $detections = @()
    try { $r = @(Get-MpThreatDetection -ErrorAction SilentlyContinue); if ($r) { $detections += $r } } catch {}
    try { $r = @(Get-MpThreat          -ErrorAction SilentlyContinue); if ($r) { $detections += $r } } catch {}

    if ($detections.Count -eq 0) {
        if ($CacheTtlSeconds -gt 0) {
            $script:DefenderThreatsCache = @{ payload = @(); fetched_at = (Get-Date) }
        }
        return @()
    }
    _LogCollect 'INFO' ("threats: raw count=" + $detections.Count)

    # v0.6.1: cache catalog lookups per ThreatID. Get-MpThreatDetection returns
    # rows without ThreatName AND without a usable SeverityID -- both live on
    # the catalog entry.
    #
    # v0.7.1: PERFORMANCE -- moved cache to script scope + disk-backed.
    # Previously $catalogCache was rebuilt every call, so every heartbeat
    # re-issued ALL Get-MpThreatCatalog calls. Each call hits MAPS/cloud
    # reputation and can take 20-40s. With 6+ threats that's 2-4 minutes
    # PER HEARTBEAT for repeat lookups of unchanged threat IDs.
    #
    # The cache now survives both heartbeats (script scope) AND service
    # restarts (persisted to disk). First-ever boot still pays the catalog
    # tax; every subsequent boot is fast because the cache is loaded from
    # disk at startup. Threat IDs are stable across Defender catalog
    # updates so disk-cached entries stay valid indefinitely.
    if (-not (Test-Path Variable:Script:DefenderCatalogCache)) {
        $script:DefenderCatalogCachePath = 'C:\ProgramData\Mithras\defender-catalog-cache.json'
        $script:DefenderCatalogCache = @{}
        if (Test-Path $script:DefenderCatalogCachePath) {
            try {
                $raw = Get-Content $script:DefenderCatalogCachePath -Raw -ErrorAction Stop
                $obj = $raw | ConvertFrom-Json
                # ConvertFrom-Json gives PSCustomObject; convert back to hashtable
                foreach ($p in $obj.PSObject.Properties) {
                    $val = @{ name = $p.Value.name; sev_id = [int]$p.Value.sev_id }
                    $script:DefenderCatalogCache[[string]$p.Name] = $val
                }
            } catch {
                # Corrupt cache file -- delete and start fresh.
                try { Remove-Item $script:DefenderCatalogCachePath -Force -ErrorAction SilentlyContinue } catch {}
                $script:DefenderCatalogCache = @{}
            }
        }
    }
    function _GetCatalogInfo([string]$tid) {
        if (-not $tid) { return $null }
        if ($script:DefenderCatalogCache.ContainsKey($tid)) {
            $cached = $script:DefenderCatalogCache[$tid]
            # v0.7.10: don't honour a cached empty entry forever. Previously,
            # if the catalog lookup failed once (MAPS timeout, transient
            # network, unknown ID at the time) we stored {name=null,sev_id=0}
            # and every future heartbeat returned the same blanks - the UI
            # then showed "Unknown" severity + blank category permanently.
            # Treat empty cache entries as missing so the next heartbeat
            # re-queries the catalog.
            if ($cached -and $cached.name) { return $cached }
        }
        $info = @{ name = $null; sev_id = 0; category_id = 0 }
        try {
            $job = Start-Job -ScriptBlock {
                param($id) try { Get-MpThreatCatalog -ThreatID ([uint64]$id) -ErrorAction SilentlyContinue } catch { $null }
            } -ArgumentList $tid
            if (Wait-Job -Job $job -Timeout 4) {
                $c = Receive-Job -Job $job -ErrorAction SilentlyContinue
                if ($c) {
                    if ($c.ThreatName)            { $info.name = [string]$c.ThreatName }
                    if ($null -ne $c.SeverityID)  { $info.sev_id = [int]$c.SeverityID }
                    if ($null -ne $c.CategoryID)  { $info.category_id = [int]$c.CategoryID }
                }
            }
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        } catch {}
        # Only persist non-empty results. Empty lookups stay out of the
        # cache so the next call retries instead of returning the stale
        # blank forever.
        if ($info.name) {
            $script:DefenderCatalogCache[$tid] = $info
            try {
                $script:DefenderCatalogCache | ConvertTo-Json -Depth 4 -Compress |
                    Set-Content -Path $script:DefenderCatalogCachePath -Force -Encoding utf8
            } catch {}
        }
        return $info
    }

    # Microsoft Defender ThreatCategoryID → human-readable name. List from
    # the MpComputerStatus / ThreatCatalog schema; gaps are categories that
    # exist in the enum but were never observed in customer telemetry.
    # Falls back to "Category #N" so unmapped values are still distinguishable.
    function _CategoryName([int]$cid) {
        switch ($cid) {
            0  { 'Invalid' }
            1  { 'Adware' }
            2  { 'Spyware' }
            3  { 'PasswordStealer' }
            4  { 'TrojanDownloader' }
            5  { 'Worm' }
            6  { 'Backdoor' }
            7  { 'RemoteAccessTrojan' }
            8  { 'Trojan' }
            9  { 'EmailFlooder' }
            10 { 'Keylogger' }
            11 { 'Dialer' }
            12 { 'MonitoringSoftware' }
            13 { 'BrowserModifier' }
            14 { 'Cookie' }
            15 { 'BrowserPlugin' }
            16 { 'AolExploit' }
            17 { 'Nuker' }
            18 { 'SecurityDisabler' }
            19 { 'JokeProgram' }
            20 { 'HostileActiveXControl' }
            21 { 'SoftwareBundler' }
            22 { 'StealthNotifier' }
            23 { 'SettingsModifier' }
            24 { 'Toolbar' }
            25 { 'RemoteControlSoftware' }
            26 { 'TrojanFTP' }
            27 { 'PotentiallyUnwantedSoftware' }
            28 { 'ICQExploit' }
            29 { 'TrojanTelnet' }
            30 { 'Exploit' }
            31 { 'FileSharingProgram' }
            32 { 'MalwareCreationTool' }
            33 { 'RemoteControlSoftware' }
            34 { 'Tool' }
            36 { 'TrojanDoS' }
            37 { 'TrojanDropper' }
            38 { 'TrojanMassMailer' }
            39 { 'TrojanMonitoringSoftware' }
            40 { 'TrojanProxyServer' }
            42 { 'Virus' }
            43 { 'Known' }
            44 { 'Unknown' }
            45 { 'SuspiciousBehavior' }
            46 { 'Behavior' }
            47 { 'Vulnerability' }
            48 { 'PolicyViolation' }
            49 { 'EUS' }
            50 { 'Ransomware' }
            51 { 'HackTool' }
            52 { 'Phishing' }
            default { if ($cid -gt 0) { "Category #$cid" } else { $null } }
        }
    }

    $toStr = { param($v) [string]$v }
    $toInt = { param($v) try { [int]$v } catch { 0 } }

    $seen = @{}
    $threats = @()
    foreach ($t in ($detections | Select-Object -First $MaxThreats)) {
        try {
            $tid = $null
            if ($t.PSObject.Properties['ThreatID'] -and $null -ne $t.ThreatID) { $tid = [string]$t.ThreatID }
            elseif ($t.PSObject.Properties['ThreatId'] -and $null -ne $t.ThreatId) { $tid = [string]$t.ThreatId }
            elseif ($t.PSObject.Properties['DetectionID']) { $tid = [string]$t.DetectionID }
            if (-not $tid) { continue }
            if ($seen.ContainsKey($tid)) { continue }
            $seen[$tid] = $true

            # Microsoft Defender SeverityID enum:
            #   0=Unknown, 1=Low, 2=Moderate, 4=High, 5=Severe
            # Get-MpThreatDetection often returns 0 here; the catalog has the
            # real value. Try both, pick the higher non-zero result so a fresh
            # detection's value can't downgrade a catalog-known severe.
            $sevId   = & $toInt (_TryGet $t 'SeverityID' $toInt)
            $catInfo = _GetCatalogInfo $tid
            if ($catInfo -and $catInfo.sev_id -gt $sevId) { $sevId = $catInfo.sev_id }
            $sev = switch ($sevId) { 5 {'Severe'} 4 {'High'} 2 {'Moderate'} 1 {'Low'} default {'Unknown'} }

            $status = 'Active'
            $clean = _TryGet $t 'CleaningAction' $toInt
            if ($null -ne $clean) {
                switch ($clean) { 2 {$status='Cleaning'} 3 {$status='Quarantined'} 6 {$status='Removed'} 9 {$status='Allowed'} }
            }

            $resources = $null
            try {
                $rr = _TryGet $t 'Resources' $null
                if ($rr) { $resources = @($rr | ForEach-Object { [string]$_ }) }
            } catch {}

            $name = _TryGet $t 'ThreatName' $toStr
            if (-not $name -and $catInfo) { $name = $catInfo.name }

            # Category resolution: try the detection's CategoryID first, then
            # fall back to whatever the catalog returned. Map the integer to a
            # human-readable name. Previously this was the raw integer-as-string,
            # which is meaningless in the UI.
            $catId = & $toInt (_TryGet $t 'CategoryID' $toInt)
            if (($null -eq $catId -or $catId -le 0) -and $catInfo -and $catInfo.category_id -gt 0) {
                $catId = $catInfo.category_id
            }
            $catName = _CategoryName $catId

            # Threat name fallback: if both direct field and catalog returned
            # null, build a sensible label from category + id so the UI shows
            # something meaningful instead of blank. e.g. "HackTool detection
            # (id 2147829265)" rather than just "—".
            if (-not $name) {
                if ($catName) { $name = "$catName detection (id $tid)" }
                else          { $name = "Defender detection #$tid" }
            }

            $threats += @{
                threat_id   = $tid
                threat_name = $name
                severity    = $sev
                category    = $catName
                status      = $status
                initial_detection_time         = (_TryGet $t 'InitialDetectionTime'       { param($v) try {$v.ToString('o')} catch { $null } })
                last_threat_status_change_time = (_TryGet $t 'LastThreatStatusChangeTime' { param($v) try {$v.ToString('o')} catch { $null } })
                resources                      = $resources
            }
        } catch {
            _LogCollect 'WARN' ("threat normalize failed: " + $_.Exception.Message)
            continue
        }
    }
    _LogCollect 'INFO' ("threats: produced=" + $threats.Count)
    if ($CacheTtlSeconds -gt 0) {
        $script:DefenderThreatsCache = @{ payload = $threats; fetched_at = (Get-Date) }
    }
    return $threats
}

Export-ModuleMember -Function Get-DefenderStatusPayload, Get-DefenderThreatsPayload
