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
    # historical detections both calls enumerate every record, and the agent
    # heartbeat (30s as of v0.7.6) puts that work on WmiPrvSE twice a minute
    # even though the detection set rarely changes minute-to-minute. We've
    # measured this as the dominant WmiPrvSE CPU consumer on endpoints with
    # EICAR test fixtures or normal day-to-day threat history — making the
    # fingerprint cache below load-bearing now that we tick every 30s.
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
                # v0.7.16: skip empty cached entries when loading from disk.
                # Older versions persisted {name=null,sev_id=0} blanks if the
                # catalog lookup timed out, and the on-disk file accumulated
                # those entries. Loading them back into the script-scope cache
                # caused the v0.7.10 re-query check to fire on every heartbeat,
                # which then failed again under the old 4s timeout, leaving
                # the threat permanently nameless in the UI. Drop blanks on
                # load so a fresh (longer-timeout) lookup runs the next time.
                foreach ($p in $obj.PSObject.Properties) {
                    $name = [string]$p.Value.name
                    if (-not $name) { continue }
                    $val = @{
                        name        = $name
                        sev_id      = [int]$p.Value.sev_id
                        category_id = $(try { [int]$p.Value.category_id } catch { 0 })
                    }
                    $script:DefenderCatalogCache[[string]$p.Name] = $val
                }
            } catch {
                # Corrupt cache file -- delete and start fresh.
                try { Remove-Item $script:DefenderCatalogCachePath -Force -ErrorAction SilentlyContinue } catch {}
                $script:DefenderCatalogCache = @{}
            }
        }
    }
    # v0.7.16: per-heartbeat budget for cold catalog lookups. Get-MpThreatCatalog
    # is documented as a local-DB lookup but on real-world endpoints it actually
    # makes cloud-reputation calls and routinely takes 30-90 seconds per ID
    # (measured directly: 30-94s on the test box, even on the second call for
    # the same ID — Defender's own MAPS cache is unreliable). We can't afford
    # to spend that on the heartbeat thread, and we can't go fully async
    # without restructuring the collector. Compromise: do at most ONE cold
    # lookup per heartbeat with a 30s timeout. Cache hits are free, so once
    # the catalog is populated (N heartbeats after a clean install = N min)
    # the cost goes to zero permanently. New threats added later still take
    # one heartbeat each to populate.
    $script:DefenderCatalogColdLookupsThisCall = 0
    $maxColdLookupsPerCall = 1
    $catalogLookupTimeoutSec = 30
    function _GetCatalogInfo([string]$tid) {
        if (-not $tid) { return $null }
        if ($script:DefenderCatalogCache.ContainsKey($tid)) {
            $cached = $script:DefenderCatalogCache[$tid]
            if ($cached -and $cached.name) { return $cached }
        }
        # Budget check: only one cold lookup per heartbeat.
        if ($script:DefenderCatalogColdLookupsThisCall -ge $maxColdLookupsPerCall) {
            return @{ name = $null; sev_id = 0; category_id = 0 }
        }
        $script:DefenderCatalogColdLookupsThisCall++

        $info = @{ name = $null; sev_id = 0; category_id = 0 }
        # Run inside Start-Job so we can bound it. Inline calls blocked the
        # heartbeat for minutes (v0.7.15 in-development bug). The previous
        # 4s timeout was too short — Start-Job cold-spawn alone takes 2-4s,
        # leaving zero budget for the actual lookup. 30s gives the spawn +
        # lookup enough headroom on slow-MAPS endpoints.
        try {
            $job = Start-Job -ScriptBlock {
                param($id) try { Get-MpThreatCatalog -ThreatID ([uint64]$id) -ErrorAction SilentlyContinue } catch { $null }
            } -ArgumentList $tid
            if (Wait-Job -Job $job -Timeout $catalogLookupTimeoutSec) {
                $c = Receive-Job -Job $job -ErrorAction SilentlyContinue
                if ($c) {
                    if ($c.ThreatName)            { $info.name = [string]$c.ThreatName }
                    if ($null -ne $c.SeverityID)  { $info.sev_id = [int]$c.SeverityID }
                    if ($null -ne $c.CategoryID)  { $info.category_id = [int]$c.CategoryID }
                }
            } else {
                _LogCollect 'WARN' ("catalog lookup timed out for tid=$tid after ${catalogLookupTimeoutSec}s")
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
            # v0.7.16: don't surface Defender's enum-value-zero label as a
            # category. CategoryID=0 means "no category" and the old code
            # returned the literal string "Invalid", which the name-fallback
            # template ($catName + " detection (id $tid)") then turned into
            # the user-facing "Invalid detection (id 2147829265)" — confusing
            # because it implies the detection itself is invalid, not that
            # we just couldn't categorise it.
            0  { $null }
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

    # v0.7.16: pre-warm the catalog cache for all detections in parallel.
    # _GetCatalogInfo is bounded to ONE cold lookup per heartbeat (because each
    # cold call can run 30-90s through MAPS), so sequential population would
    # take minutes-per-heartbeat × N heartbeats to finish. Launching all
    # uncached lookups as parallel Start-Job instances and waiting once for
    # them all collapses that to a single 30s window — usually less, since
    # Defender's cold-MAPS calls return in 30-50s and they run concurrently.
    # After this loop the per-threat _GetCatalogInfo calls in the main
    # foreach become cache hits and are free.
    $needLookup = @()
    foreach ($t in ($detections | Select-Object -First $MaxThreats)) {
        $tid = $null
        if ($t.PSObject.Properties['ThreatID'] -and $null -ne $t.ThreatID) { $tid = [string]$t.ThreatID }
        elseif ($t.PSObject.Properties['ThreatId'] -and $null -ne $t.ThreatId) { $tid = [string]$t.ThreatId }
        elseif ($t.PSObject.Properties['DetectionID']) { $tid = [string]$t.DetectionID }
        if (-not $tid) { continue }
        if ($script:DefenderCatalogCache.ContainsKey($tid) -and $script:DefenderCatalogCache[$tid].name) { continue }
        if ($needLookup -notcontains $tid) { $needLookup += $tid }
    }
    if ($needLookup.Count -gt 0) {
        _LogCollect 'INFO' ("catalog pre-warm: launching " + $needLookup.Count + " parallel lookups")
        $jobs = @{}
        foreach ($tid in $needLookup) {
            $jobs[$tid] = Start-Job -ScriptBlock {
                param($id) try { Get-MpThreatCatalog -ThreatID ([uint64]$id) -ErrorAction SilentlyContinue } catch { $null }
            } -ArgumentList $tid
        }
        # 180s shared budget. Measured: on a test box with 5-6 cold IDs,
        # parallel lookups all complete in ~170s — each individual MAPS
        # call is 30-50s and Defender appears to serialise them server-side.
        # Wait-Job with -Job @list blocks until the LAST one completes or
        # the timeout fires, so all jobs share the window. (A previous
        # attempt did Wait-Job per job in a foreach loop, which serialised
        # the waits and only the first job ever got harvested.)
        # First heartbeat after a fresh install will be ~3 min, every
        # subsequent heartbeat is a cache hit and free.
        $allJobs = @($jobs.Values)
        Wait-Job -Job $allJobs -Timeout 180 | Out-Null
        $populated = 0
        foreach ($tid in $needLookup) {
            $job = $jobs[$tid]
            if ($job.State -eq 'Completed') {
                $c = Receive-Job -Job $job -ErrorAction SilentlyContinue
                if ($c -and $c.ThreatName) {
                    $script:DefenderCatalogCache[$tid] = @{
                        name        = [string]$c.ThreatName
                        sev_id      = $(if ($null -ne $c.SeverityID) { [int]$c.SeverityID } else { 0 })
                        category_id = $(if ($null -ne $c.CategoryID) { [int]$c.CategoryID } else { 0 })
                    }
                    $populated++
                }
            }
        }
        foreach ($tid in $needLookup) {
            try { Remove-Job -Job $jobs[$tid] -Force -ErrorAction SilentlyContinue } catch {}
        }
        if ($populated -gt 0) {
            try {
                $script:DefenderCatalogCache | ConvertTo-Json -Depth 4 -Compress |
                    Set-Content -Path $script:DefenderCatalogCachePath -Force -Encoding utf8
            } catch {}
        }
        _LogCollect 'INFO' ("catalog pre-warm: populated " + $populated + "/" + $needLookup.Count)
    }
    # Reset the per-call cold-lookup budget so the inline _GetCatalogInfo
    # below treats any remaining misses (unlikely after pre-warm) as
    # budget-bounded individual lookups.
    $script:DefenderCatalogColdLookupsThisCall = 0

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
