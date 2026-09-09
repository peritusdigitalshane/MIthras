# PolicyEnforcer.psm1 -- Mithras v0.4.6 module
#
# Ports UAC / Firewall / Windows Update / Defender / GPO policy enforcement
# from the legacy bearer-token agent into the v0.4.5 module framework.
# Fixes the PowerShell syntax bug `(if x { 1 } else { 0 })` that silently
# broke Network Protection, Controlled Folder Access, and ASR rule application
# on every legacy install.
#
# Uses the existing legacy agent.json bearer token + on-prem /agent-api/*
# endpoints (which work correctly with the token).

# Prefer the new Mithras location; fall back to the legacy PeritusSecure path
# for endpoints that haven't migrated their agent.json across yet.
$script:LegacyConfigPath = Join-Path $env:ProgramData 'Mithras\agent.json'
if (-not (Test-Path $script:LegacyConfigPath)) {
    $alt = Join-Path $env:ProgramData 'PeritusSecure\agent.json'
    if (Test-Path $alt) { $script:LegacyConfigPath = $alt }
}
$script:PolicyHashFile   = Join-Path $env:ProgramData 'Mithras\policy_hash.txt'
$script:ApiBaseUrl       = 'https://api.mithras.com.au/functions/v1/agent-api'

$script:AsrRuleGuids = @{
    'block_office_child_process'        = 'd4f940ab-401b-4efc-aadc-ad5f3c50688a'
    'block_office_executable_content'   = '3b576869-a4ec-4529-8536-b80a7769e899'
    'block_office_code_injection'       = '75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84'
    'block_js_vbs_executable'           = 'd3e037e1-3eb8-44c8-a917-57927947596d'
    'block_obfuscated_scripts'          = '5beb7efe-fd9a-4556-801d-275e5ffc04cc'
    'block_office_macro_win32'          = '92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b'
    'block_untrusted_executables'       = '01443614-cd74-433a-b99e-2ecdc07bfc25'
    'advanced_ransomware_protection'    = 'c1db55a8-c869-4a30-a4e8-3fce2c1f8e6b'
    'block_credential_stealing'         = '9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2'
    'block_psexec_wmi'                  = 'd1e49aac-8f56-4280-b9ba-993a6d77406c'
    'block_usb_untrusted'               = 'b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4'
    'block_office_comms_child_process'  = '26190899-1602-49e8-8b27-eb1d0a1ce869'
    'block_adobe_child_process'         = '7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c'
    'block_wmi_persistence'             = 'e6db77e5-3df2-4cf1-b95a-636979351e5b'
    'block_vulnerable_drivers'          = '56a863a9-875e-4185-98a7-b882c64b5ce5'
    'block_email_executable'            = 'be9ba2d9-53ea-4cdc-84e5-9b1eeee46550'
}

function Write-PolicyLog {
    param([string]$Message, [string]$Level = 'Info')
    try {
        if (Get-Command Write-AgentLog -ErrorAction SilentlyContinue) {
            Write-AgentLog -Level $Level -Message ('[Policy] ' + $Message)
        } else {
            Write-Host "[$Level] [Policy] $Message"
        }
    } catch {}
}

function Get-LegacyAgentToken {
    # v0.7.5: in-memory cache populated by mithras-agent.ps1 from the
    # heartbeat response. Fresh HMAC-only installs never write agent.json,
    # so the file-based lookup below returns $null and the 6 subsystems
    # that use this helper (firewall audit shipping, app whitelist policy
    # fetch + pass, WDAC fetch, DNS policy fetch, Sysmon ship, policy
    # enforcement) all silently no-op. The cache plugs that gap without
    # forcing every endpoint to first persist agent.json on disk.
    if ($script:CachedLegacyAgentToken) { return $script:CachedLegacyAgentToken }
    if (-not (Test-Path $script:LegacyConfigPath)) { return $null }
    try {
        $cfg = Get-Content $script:LegacyConfigPath -Raw | ConvertFrom-Json
        return $cfg.agent_token
    } catch { return $null }
}

function Set-CachedLegacyAgentToken {
    param([string]$Token)
    if ($Token) { $script:CachedLegacyAgentToken = $Token }
}

function Clear-CachedLegacyAgentToken {
    # Belt + braces for endpoint deactivation. agent-api/validateAgentToken
    # now rejects deactivated endpoints (agent v0.7.7 + matching server),
    # so a stale cached token is useless. Clearing it on observed 401s
    # speeds up the silent no-op behaviour by avoiding a heartbeat-cycle
    # round-trip per subsystem retry.
    $script:CachedLegacyAgentToken = $null
}

function Invoke-PolicyApi {
    param([Parameter(Mandatory)][string]$Path)
    $token = Get-LegacyAgentToken
    if (-not $token) { return $null }
    try {
        $headers = @{ 'Content-Type' = 'application/json'; 'x-agent-token' = $token }
        return Invoke-RestMethod -Uri "$script:ApiBaseUrl/$Path" -Method GET -Headers $headers -TimeoutSec 20 -ErrorAction Stop
    } catch {
        Write-PolicyLog "API $Path failed: $($_.Exception.Message)" 'Warn'
        return $null
    }
}

# ---------------------------------------------------------------------------
# DEFENDER (full ASR + exclusions + controlled folder access + network protection)
# ---------------------------------------------------------------------------
function Convert-AsrAction {
    param([string]$Action)
    switch ($Action) {
        'disabled'      { return 0 }
        'enabled'       { return 1 }
        'audit'         { return 2 }
        'warn'          { return 6 }
        'block'         { return 1 }
        default         { return 0 }
    }
}

