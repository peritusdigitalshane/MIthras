# WdacControl.psm1 — WDAC application-control agent module (Phase 1).
# Functions are added by subsequent tasks.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertFrom-CodeIntegrityEvent {
    [CmdletBinding()]
    param([Parameter(Mandatory)][xml]$EventXml)

    $sys  = $EventXml.Event.System
    $data = @{}
    foreach ($d in $EventXml.Event.EventData.Data) {
        $data[$d.Name] = $d.'#text'
    }

    $filePath = $data['File Name']
    $fileName = if ($filePath) { [System.IO.Path]::GetFileName($filePath.TrimEnd('\','/')) } else { $null }

    [hashtable]@{
        event_id       = [int]$sys.EventID
        event_time     = ([datetime]$sys.TimeCreated.SystemTime).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        record_id      = [long]$sys.EventRecordID
        file_path      = $filePath
        file_name      = $fileName
        file_hash      = $data['SHA256 Hash']
        process_name   = $data['Process Name']
        parent_process = $data['Process Name']  # CodeIntegrity emits Process Name = the launcher
        user_name      = $data['User Name']
        is_block       = ([int]$sys.EventID -eq 3077)
    }
}

function ConvertTo-CIPolicyXml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rules,
        [Parameter(Mandatory)][ValidateSet('audit','enforce','off')][string]$Mode,
        [Parameter(Mandatory)][string]$PolicyGuid
    )

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('<?xml version="1.0" encoding="utf-8"?>')
    [void]$sb.AppendLine('<SiPolicy xmlns="urn:schemas-microsoft-com:sipolicy">')
    [void]$sb.AppendLine('  <VersionEx>10.0.0.0</VersionEx>')
    [void]$sb.AppendLine("  <PolicyTypeID>$PolicyGuid</PolicyTypeID>")
    [void]$sb.AppendLine('  <PlatformID>{2E07F7E4-194C-4D20-B7C9-6F44A6C5A234}</PlatformID>')

    [void]$sb.AppendLine('  <Rules>')
    [void]$sb.AppendLine('    <Rule><Option>Enabled:Unsigned System Integrity Policy</Option></Rule>')
    if ($Mode -eq 'audit') {
        [void]$sb.AppendLine('    <Rule><Option>Enabled:Audit Mode</Option></Rule>')
    }
    [void]$sb.AppendLine('  </Rules>')

    # File rules — emit Allow/Deny elements. WDAC's SiPolicy schema constrains the
    # ID attribute on AllowType/DenyType to the pattern ID_(ALLOW|DENY)_<letter>_<num>
    # (e.g. ID_ALLOW_A_0). Plain ID_ALLOW_0 is rejected by ConvertFrom-CIPolicy.
    [void]$sb.AppendLine('  <FileRules>')

    # Buffers for publisher rules — emitted as <Signer> blocks below, with a
    # cross-reference from <SigningScenarios>. Previous versions wrote
    # PackageFamilyName which is only valid for AppX/MSIX and silently fails on
    # Win32 PE files; the fix is to either emit a proper Signer (when we have
    # a TBS cert hash) or fall back to a FileName rule that matches against the
    # signed binary's InternalName/CompanyName metadata.
    $signers   = New-Object System.Collections.ArrayList
    $allowSig  = New-Object System.Collections.ArrayList
    $denySig   = New-Object System.Collections.ArrayList

    for ($i = 0; $i -lt $Rules.Count; $i++) {
        $r = $Rules[$i]
        $verb   = if ($r.action -eq 'allow') { 'ALLOW' } else { 'DENY' }
        $action = if ($r.action -eq 'allow') { 'Allow' } else { 'Deny' }
        $id     = "ID_${verb}_A_$i"
        switch ($r.rule_type) {
            'hash'      { [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"hash_$i`" Hash=`"$($r.value)`" />") }
            'path'      { [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"path_$i`" FilePath=`"$($r.value)`" />") }
            'file_name' { [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"name_$i`" FileName=`"$($r.value)`" />") }
            'publisher' {
                # Proper publisher rule needs a TBS hash of the issuing CA cert
                # (the canonical WDAC approach). When the rule carries cert_root_tbs
                # AND publisher_name, emit a real <Signer> block. Otherwise fall
                # back to a FileName rule matching the binary's metadata (still
                # better than silently failing in enforce mode).
                if ($r.PSObject.Properties['cert_root_tbs'] -and $r.cert_root_tbs) {
                    $signerId = "ID_SIGNER_PUB_$i"
                    $pubName  = [string]$r.publisher_name
                    $tbs      = [string]$r.cert_root_tbs
                    $signerXml = "    <Signer ID=`"$signerId`" Name=`"$pubName`">`r`n" +
                                 "      <CertRoot Type=`"TBS`" Value=`"$tbs`" />`r`n" +
                                 "      <CertPublisher Value=`"$pubName`" />`r`n" +
                                 "    </Signer>"
                    [void]$signers.Add($signerXml) | Out-Null
                    if ($r.action -eq 'allow') {
                        [void]$allowSig.Add("        <AllowedSigner SignerId=`"$signerId`" />") | Out-Null
                    } else {
                        [void]$denySig.Add("        <DeniedSigner SignerId=`"$signerId`" />") | Out-Null
                    }
                } else {
                    # Pragmatic fallback: publisher rule without cert metadata becomes
                    # a FileName rule matched against the signed binary's InternalName.
                    # Matches the publisher's product name for most Win32 apps.
                    $name = [string]($r.publisher_name)
                    if ($name) {
                        [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"publisher_filename_$i`" FileName=`"$name`" />")
                    }
                }
            }
            default { }
        }
    }
    [void]$sb.AppendLine('  </FileRules>')

    # Signers block — proper publisher rules.
    if ($signers.Count -gt 0) {
        [void]$sb.AppendLine('  <Signers>')
        foreach ($s in $signers) { [void]$sb.AppendLine($s) }
        [void]$sb.AppendLine('  </Signers>')
    } else {
        [void]$sb.AppendLine('  <Signers />')
    }

    # SigningScenarios — cross-reference the AllowedSigners / DeniedSigners.
    if ($allowSig.Count -gt 0 -or $denySig.Count -gt 0) {
        [void]$sb.AppendLine('  <SigningScenarios>')
        [void]$sb.AppendLine('    <SigningScenario Value="131" ID="ID_SIGNINGSCENARIO_WINDOWS" FriendlyName="Mithras user-mode policy">')
        [void]$sb.AppendLine('      <ProductSigners>')
        if ($allowSig.Count -gt 0) {
            [void]$sb.AppendLine('        <AllowedSigners>')
            foreach ($a in $allowSig) { [void]$sb.AppendLine($a) }
            [void]$sb.AppendLine('        </AllowedSigners>')
        }
        if ($denySig.Count -gt 0) {
            [void]$sb.AppendLine('        <DeniedSigners>')
            foreach ($d in $denySig) { [void]$sb.AppendLine($d) }
            [void]$sb.AppendLine('        </DeniedSigners>')
        }
        [void]$sb.AppendLine('      </ProductSigners>')
        [void]$sb.AppendLine('    </SigningScenario>')
        [void]$sb.AppendLine('  </SigningScenarios>')
    } else {
        [void]$sb.AppendLine('  <SigningScenarios />')
    }
    [void]$sb.AppendLine('  <UpdatePolicySigners />')
    [void]$sb.AppendLine('  <CiSigners />')
    [void]$sb.AppendLine('  <HvciOptions>0</HvciOptions>')
    [void]$sb.AppendLine('</SiPolicy>')

    $sb.ToString()
}

function Get-WdacAgentState {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $default = @{
        peritus_policy_guid  = $null
        last_applied_version = $null
        last_applied_at      = $null
        last_event_record_id = 0
    }

    if (-not (Test-Path $Path)) { return $default }
    try {
        $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
        $obj = $raw | ConvertFrom-Json -ErrorAction Stop
        $h = @{}
        foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = $p.Value }
        foreach ($k in $default.Keys) { if (-not $h.ContainsKey($k)) { $h[$k] = $default[$k] } }
        return $h
    } catch {
        return $default
    }
}

function Set-WdacAgentState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][hashtable]$State
    )

    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $tmp = "$Path.tmp"
    ($State | ConvertTo-Json -Depth 5) | Set-Content -Path $tmp -Encoding UTF8
    Move-Item -Path $tmp -Destination $Path -Force
}

function Aggregate-WdacObservations {
    [CmdletBinding()]
    param([Parameter(Mandatory)][object[]]$Records)

    $groups = $Records | Group-Object -Property { "$($_.file_path)|$($_.file_hash)" }
    $out = foreach ($g in $groups) {
        $first = $g.Group | Sort-Object event_time | Select-Object -First 1
        [pscustomobject]@{
            file_path    = $first.file_path
            file_name    = $first.file_name
            file_hash    = $first.file_hash
            first_seen   = $first.event_time
            exec_count   = $g.Count
        }
    }
    return @($out)
}

function Get-MaxRecordId {
    [CmdletBinding()]
    param([Parameter(Mandatory)][object[]]$Records)

    if (-not $Records -or $Records.Count -eq 0) { return 0 }
    return ($Records | Measure-Object -Property record_id -Maximum).Maximum
}

function Get-NewWdacObservations {
    [CmdletBinding()]
    param([Parameter(Mandatory)][long]$SinceRecordId)

    # Live event-log read — not exercised in unit tests. Filter by record_id > $SinceRecordId.
    $filter = @{
        LogName    = 'Microsoft-Windows-CodeIntegrity/Operational'
        ProviderName = 'Microsoft-Windows-CodeIntegrity'
        Id         = 3076, 3077
    }
    $events = try { Get-WinEvent -FilterHashtable $filter -ErrorAction Stop } catch { @() }
    $events = $events | Where-Object { [long]$_.RecordId -gt $SinceRecordId }

    $parsed = foreach ($e in $events) {
        try { ConvertFrom-CodeIntegrityEvent -EventXml ([xml]$e.ToXml()) } catch { $null }
    }
    return @($parsed | Where-Object { $_ })
}

function Apply-WdacPolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StatePath,
        [Parameter(Mandatory)][string]$PolicyVersion,
        [Parameter(Mandatory)][ValidateSet('audit','enforce','off')][string]$Mode,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rules,
        # Test seam — production caller leaves it default.
        [scriptblock]$ApplyImpl = $null
    )

    $state = Get-WdacAgentState -Path $StatePath
    if ($state.last_applied_version -eq $PolicyVersion) {
        return @{ applied = $false; skipped = $true; pending_reboot = $false; error = $null }
    }

    if (-not $state.peritus_policy_guid) {
        $state.peritus_policy_guid = "{$([guid]::NewGuid())}"
    }

    $xml      = ConvertTo-CIPolicyXml -Rules $Rules -Mode $Mode -PolicyGuid $state.peritus_policy_guid
    $tmpXml   = Join-Path ([IO.Path]::GetTempPath()) ("peritus-wdac-" + [guid]::NewGuid() + ".xml")
    $tmpCip   = [IO.Path]::ChangeExtension($tmpXml, '.cip')
    Set-Content -Path $tmpXml -Value $xml -Encoding UTF8

    $ok = $false
    $pendingReboot = $false
    try {
        if ($ApplyImpl) {
            $ok = & $ApplyImpl $tmpCip
        } else {
            # Production path: convert XML -> .cip with the built-in WDAC cmdlet,
            # drop into the WDAC active-policies directory, refresh if CiTool is
            # available (Win 11 / Server 2022 22H2+); otherwise the kernel picks
            # up the .cip at next boot.
            try {
                ConvertFrom-CIPolicy -XmlFilePath $tmpXml -BinaryFilePath $tmpCip | Out-Null
                $dest = "C:\Windows\System32\CodeIntegrity\CiPolicies\Active\$($state.peritus_policy_guid).cip"
                Copy-Item -Path $tmpCip -Destination $dest -Force

                $citool = "C:\Windows\System32\CiTool.exe"
                if (Test-Path $citool) {
                    $refresh = & $citool --refresh-policy 2>&1
                    $ok = ($LASTEXITCODE -eq 0)
                } else {
                    # No CiTool — policy is dropped and will activate at next boot.
                    # Treat as success so the version isn't re-attempted every heartbeat.
                    $ok = $true
                    $pendingReboot = $true
                }
            } catch {
                $ok = $false
            }
        }
    } finally {
        Remove-Item -Path $tmpXml -ErrorAction SilentlyContinue
        Remove-Item -Path $tmpCip -ErrorAction SilentlyContinue
    }

    if ($ok) {
        $state.last_applied_version = $PolicyVersion
        $state.last_applied_at      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        Set-WdacAgentState -Path $StatePath -State $state
        return @{ applied = $true; skipped = $false; pending_reboot = $pendingReboot; error = $null }
    } else {
        return @{ applied = $false; skipped = $false; pending_reboot = $false; error = "apply failed (mode=$Mode, version=$PolicyVersion)" }
    }
}

function Invoke-WdacControlSync {
    [CmdletBinding()]
    param(
        [object]$State,                # the app_control block from heartbeat (or $null)
        [Parameter(Mandatory)][string]$StatePath,
        [scriptblock]$OnApply = $null,                           # invoked with .cip path; returns $true on success
        [Parameter(Mandatory)][scriptblock]$OnObservedBatch,     # invoked with [pscustomobject[]] of aggregated apps; returns $true on success
        [scriptblock]$OnBlockedBatch = $null,                    # NEW v0.4.5: invoked with [hashtable[]] of enforce-mode 3077 events
        [scriptblock]$ObservationProvider = $null                # production default = Get-NewWdacObservations
    )

    $result = @{ applied = $false; observed = 0; blocked = 0; pending_reboot = $false; error = $null }

    if ($null -eq $State -or $State.mode -eq 'off') {
        return $result
    }

    # Apply on version change.
    $apply = Apply-WdacPolicy `
        -StatePath $StatePath `
        -PolicyVersion $State.policy_version `
        -Mode $State.mode `
        -Rules @($State.rules) `
        -ApplyImpl $OnApply
    $result.applied         = $apply.applied
    $result.pending_reboot  = [bool]$apply.pending_reboot
    if ($apply.error) { $result.error = $apply.error }

    # Observe — always, in either audit or enforce mode.
    $agentState = Get-WdacAgentState -Path $StatePath
    $since = [long]$agentState.last_event_record_id
    $records = if ($ObservationProvider) { & $ObservationProvider $since } else { Get-NewWdacObservations -SinceRecordId $since }
    $records = @($records)
    if ($records.Count -gt 0) {
        # Partition into observed (audit / 3076) and blocked (enforce / 3077).
        $observedRecords = @()
        $blockedRecords  = @()
        foreach ($r in $records) {
            if ($r.is_block) { $blockedRecords += $r } else { $observedRecords += $r }
        }

        $maxId = Get-MaxRecordId -Records $records
        $observedOk = $true
        $blockedOk  = $true

        if ($observedRecords.Count -gt 0) {
            $batch = Aggregate-WdacObservations -Records $observedRecords
            if (& $OnObservedBatch $batch) {
                $result.observed = @($batch).Count
            } else { $observedOk = $false }
        }

        if ($blockedRecords.Count -gt 0 -and $OnBlockedBatch) {
            # For blocks we ship each event individually rather than aggregating —
            # the SOC's enforce-monitoring view wants every block instance with
            # its event_time, process_name, etc.
            $payload = @()
            foreach ($b in $blockedRecords) {
                $payload += @{
                    file_path      = $b.file_path
                    file_name      = $b.file_name
                    file_hash      = $b.file_hash
                    process_name   = $b.process_name
                    parent_process = $b.parent_process
                    event_id       = $b.event_id
                    event_time     = $b.event_time
                    publisher      = $null
                }
            }
            if (& $OnBlockedBatch $payload) {
                $result.blocked = $payload.Count
            } else { $blockedOk = $false }
        }

        if ($observedOk -and $blockedOk) {
            $agentState.last_event_record_id = $maxId
            Set-WdacAgentState -Path $StatePath -State $agentState
        }
    }

    return $result
}

Export-ModuleMember -Function ConvertFrom-CodeIntegrityEvent, ConvertTo-CIPolicyXml, Get-WdacAgentState, Set-WdacAgentState, Aggregate-WdacObservations, Get-MaxRecordId, Get-NewWdacObservations, Apply-WdacPolicy, Invoke-WdacControlSync
