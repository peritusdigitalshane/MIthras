function Apply-Policy {
    param($Policy, [switch]$Force)
    if (-not $Policy) { Write-Log "No policy to apply"; return $false }
    $policyVersion = $Policy.updated_at
    $oldVersion = ""
    if (Test-Path $PolicyHashFile) { $oldVersion = Get-Content $PolicyHashFile -ErrorAction SilentlyContinue }
    if (-not $Force -and $policyVersion -eq $oldVersion) { Write-Log "Policy unchanged"; return $false }
    Write-Log "Applying Policy: $($Policy.name)"
    try {
        $mpParams = @{}
        if ($null -ne $Policy.realtime_monitoring) { $mpParams["DisableRealtimeMonitoring"] = -not $Policy.realtime_monitoring }
        if ($null -ne $Policy.behavior_monitoring) { $mpParams["DisableBehaviorMonitoring"] = -not $Policy.behavior_monitoring }
        if ($null -ne $Policy.ioav_protection) { $mpParams["DisableIOAVProtection"] = -not $Policy.ioav_protection }
        if ($null -ne $Policy.script_scanning) { $mpParams["DisableScriptScanning"] = -not $Policy.script_scanning }
        if ($null -ne $Policy.removable_drive_scanning) { $mpParams["DisableRemovableDriveScanning"] = -not $Policy.removable_drive_scanning }
        if ($null -ne $Policy.archive_scanning) { $mpParams["DisableArchiveScanning"] = -not $Policy.archive_scanning }
        if ($null -ne $Policy.email_scanning) { $mpParams["DisableEmailScanning"] = -not $Policy.email_scanning }
        if ($null -ne $Policy.check_signatures_before_scan) { $mpParams["CheckForSignaturesBeforeRunningScan"] = $Policy.check_signatures_before_scan }
        if ($null -ne $Policy.cloud_delivered_protection) { $mpParams["MAPSReporting"] = if ($Policy.cloud_delivered_protection) { 2 } else { 0 } }
        if ($null -ne $Policy.block_at_first_seen) { $mpParams["DisableBlockAtFirstSeen"] = -not $Policy.block_at_first_seen }
        if ($Policy.cloud_block_level) { $mpParams["CloudBlockLevel"] = switch ($Policy.cloud_block_level) { "Default" { 0 } "Moderate" { 1 } "High" { 2 } "HighPlus" { 4 } "ZeroTolerance" { 6 } default { 2 } } }
        if ($null -ne $Policy.cloud_extended_timeout) { $mpParams["CloudExtendedTimeout"] = $Policy.cloud_extended_timeout }
        if ($Policy.sample_submission) { $mpParams["SubmitSamplesConsent"] = switch ($Policy.sample_submission) { "None" { 0 } "SendSafeSamples" { 1 } "SendAllSamples" { 3 } "AlwaysPrompt" { 2 } default { 3 } } }
        if ($null -ne $Policy.pua_protection) { $mpParams["PUAProtection"] = if ($Policy.pua_protection) { 1 } else { 0 } }
        if ($null -ne $Policy.signature_update_interval) { $mpParams["SignatureUpdateInterval"] = $Policy.signature_update_interval }
        if ($mpParams.Count -gt 0) { Set-MpPreference @mpParams; Write-Log "Core Defender settings applied" }
        if ($null -ne $Policy.network_protection) { Set-MpPreference -EnableNetworkProtection (if ($Policy.network_protection) { 1 } else { 0 }) }
        if ($null -ne $Policy.controlled_folder_access) { Set-MpPreference -EnableControlledFolderAccess (if ($Policy.controlled_folder_access) { 1 } else { 0 }) }
        $asrIds = @(); $asrActions = @()
        $asrMappings = @{ "asr_block_vulnerable_drivers" = "block_vulnerable_drivers"; "asr_block_email_executable" = "block_email_executable"; "asr_block_office_child_process" = "block_office_child_process"; "asr_block_office_executable_content" = "block_office_executable_content"; "asr_block_wmi_persistence" = "block_wmi_persistence"; "asr_block_adobe_child_process" = "block_adobe_child_process"; "asr_block_office_comms_child_process" = "block_office_comms_child_process"; "asr_block_usb_untrusted" = "block_usb_untrusted"; "asr_block_psexec_wmi" = "block_psexec_wmi"; "asr_block_credential_stealing" = "block_credential_stealing"; "asr_advanced_ransomware_protection" = "advanced_ransomware_protection"; "asr_block_untrusted_executables" = "block_untrusted_executables"; "asr_block_office_macro_win32" = "block_office_macro_win32"; "asr_block_obfuscated_scripts" = "block_obfuscated_scripts"; "asr_block_js_vbs_executable" = "block_js_vbs_executable"; "asr_block_office_code_injection" = "block_office_code_injection" }
        foreach ($policyKey in $asrMappings.Keys) {
            $ruleKey = $asrMappings[$policyKey]; $policyValue = $Policy.$policyKey
            if ($policyValue -and $AsrRuleGuids.ContainsKey($ruleKey)) { $asrIds += $AsrRuleGuids[$ruleKey]; $asrActions += Convert-AsrAction -Action $policyValue }
        }
        if ($asrIds.Count -gt 0) { Set-MpPreference -AttackSurfaceReductionRules_Ids $asrIds -AttackSurfaceReductionRules_Actions $asrActions; Write-Log "ASR rules configured: $($asrIds.Count) rules" }
        $policyVersion | Set-Content -Path $PolicyHashFile -Force
        Write-Log "Policy applied successfully!"
        return $true
    } catch { Write-Log "Error applying policy: $_" -Level "ERROR"; return $false }
}