function Apply-DefenderPolicy {
    param([Parameter(Mandatory)]$Policy, [switch]$Force)
    if (-not $Policy) { Write-PolicyLog 'No Defender policy to apply'; return $false }
    $policyVersion = $Policy.updated_at
    $oldVersion = ''
    if (Test-Path $script:PolicyHashFile) { $oldVersion = Get-Content $script:PolicyHashFile -Raw -ErrorAction SilentlyContinue }
    if (-not $Force -and $policyVersion -eq $oldVersion) { return $false }

    # Defender cmdlets only exist where Defender is installed (Windows 10/11 +
    # Server 2016+, NOT Server Core minimal or Server 2012). Skip cleanly.
    if (-not (Get-Command -Name 'Set-MpPreference' -ErrorAction SilentlyContinue)) {
        Write-PolicyLog "Defender Set-MpPreference cmdlet not available on this SKU; Defender policy skipped." 'Warn'
        return $false
    }

    Write-PolicyLog "Applying Defender policy: $($Policy.name)"
    try {
        $mp = @{}
        if ($null -ne $Policy.realtime_monitoring)             { $mp.DisableRealtimeMonitoring = -not $Policy.realtime_monitoring }
        if ($null -ne $Policy.behavior_monitoring)             { $mp.DisableBehaviorMonitoring = -not $Policy.behavior_monitoring }
        if ($null -ne $Policy.ioav_protection)                 { $mp.DisableIOAVProtection     = -not $Policy.ioav_protection }
        if ($null -ne $Policy.script_scanning)                 { $mp.DisableScriptScanning     = -not $Policy.script_scanning }
        if ($null -ne $Policy.removable_drive_scanning)        { $mp.DisableRemovableDriveScanning = -not $Policy.removable_drive_scanning }
        if ($null -ne $Policy.archive_scanning)                { $mp.DisableArchiveScanning    = -not $Policy.archive_scanning }
        if ($null -ne $Policy.email_scanning)                  { $mp.DisableEmailScanning      = -not $Policy.email_scanning }
        if ($null -ne $Policy.check_signatures_before_scan)    { $mp.CheckForSignaturesBeforeRunningScan = [bool]$Policy.check_signatures_before_scan }
        if ($null -ne $Policy.block_at_first_seen)             { $mp.DisableBlockAtFirstSeen   = -not $Policy.block_at_first_seen }
        if ($Policy.cloud_block_level) {
            $mp.CloudBlockLevel = switch ($Policy.cloud_block_level) { 'Default' { 0 } 'Moderate' { 1 } 'High' { 2 } 'HighPlus' { 4 } 'ZeroTolerance' { 6 } default { 2 } }
        }
        if ($null -ne $Policy.cloud_extended_timeout)          { $mp.CloudExtendedTimeout      = [int]$Policy.cloud_extended_timeout }
        if ($Policy.sample_submission) {
            $mp.SubmitSamplesConsent = switch ($Policy.sample_submission) { 'None' { 0 } 'SendSafeSamples' { 1 } 'SendAllSamples' { 3 } 'AlwaysPrompt' { 2 } default { 3 } }
        }
        if ($null -ne $Policy.cloud_delivered_protection)      { $mp.MAPSReporting             = if ($Policy.cloud_delivered_protection) { 2 } else { 0 } }
        if ($null -ne $Policy.pua_protection)                  { $mp.PUAProtection             = if ($Policy.pua_protection) { 1 } else { 0 } }
        if ($null -ne $Policy.signature_update_interval)       { $mp.SignatureUpdateInterval   = [int]$Policy.signature_update_interval }
        if ($mp.Count -gt 0) {
            Set-MpPreference @mp -ErrorAction Stop
            Write-PolicyLog ("Set-MpPreference applied: {0} keys" -f $mp.Count)
        }

        # Network Protection (FIXED: legacy had a `(if ...)` parse error here)
        if ($null -ne $Policy.network_protection) {
            $np = if ($Policy.network_protection) { 1 } else { 0 }
            Set-MpPreference -EnableNetworkProtection $np -ErrorAction Stop
        }
        # Controlled Folder Access
        if ($null -ne $Policy.controlled_folder_access) {
            $cfa = if ($Policy.controlled_folder_access) { 1 } else { 0 }
            Set-MpPreference -EnableControlledFolderAccess $cfa -ErrorAction Stop
        }

        # ASR rules
        $asrIds = @(); $asrActions = @()
        foreach ($pk in $script:AsrRuleGuids.Keys) {
            $field = 'asr_' + $pk
            $value = $Policy.$field
            if ($value) {
                $asrIds     += $script:AsrRuleGuids[$pk]
                $asrActions += Convert-AsrAction -Action $value
            }
        }
        if ($asrIds.Count -gt 0) {
            Set-MpPreference -AttackSurfaceReductionRules_Ids $asrIds -AttackSurfaceReductionRules_Actions $asrActions -ErrorAction Stop
            Write-PolicyLog ("ASR rules configured: {0}" -f $asrIds.Count)
        }

        # Exclusions
        if ($Policy.exclusion_paths -and $Policy.exclusion_paths.Count -gt 0) {
            Set-MpPreference -ExclusionPath $Policy.exclusion_paths -ErrorAction SilentlyContinue
        }
        if ($Policy.exclusion_processes -and $Policy.exclusion_processes.Count -gt 0) {
            Set-MpPreference -ExclusionProcess $Policy.exclusion_processes -ErrorAction SilentlyContinue
        }
        if ($Policy.exclusion_extensions -and $Policy.exclusion_extensions.Count -gt 0) {
            Set-MpPreference -ExclusionExtension $Policy.exclusion_extensions -ErrorAction SilentlyContinue
        }

        $policyVersion | Set-Content -Path $script:PolicyHashFile -Force
        Write-PolicyLog "Defender policy applied successfully"
        return $true
    } catch {
        Write-PolicyLog "Defender Apply error: $_" 'Error'
        return $false
    }
}

# ---------------------------------------------------------------------------
# UAC
# ---------------------------------------------------------------------------
$script:UacRegPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'

function Get-UacStatus {
    $vals = @{}
    foreach ($n in 'EnableLUA','ConsentPromptBehaviorAdmin','ConsentPromptBehaviorUser','PromptOnSecureDesktop','FilterAdministratorToken','ValidateAdminCodeSignatures','EnableInstallerDetection','EnableSecureUIAPaths') {
        $vals[$n] = (Get-ItemProperty -Path $script:UacRegPath -Name $n -ErrorAction SilentlyContinue).$n
    }
    return [pscustomobject]@{
        uac_enabled                      = [bool]($vals.EnableLUA -eq 1)
        uac_consent_prompt_admin         = [int]$vals.ConsentPromptBehaviorAdmin
        uac_consent_prompt_user          = [int]$vals.ConsentPromptBehaviorUser
        uac_prompt_on_secure_desktop     = [bool]($vals.PromptOnSecureDesktop -eq 1)
        uac_filter_administrator_token   = [bool]($vals.FilterAdministratorToken -eq 1)
        uac_validate_admin_signatures    = [bool]($vals.ValidateAdminCodeSignatures -eq 1)
        uac_detect_installations         = [bool]($vals.EnableInstallerDetection -eq 1)
    }
}

function Apply-UacPolicy {
    param([Parameter(Mandatory)]$Policy)
    if (-not $Policy -or -not $Policy.has_policy) { return $false }
    $p = $Policy.policy
    if (-not $p) { return $false }
    Write-PolicyLog "Applying UAC policy: $($p.name)"
    try {
        $map = @{
            'EnableLUA'                      = if ($p.enable_lua)                       { 1 } else { 0 }
            'ConsentPromptBehaviorAdmin'     = if ($null -ne $p.consent_prompt_admin)   { [int]$p.consent_prompt_admin } else { 5 }
            'ConsentPromptBehaviorUser'      = if ($null -ne $p.consent_prompt_user)    { [int]$p.consent_prompt_user }  else { 3 }
            'PromptOnSecureDesktop'          = if ($p.prompt_on_secure_desktop)         { 1 } else { 0 }
            'FilterAdministratorToken'       = if ($p.filter_administrator_token)      { 1 } else { 0 }
            'ValidateAdminCodeSignatures'    = if ($p.validate_admin_signatures)       { 1 } else { 0 }
            'EnableInstallerDetection'       = if ($p.detect_installations)            { 1 } else { 0 }
        }
        if (-not (Test-Path $script:UacRegPath)) { New-Item -Path $script:UacRegPath -Force | Out-Null }
        foreach ($k in $map.Keys) {
            Set-ItemProperty -Path $script:UacRegPath -Name $k -Value $map[$k] -Type DWord -Force -ErrorAction Stop
        }
        Write-PolicyLog "UAC policy applied ($($map.Count) values)"
        return $true
    } catch {
        Write-PolicyLog "UAC Apply error: $_" 'Error'
        return $false
    }
}

# ---------------------------------------------------------------------------
# WINDOWS UPDATE
# ---------------------------------------------------------------------------
$script:WuRegPath  = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
$script:WuAuPath   = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'

function Ensure-RegPath {
    param([string]$Path)
    if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
}

function Get-WindowsUpdateStatus {
    Ensure-RegPath $script:WuRegPath
    Ensure-RegPath $script:WuAuPath
    $au = Get-ItemProperty -Path $script:WuAuPath -ErrorAction SilentlyContinue
    $wu = Get-ItemProperty -Path $script:WuRegPath -ErrorAction SilentlyContinue
    $pendingReboot = $false
    foreach ($p in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
                   'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') {
        if (Test-Path $p) { $pendingReboot = $true }
    }
    return [pscustomobject]@{
        wu_auto_update_mode        = [int]$au.AUOptions
        wu_active_hours_start      = [int]$wu.ActiveHoursStart
        wu_active_hours_end        = [int]$wu.ActiveHoursEnd
        wu_feature_update_deferral = [int]$wu.DeferFeatureUpdatesPeriodInDays
        wu_quality_update_deferral = [int]$wu.DeferQualityUpdatesPeriodInDays
        wu_pause_feature_updates   = [bool]($wu.PauseFeatureUpdates -eq 1)
        wu_pause_quality_updates   = [bool]($wu.PauseQualityUpdates -eq 1)
        wu_restart_pending         = $pendingReboot
    }
}

function Apply-WindowsUpdatePolicy {
    param([Parameter(Mandatory)]$Policy)
    if (-not $Policy -or -not $Policy.has_policy) { return $false }
    $p = $Policy.policy
    if (-not $p) { return $false }
    Write-PolicyLog "Applying WU policy: $($p.name)"
    try {
        Ensure-RegPath $script:WuRegPath
        Ensure-RegPath $script:WuAuPath
        if ($null -ne $p.auto_update_mode)        { Set-ItemProperty -Path $script:WuAuPath  -Name 'AUOptions'                       -Value ([int]$p.auto_update_mode)        -Type DWord -Force }
        if ($null -ne $p.active_hours_start)      { Set-ItemProperty -Path $script:WuRegPath -Name 'ActiveHoursStart'                -Value ([int]$p.active_hours_start)      -Type DWord -Force }
        if ($null -ne $p.active_hours_end)        { Set-ItemProperty -Path $script:WuRegPath -Name 'ActiveHoursEnd'                  -Value ([int]$p.active_hours_end)        -Type DWord -Force }
        if ($null -ne $p.feature_update_deferral) { Set-ItemProperty -Path $script:WuRegPath -Name 'DeferFeatureUpdatesPeriodInDays' -Value ([int]$p.feature_update_deferral) -Type DWord -Force }
        if ($null -ne $p.quality_update_deferral) { Set-ItemProperty -Path $script:WuRegPath -Name 'DeferQualityUpdatesPeriodInDays' -Value ([int]$p.quality_update_deferral) -Type DWord -Force }
        if ($null -ne $p.pause_feature_updates) {
            $pfu = if ($p.pause_feature_updates) { 1 } else { 0 }
            Set-ItemProperty -Path $script:WuRegPath -Name 'PauseFeatureUpdates' -Value $pfu -Type DWord -Force
        }
        if ($null -ne $p.pause_quality_updates) {
            $pqu = if ($p.pause_quality_updates) { 1 } else { 0 }
            Set-ItemProperty -Path $script:WuRegPath -Name 'PauseQualityUpdates' -Value $pqu -Type DWord -Force
        }
        Write-PolicyLog "WU policy applied"
        return $true
    } catch {
        Write-PolicyLog "WU Apply error: $_" 'Error'
        return $false
    }
}

# ---------------------------------------------------------------------------
# UPDATE RING (group-assigned patch deployment tier)
#
# The ring overrides the WU policy's defer-days + active-hours when set,
# because the ring is the more authoritative group-level decision. We
# only touch the four keys the ring owns; the WU policy still controls
# AUOptions, pause flags, etc.
#
# `critical_only` rings push a 365-day feature update defer and pin the
# branch-readiness level so the machine only takes security cumulatives.
# ---------------------------------------------------------------------------
function Apply-UpdateRing {
    param([Parameter(Mandatory)]$RingPayload)
    if (-not $RingPayload -or -not $RingPayload.has_ring) { return $false }
    $r = $RingPayload.ring
    if (-not $r) { return $false }
    Write-PolicyLog "Applying update ring: $($r.name)"
    try {
        Ensure-RegPath $script:WuRegPath

        # Defer days. Ring wins over WU policy for these two keys.
        if ($null -ne $r.quality_update_defer_days) {
            Set-ItemProperty -Path $script:WuRegPath -Name 'DeferQualityUpdatesPeriodInDays' `
                -Value ([int]$r.quality_update_defer_days) -Type DWord -Force
        }
        if ($null -ne $r.feature_update_defer_days) {
            Set-ItemProperty -Path $script:WuRegPath -Name 'DeferFeatureUpdatesPeriodInDays' `
                -Value ([int]$r.feature_update_defer_days) -Type DWord -Force
        }

        # Install window mapped to ActiveHoursStart / ActiveHoursEnd. Windows
        # Update won't restart for non-business installs during this window;
        # outside it, deferred installs may proceed.
        if ($null -ne $r.install_window_start_local) {
            Set-ItemProperty -Path $script:WuRegPath -Name 'ActiveHoursStart' `
                -Value ([int]$r.install_window_start_local) -Type DWord -Force
        }
        if ($null -ne $r.install_window_end_local) {
            Set-ItemProperty -Path $script:WuRegPath -Name 'ActiveHoursEnd' `
                -Value ([int]$r.install_window_end_local) -Type DWord -Force
        }

        # Critical-only: pin to security-only and lock out feature updates.
        if ($r.critical_only) {
            Set-ItemProperty -Path $script:WuRegPath -Name 'DeferFeatureUpdatesPeriodInDays' -Value 365 -Type DWord -Force
            # BranchReadinessLevel 20 = Semi-Annual Channel (Targeted) — slowest stable channel.
            Set-ItemProperty -Path $script:WuRegPath -Name 'BranchReadinessLevel' -Value 20 -Type DWord -Force
        } else {
            # If ring is NOT critical-only, clear any prior pin so the
            # machine doesn't get stuck on SAC-T after the ring changes.
            try { Remove-ItemProperty -Path $script:WuRegPath -Name 'BranchReadinessLevel' -ErrorAction SilentlyContinue } catch {}
        }

        Write-PolicyLog "Update ring applied: defer Q=$($r.quality_update_defer_days)d F=$($r.feature_update_defer_days)d window=$($r.install_window_start_local)-$($r.install_window_end_local) critical_only=$($r.critical_only)"
        return $true
    } catch {
        Write-PolicyLog "Update ring apply error: $_" 'Error'
        return $false
    }
}

# ---------------------------------------------------------------------------
# FIREWALL (Windows Defender Firewall rules)
# ---------------------------------------------------------------------------
function Apply-FirewallPolicy {
    param([Parameter(Mandatory)]$Policy)
    if (-not $Policy -or -not $Policy.success) { return $false }
    $rules = $Policy.rules
    if (-not $rules -or $rules.Count -eq 0) { return $false }
    if (-not (Get-Command -Name 'Get-NetFirewallRule' -ErrorAction SilentlyContinue)) {
        Write-PolicyLog "NetSecurity cmdlets not available -- falling back to netsh." 'Info'
        return Apply-FirewallPolicyViaNetsh -Policy $Policy
    }
    # MICROSEGMENTATION MODEL
    #   mode='enforce' rules create a real Windows Firewall Block rule, scoped
    #     by allowed_source_ips (whitelist) when provided.
    #   mode='audit' rules do NOT install a block rule. Their traffic is observed
    #     by FirewallAuditCollector reading pfirewall.log and reported back to
    #     the platform so the operator can decide what to lock down. This is
    #     the "learn" phase of the lockdown cycle.

    $enforceRules = ($rules | Where-Object { $_.mode -eq 'enforce' })
    $auditRules   = ($rules | Where-Object { $_.mode -ne 'enforce' })
    Write-PolicyLog ("Applying firewall policy: {0} enforce rules + {1} audit-only" -f $enforceRules.Count, $auditRules.Count)
    $created = 0; $kept = 0; $removed = 0; $errored = 0

    # Dedup: same (service|proto|port|action|direction) shouldn't install twice.
    $byKey = @{}
    foreach ($r in $enforceRules) {
        $dir = if ($r.direction) { ([string]$r.direction).ToLower() } else { 'inbound' }
        $k = "{0}|{1}|{2}|{3}|{4}" -f $r.service_name, ($r.protocol -as [string]).ToLower(), $r.port, $r.action, $dir
        $byKey[$k] = $r
    }

    $wantedNames = New-Object System.Collections.Generic.HashSet[string]
    foreach ($r in $byKey.Values) {
        $dirLower = if ($r.direction) { ([string]$r.direction).ToLower() } else { 'inbound' }
        $dirCap   = if ($dirLower -eq 'outbound') { 'Outbound' } else { 'Inbound' }
        $dirTag   = if ($dirLower -eq 'outbound') { 'out' } else { 'in' }
        $blockName = "Mithras-{0}-{1}-{2}-{3}-{4}" -f $r.service_name, $r.protocol, $r.port, $r.action, $dirTag
        $allowName = "Mithras-{0}-{1}-{2}-{3}-allow-whitelist" -f $r.service_name, $r.protocol, $r.port, $dirTag
        [void]$wantedNames.Add($blockName)
        $action   = if ($r.action -eq 'block') { 'Block' } else { 'Allow' }
        $proto    = if ($r.protocol) { $r.protocol.ToUpper() } else { 'TCP' }
        $ports    = $r.port -split ',' | ForEach-Object { $_.Trim() }
        try {
            # 1) Catch-all rule (the actual enforcement)
            $existing = Get-NetFirewallRule -DisplayName $blockName -ErrorAction SilentlyContinue
            if ($existing) { $existing | Remove-NetFirewallRule -ErrorAction SilentlyContinue }
            $blockArgs = @{
                DisplayName = $blockName
                Direction   = $dirCap
                Action      = $action
                Protocol    = $proto
                Enabled     = 'True'
                Description = "Managed by Mithras (rule_id=$($r.id), direction=$dirLower)"
                ErrorAction = 'Stop'
            }
            # For inbound, the "service port" is the LOCAL port (what we're
            # listening on). For outbound, it's the REMOTE port (what we're
            # connecting to). Windows Firewall has separate args for each.
            if ($dirLower -eq 'outbound') {
                $blockArgs['RemotePort'] = $ports
            } else {
                $blockArgs['LocalPort']  = $ports
            }
            New-NetFirewallRule @blockArgs | Out-Null

            # 2) Allow-whitelist rule (Windows Firewall: Allow > Block when both match).
            $existingAllow = Get-NetFirewallRule -DisplayName $allowName -ErrorAction SilentlyContinue
            if ($existingAllow) { $existingAllow | Remove-NetFirewallRule -ErrorAction SilentlyContinue }
            if ($r.action -eq 'block' -and $r.allowed_source_ips -and $r.allowed_source_ips.Count -gt 0) {
                [void]$wantedNames.Add($allowName)
                $allowArgs = @{
                    DisplayName   = $allowName
                    Direction     = $dirCap
                    Action        = 'Allow'
                    Protocol      = $proto
                    RemoteAddress = $r.allowed_source_ips
                    Enabled       = 'True'
                    Description   = "Managed by Mithras (whitelist for rule_id=$($r.id), direction=$dirLower)"
                    ErrorAction   = 'Stop'
                }
                if ($dirLower -eq 'outbound') {
                    $allowArgs['RemotePort'] = $ports
                } else {
                    $allowArgs['LocalPort']  = $ports
                }
                New-NetFirewallRule @allowArgs | Out-Null
            }
            $created++
        } catch {
            Write-PolicyLog "Firewall rule '$blockName' error: $_" 'Warn'
            $errored++
        }
    }

    # GC: drop Mithras-* rules no longer in the policy (covers audit-mode flips
    # back from enforce, and service renames).
    Get-NetFirewallRule -DisplayName 'Mithras-*' -ErrorAction SilentlyContinue | ForEach-Object {
        if (-not $wantedNames.Contains($_.DisplayName)) {
            $_ | Remove-NetFirewallRule -ErrorAction SilentlyContinue
            $removed++
        } else { $kept++ }
    }

    Write-PolicyLog ("Firewall policy applied: created={0} kept={1} removed={2} errored={3}" -f $created, $kept, $removed, $errored)
    return $true
}

# netsh fallback for Server Core / older SKUs that lack the NetSecurity module.
# Works on every Windows version from XP SP2 onward.
function Apply-FirewallPolicyViaNetsh {
    param($Policy)
    $rules = $Policy.rules
    $applied = 0; $errored = 0
    foreach ($r in $rules) {
        $ruleName = "Mithras-{0}-{1}-{2}-{3}" -f $r.service_name, $r.protocol, $r.port, $r.action
        $action   = if ($r.action -eq 'block') { 'block' } else { 'allow' }
        $proto    = if ($r.protocol) { $r.protocol.ToLower() } else { 'tcp' }
        $port     = ($r.port -split ',' | ForEach-Object { $_.Trim() }) -join ','
        try {
            & netsh advfirewall firewall delete rule name="$ruleName" 2>&1 | Out-Null
            & netsh advfirewall firewall add rule name="$ruleName" dir=in action=$action protocol=$proto localport=$port enable=yes 2>&1 | Out-Null
            $applied++
        } catch {
            $errored++
        }
    }
    Write-PolicyLog ("Firewall policy applied via netsh: applied={0} errored={1}" -f $applied, $errored)
    return $true
}

# Detect Server SKU -- some GPO settings only apply to client editions
# (lock-screen camera, Game Bar, sleep on AC for desktops without battery, etc).
function Get-IsServerSku {
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        # ProductType: 1=Workstation, 2=DC, 3=Server
        return ($os.ProductType -ne 1)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# GPO -- every column from public.gpo_policies, applied via the appropriate
# Windows surface (net accounts / secedit / auditpol / registry / powercfg).
# ---------------------------------------------------------------------------
function Set-RegValue {
    param([string]$Path, [string]$Name, $Value, [string]$Type = 'DWord')
    try {
        if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
        Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -Force -ErrorAction Stop
        return $true
    } catch { return $false }
}

# Maps each DB column to subcategory GUIDs (NOT names). Subcategory names are
# localized -- "Logon" is "Anmelden" on German Windows, "Inicio de sesi?n" on
# Spanish, "????" on Japanese -- and `auditpol /subcategory:"<name>"` only
# matches the local language. GUIDs are stable across every Windows SKU and
# every language pack.
#
# Reference: https://docs.microsoft.com/windows/security/threat-protection/auditing/audit-policy
$script:GpoAuditMap = @{
    audit_logon_events       = @('{0CCE9215-69AE-11D9-BED3-505054503030}','{0CCE9216-69AE-11D9-BED3-505054503030}','{0CCE921B-69AE-11D9-BED3-505054503030}')
    audit_account_logon      = @('{0CCE923F-69AE-11D9-BED3-505054503030}','{0CCE9240-69AE-11D9-BED3-505054503030}','{0CCE9241-69AE-11D9-BED3-505054503030}')
    audit_account_management = @('{0CCE9235-69AE-11D9-BED3-505054503030}','{0CCE9236-69AE-11D9-BED3-505054503030}','{0CCE9237-69AE-11D9-BED3-505054503030}','{0CCE9239-69AE-11D9-BED3-505054503030}','{0CCE9238-69AE-11D9-BED3-505054503030}','{0CCE923A-69AE-11D9-BED3-505054503030}')
    audit_object_access      = @('{0CCE921D-69AE-11D9-BED3-505054503030}','{0CCE921E-69AE-11D9-BED3-505054503030}','{0CCE921F-69AE-11D9-BED3-505054503030}','{0CCE9220-69AE-11D9-BED3-505054503030}','{0CCE9227-69AE-11D9-BED3-505054503030}')
    audit_policy_change      = @('{0CCE922F-69AE-11D9-BED3-505054503030}','{0CCE9230-69AE-11D9-BED3-505054503030}','{0CCE9231-69AE-11D9-BED3-505054503030}','{0CCE9232-69AE-11D9-BED3-505054503030}','{0CCE9234-69AE-11D9-BED3-505054503030}')
    audit_privilege_use      = @('{0CCE9228-69AE-11D9-BED3-505054503030}','{0CCE9229-69AE-11D9-BED3-505054503030}','{0CCE922A-69AE-11D9-BED3-505054503030}')
    audit_process_tracking   = @('{0CCE922B-69AE-11D9-BED3-505054503030}','{0CCE922C-69AE-11D9-BED3-505054503030}','{0CCE922E-69AE-11D9-BED3-505054503030}','{0CCE922D-69AE-11D9-BED3-505054503030}')
    audit_system_events      = @('{0CCE9210-69AE-11D9-BED3-505054503030}','{0CCE9211-69AE-11D9-BED3-505054503030}','{0CCE9212-69AE-11D9-BED3-505054503030}','{0CCE9213-69AE-11D9-BED3-505054503030}','{0CCE9214-69AE-11D9-BED3-505054503030}')
    audit_ds_access          = @('{0CCE923B-69AE-11D9-BED3-505054503030}','{0CCE923C-69AE-11D9-BED3-505054503030}','{0CCE923D-69AE-11D9-BED3-505054503030}','{0CCE923E-69AE-11D9-BED3-505054503030}')
}

function Apply-AuditValue {
    param([string]$SubcategoryGuid, [string]$Mode)
    # Mode is one of: none | success | failure | success_failure
    $succ = 'disable'; $fail = 'disable'
    switch ($Mode) {
        'success'         { $succ = 'enable' }
        'failure'         { $fail = 'enable' }
        'success_failure' { $succ = 'enable'; $fail = 'enable' }
    }
    & auditpol /set /subcategory:$SubcategoryGuid /success:$succ /failure:$fail 2>&1 | Out-Null
}

function Apply-SecEditPasswordSettings {
    param($Policy)
    # secedit lets us touch settings net accounts can't: PasswordComplexity,
    # ClearTextPassword (reversible encryption), and audit base policy.
    $changes = @{}
    if ($null -ne $Policy.password_complexity_enabled) {
        $changes['PasswordComplexity'] = if ($Policy.password_complexity_enabled) { 1 } else { 0 }
    }
    if ($null -ne $Policy.password_reversible_encryption) {
        $changes['ClearTextPassword'] = if ($Policy.password_reversible_encryption) { 1 } else { 0 }
    }
    if ($changes.Count -eq 0) { return 0 }

    $tmp = Join-Path $env:TEMP ("mithras-secedit-" + [guid]::NewGuid().Guid + ".inf")
    $sec = "[Unicode]`r`nUnicode=yes`r`n[System Access]`r`n"
    foreach ($k in $changes.Keys) { $sec += "$k = $($changes[$k])`r`n" }
    $sec += "[Version]`r`nsignature=`"`$CHICAGO`$`"`r`n"
    [System.IO.File]::WriteAllText($tmp, $sec, [System.Text.UTF8Encoding]::new($true))
    try {
        $db = $tmp + ".sdb"
        & secedit /configure /db $db /cfg $tmp /quiet 2>&1 | Out-Null
        Remove-Item $tmp,$db -ErrorAction SilentlyContinue
        return $changes.Count
    } catch {
        Write-PolicyLog "secedit error: $_" 'Warn'
        return 0
    }
}

function Apply-GpoPolicy {
    param([Parameter(Mandatory)]$Policy)
    if (-not $Policy -or -not $Policy.has_policy) { return $false }
    $p = $Policy.policy
    if (-not $p) { return $false }
    Write-PolicyLog "Applying GPO policy: $($p.name)"
    $applied = 0
    $skipped = @()

    try {
        # -- Password policy (net accounts + secedit) --------------------
        if ($null -ne $p.password_min_length)    { & net accounts /minpwlen:$($p.password_min_length)        2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.password_max_age_days)  { & net accounts /maxpwage:$($p.password_max_age_days)       2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.password_min_age_days)  { & net accounts /minpwage:$($p.password_min_age_days)       2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.password_history_count) { & net accounts /uniquepw:$($p.password_history_count)     2>&1 | Out-Null; $applied++ }
        $applied += Apply-SecEditPasswordSettings -Policy $p

        # -- Lockout policy ----------------------------------------------
        if ($null -ne $p.lockout_threshold)        { & net accounts /lockoutthreshold:$($p.lockout_threshold)         2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.lockout_duration_minutes) { & net accounts /lockoutduration:$($p.lockout_duration_minutes)   2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.lockout_reset_minutes)    { & net accounts /lockoutwindow:$($p.lockout_reset_minutes)        2>&1 | Out-Null; $applied++ }

        # -- Audit policies (auditpol per subcategory) --------------------
        foreach ($k in $script:GpoAuditMap.Keys) {
            $mode = $p.$k
            if ($mode -and ($mode -in 'none','success','failure','success_failure')) {
                foreach ($sub in $script:GpoAuditMap[$k]) {
                    Apply-AuditValue -SubcategoryGuid $sub -Mode $mode
                }
                $applied++
            }
        }

        # -- Interactive logon (HKLM Policies\System) --------------------
        $sysPolicy = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
        if ($null -ne $p.interactive_logon_message_title) {
            if (Set-RegValue $sysPolicy 'LegalNoticeCaption' $p.interactive_logon_message_title 'String') { $applied++ }
        }
        if ($null -ne $p.interactive_logon_message_text) {
            if (Set-RegValue $sysPolicy 'LegalNoticeText' $p.interactive_logon_message_text 'String') { $applied++ }
        }
        if ($null -ne $p.interactive_logon_require_ctrl_alt_del) {
            # DisableCAD = 1 means CTRL+ALT+DEL is DISABLED; 0 means required.
            $v = if ($p.interactive_logon_require_ctrl_alt_del) { 0 } else { 1 }
            if (Set-RegValue $sysPolicy 'DisableCAD' $v) { $applied++ }
        }
        if ($null -ne $p.interactive_logon_dont_display_last_user) {
            $v = if ($p.interactive_logon_dont_display_last_user) { 1 } else { 0 }
            if (Set-RegValue $sysPolicy 'DontDisplayLastUserName' $v) { $applied++ }
        }

        # -- Network access / security (HKLM\SYSTEM\CurrentControlSet\Control\Lsa) --
        $lsa = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'
        if ($null -ne $p.network_access_restrict_anonymous) {
            $v = if ($p.network_access_restrict_anonymous) { 1 } else { 0 }
            if (Set-RegValue $lsa 'RestrictAnonymous'    $v) { $applied++ }
            if (Set-RegValue $lsa 'RestrictAnonymousSAM' $v) { $applied++ }
        }
        if ($null -ne $p.network_security_lan_manager_level) {
            if (Set-RegValue $lsa 'LmCompatibilityLevel' ([int]$p.network_security_lan_manager_level)) { $applied++ }
        }
        if ($null -ne $p.network_security_min_session_security_ntlm) {
            # 0x20080000 = require 128-bit and NTLMv2 session security.
            $sec = if ($p.network_security_min_session_security_ntlm) { 0x20080000 } else { 0 }
            if (Set-RegValue ($lsa + '\MSV1_0') 'NtlmMinClientSec' $sec) { $applied++ }
            if (Set-RegValue ($lsa + '\MSV1_0') 'NtlmMinServerSec' $sec) { $applied++ }
        }

        # -- Shutdown clear page file ------------------------------------
        if ($null -ne $p.shutdown_clear_virtual_memory) {
            $v = if ($p.shutdown_clear_virtual_memory) { 1 } else { 0 }
            if (Set-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management' 'ClearPageFileAtShutdown' $v) { $applied++ }
        }

        # -- System object protection mode --------------------------------
        if ($null -ne $p.system_objects_strengthen_default_permissions) {
            $v = if ($p.system_objects_strengthen_default_permissions) { 1 } else { 0 }
            if (Set-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' 'ProtectionMode' $v) { $applied++ }
        }

        # -- User rights assignment -- secedit/lsa-policy. NOT YET IMPLEMENTED.
        #     The arrays the platform sends are usernames/SIDs; full secedit
        #     INF management requires more care to avoid breaking RemoteDesktopUsers,
        #     so we surface "skipped" until we ship the secedit/inf importer.
        foreach ($rk in 'right_network_logon','right_deny_network_logon','right_local_logon','right_deny_local_logon','right_remote_desktop_logon','right_deny_remote_desktop_logon','right_shut_down_system','right_change_system_time','right_debug_programs') {
            $arr = $p.$rk
            if ($arr -and $arr.Count -gt 0) { $skipped += $rk }
        }

        # -- System restrictions (HKCU policy ? applied to Default User template by writing under HKU\.DEFAULT) --
        # Applying under HKCU only affects the current user, which for a system-running
        # agent (SYSTEM) doesn't help end users. Write to HKU\.DEFAULT so all new
        # user profiles inherit, and additionally to HKLM where supported.
        $hkluSys  = 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\Windows\CurrentVersion\Policies\System'
        $hkluExp  = 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'
        $hkluPolW = 'Registry::HKEY_USERS\.DEFAULT\Software\Policies\Microsoft\Windows\System'
        if ($null -ne $p.disable_registry_tools) {
            $v = if ($p.disable_registry_tools) { 1 } else { 0 }
            if (Set-RegValue $hkluSys 'DisableRegistryTools' $v) { $applied++ }
        }
        if ($null -ne $p.disable_task_manager) {
            $v = if ($p.disable_task_manager) { 1 } else { 0 }
            if (Set-RegValue $hkluSys 'DisableTaskMgr' $v) { $applied++ }
        }
        if ($null -ne $p.disable_cmd_prompt) {
            $v = if ($p.disable_cmd_prompt) { 2 } else { 0 }
            if (Set-RegValue $hkluPolW 'DisableCMD' $v) { $applied++ }
        }
        if ($null -ne $p.disable_run_command) {
            $v = if ($p.disable_run_command) { 1 } else { 0 }
            if (Set-RegValue $hkluExp 'NoRun' $v) { $applied++ }
        }
        if ($null -ne $p.disable_control_panel) {
            $v = if ($p.disable_control_panel) { 1 } else { 0 }
            if (Set-RegValue $hkluExp 'NoControlPanel' $v) { $applied++ }
        }
        if ($null -ne $p.disable_lock_screen_camera) {
            $v = if ($p.disable_lock_screen_camera) { 1 } else { 0 }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' 'NoLockScreenCamera' $v) { $applied++ }
        }

        # -- IPv6 --------------------------------------------------------
        if ($null -ne $p.disable_ipv6) {
            # Microsoft documents DisabledComponents as an 8-bit bitmask
            # (0x00..0xFF). Values beyond 0xFF set undefined reserved bits
            # and produce undefined behaviour -- including `ping: General
            # failure` until the value is corrected. Use 0xFF to mean
            # "disable every documented IPv6 component except loopback".
            # https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/configure-ipv6-in-windows
            $v = if ($p.disable_ipv6) { 0xFF } else { 0 }
            if (Set-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters' 'DisabledComponents' $v) { $applied++ }
        }

        # -- WiFi Sense --------------------------------------------------
        if ($null -ne $p.disable_wifi_sense) {
            $v = if ($p.disable_wifi_sense) { 0 } else { 1 }
            if (Set-RegValue 'HKLM:\SOFTWARE\Microsoft\WcmSvc\wifinetworkmanager\config'              'AutoConnectAllowedOEM'   $v) { $applied++ }
            if (Set-RegValue 'HKLM:\SOFTWARE\Microsoft\PolicyManager\default\WiFi\AllowAutoConnectToWiFiSenseHotspots' 'value' $v) { $applied++ }
        }

        # -- Firewall per profile -----------------------------------------
        foreach ($prof in @(@{ Field='enable_windows_firewall_domain';  Profile='DomainProfile' },
                           @{ Field='enable_windows_firewall_private'; Profile='StandardProfile' },
                           @{ Field='enable_windows_firewall_public';  Profile='PublicProfile' })) {
            $val = $p.($prof.Field)
            if ($null -ne $val) {
                $v = if ($val) { 1 } else { 0 }
                $path = "HKLM:\SOFTWARE\Policies\Microsoft\WindowsFirewall\$($prof.Profile)"
                if (Set-RegValue $path 'EnableFirewall' $v) { $applied++ }
            }
        }

        # -- Telemetry ---------------------------------------------------
        if ($null -ne $p.telemetry_level -or $null -ne $p.disable_telemetry) {
            if ($p.disable_telemetry) {
                $lvl = 0
            } elseif ($null -ne $p.telemetry_level) {
                $lvl = [int]$p.telemetry_level
            } else {
                $lvl = 1
            }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' 'AllowTelemetry' $lvl) { $applied++ }
        }

        # -- App restrictions ---------------------------------------------
        if ($null -ne $p.disable_cortana) {
            $v = if ($p.disable_cortana) { 0 } else { 1 }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search' 'AllowCortana' $v) { $applied++ }
        }
        if ($null -ne $p.disable_consumer_features) {
            $v = if ($p.disable_consumer_features) { 1 } else { 0 }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent' 'DisableWindowsConsumerFeatures' $v) { $applied++ }
        }
        if ($null -ne $p.disable_store_apps) {
            $v = if ($p.disable_store_apps) { 1 } else { 0 }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\WindowsStore' 'RemoveWindowsStore' $v) { $applied++ }
        }
        if ($null -ne $p.disable_onedrive) {
            $v = if ($p.disable_onedrive) { 1 } else { 0 }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\OneDrive' 'DisableFileSyncNGSC' $v) { $applied++ }
        }
        if ($null -ne $p.disable_game_bar) {
            $v = if ($p.disable_game_bar) { 0 } else { 1 }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' 'AllowGameDVR' $v) { $applied++ }
        }

        # -- Power (powercfg) ---------------------------------------------
        if ($null -ne $p.screen_timeout_ac_minutes) { & powercfg /change monitor-timeout-ac  ([int]$p.screen_timeout_ac_minutes) 2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.screen_timeout_dc_minutes) { & powercfg /change monitor-timeout-dc  ([int]$p.screen_timeout_dc_minutes) 2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.sleep_timeout_ac_minutes)  { & powercfg /change standby-timeout-ac  ([int]$p.sleep_timeout_ac_minutes)  2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.sleep_timeout_dc_minutes)  { & powercfg /change standby-timeout-dc  ([int]$p.sleep_timeout_dc_minutes)  2>&1 | Out-Null; $applied++ }
        if ($null -ne $p.require_password_on_wake) {
            # CONSOLELOCK (0e796bdb-...) is hidden by default on Server 2022 -- the
            # supported enforcement path is the GPO registry key, which Windows
            # honours during boot regardless of powercfg visibility.
            $v = if ($p.require_password_on_wake) { 1 } else { 0 }
            $regKey = 'HKLM:\SOFTWARE\Policies\Microsoft\Power\PowerSettings\0e796bdb-100d-47d6-a2d5-f7d2daa51f51'
            $ok1 = Set-RegValue $regKey 'ACSettingIndex' $v
            $ok2 = Set-RegValue $regKey 'DCSettingIndex' $v
            if ($ok1 -or $ok2) { $applied++ }
            # Try the powercfg path too -- best effort, ignore errors when hidden.
            try {
                & powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE '0e796bdb-100d-47d6-a2d5-f7d2daa51f51' $v 2>&1 | Out-Null
                & powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_NONE '0e796bdb-100d-47d6-a2d5-f7d2daa51f51' $v 2>&1 | Out-Null
                & powercfg /SETACTIVE SCHEME_CURRENT 2>&1 | Out-Null
            } catch {}
        }

        # -- Remote Desktop -----------------------------------------------
        if ($null -ne $p.remote_desktop_enabled) {
            # fDenyTSConnections = 0 means RDP enabled, 1 means disabled.
            $v = if ($p.remote_desktop_enabled) { 0 } else { 1 }
            if (Set-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' 'fDenyTSConnections' $v) { $applied++ }
        }
        if ($null -ne $p.remote_desktop_nla_required) {
            $v = if ($p.remote_desktop_nla_required) { 1 } else { 0 }
            if (Set-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' 'UserAuthentication' $v) { $applied++ }
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' 'UserAuthentication' $v) { $applied++ }
        }
        if ($null -ne $p.remote_desktop_max_sessions) {
            if (Set-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' 'MaxInstanceCount' ([int]$p.remote_desktop_max_sessions)) { $applied++ }
        }

        # -- Custom registry settings (array of {hive,path,name,type,value}) --
        if ($p.custom_registry_settings -and $p.custom_registry_settings.Count -gt 0) {
            foreach ($cr in $p.custom_registry_settings) {
                $hive = switch ($cr.hive) { 'HKLM' { 'HKLM:' } 'HKCU' { 'HKCU:' } 'HKU.DEFAULT' { 'Registry::HKEY_USERS\.DEFAULT' } default { 'HKLM:' } }
                $type = if ($cr.type) { $cr.type } else { 'DWord' }
                $full = "$hive\$($cr.path)"
                if (Set-RegValue $full $cr.name $cr.value $type) { $applied++ }
            }
        }

        $skippedStr = if ($skipped.Count -gt 0) { $skipped -join ',' } else { 'none' }
        Write-PolicyLog ("GPO policy applied: {0} settings (skipped: {1})" -f $applied, $skippedStr)
        return $true
    } catch {
        Write-PolicyLog "GPO Apply error: $_" 'Error'
        return $false
    }
}

# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
function Invoke-PolicyEnforcementPass {
    param([switch]$Force)
    $token = Get-LegacyAgentToken
    if (-not $token) {
        Write-PolicyLog "No legacy agent_token available; skipping policy pass" 'Warn'
        return @{ ok = $false; reason = 'no_token' }
    }

    $defender = Invoke-PolicyApi -Path 'policy'
    $uac      = Invoke-PolicyApi -Path 'uac-policy'
    $firewall = Invoke-PolicyApi -Path 'firewall-policy'
    $wu       = Invoke-PolicyApi -Path 'windows-update-policy'
    $gpo      = Invoke-PolicyApi -Path 'gpo-policy'
    $ring     = Invoke-PolicyApi -Path 'update-ring'

    $result = @{
        defender = $false; uac = $false; firewall = $false; wu = $false; gpo = $false; ring = $false
        firewall_rules = $null
    }
    if ($defender -and $defender.policy) { $result.defender = Apply-DefenderPolicy -Policy $defender.policy -Force:$Force }
    if ($uac)                            { $result.uac      = Apply-UacPolicy        -Policy $uac }
    if ($firewall)                       {
        $result.firewall = Apply-FirewallPolicy -Policy $firewall
        if ($firewall.rules) { $result.firewall_rules = $firewall.rules }
    }
    if ($wu)                             { $result.wu       = Apply-WindowsUpdatePolicy -Policy $wu }
    # Ring is applied AFTER the WU policy so the ring's defer-days +
    # active-hours win for endpoints managed via the group flow.
    if ($ring)                           { $result.ring     = Apply-UpdateRing -RingPayload $ring }
    if ($gpo)                            { $result.gpo      = Apply-GpoPolicy         -Policy $gpo }
    return $result
}

function Get-EndpointPostureSummary {
    $uac = Get-UacStatus
    $wu  = Get-WindowsUpdateStatus
    $combined = @{}
    foreach ($p in $uac.PSObject.Properties) { $combined[$p.Name] = $p.Value }
    foreach ($p in $wu.PSObject.Properties)  { $combined[$p.Name] = $p.Value }
    return $combined
}

Export-ModuleMember -Function `
    Invoke-PolicyEnforcementPass, `
    Get-EndpointPostureSummary, `
    Get-LegacyAgentToken, Set-CachedLegacyAgentToken, Clear-CachedLegacyAgentToken, `
    Apply-DefenderPolicy, Apply-UacPolicy, Apply-WindowsUpdatePolicy, Apply-UpdateRing, Apply-FirewallPolicy, Apply-GpoPolicy, `
    Get-UacStatus, Get-WindowsUpdateStatus
