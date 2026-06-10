function Apply-GpoPolicy {
    param([object]$Policy, [switch]$Force)
    if (-not $Policy) { return $false }
    $policyHashFile = "$ConfigPath\gpo_policy_hash.txt"
    $policyJson = $Policy | ConvertTo-Json -Depth 5 -Compress
    $policyHash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($policyJson))).Replace("-", "").Substring(0, 16)
    if (-not $Force -and (Test-Path $policyHashFile)) {
        $lastHash = Get-Content $policyHashFile -ErrorAction SilentlyContinue
        if ($lastHash -eq $policyHash) { Write-Log "GPO policy unchanged"; return $false }
    }
    Write-Log "Applying GPO policy: $($Policy.name)"
    $changesApplied = $false
    try {
        # === Password & Account Lockout Policy (via net accounts) ===
        try {
            if ($null -ne $Policy.password_min_length) { net accounts /minpwlen:$($Policy.password_min_length) 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.password_max_age_days) { net accounts /maxpwage:$($Policy.password_max_age_days) 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.password_min_age_days) { net accounts /minpwage:$($Policy.password_min_age_days) 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.password_history_count) { net accounts /uniquepw:$($Policy.password_history_count) 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.lockout_threshold) { net accounts /lockoutthreshold:$($Policy.lockout_threshold) 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.lockout_duration_minutes -and $Policy.lockout_threshold -gt 0) { net accounts /lockoutduration:$($Policy.lockout_duration_minutes) 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.lockout_reset_minutes -and $Policy.lockout_threshold -gt 0) { net accounts /lockoutwindow:$($Policy.lockout_reset_minutes) 2>&1 | Out-Null; $changesApplied = $true }
            Write-Log "Password and lockout policies applied via net accounts"
        } catch { Write-Log "Error applying password/lockout policy: $_" -Level "WARN" }

        # === Password Complexity (via secedit) ===
        try {
            $secEditFile = "$ConfigPath\gpo_secedit.inf"
            $secEditDb = "$ConfigPath\gpo_secedit.sdb"
            $secContent = "[Unicode]" + [char]13 + [char]10 + "Unicode=yes" + [char]13 + [char]10 + "[System Access]" + [char]13 + [char]10 + "PasswordComplexity = " + $(if ($Policy.password_complexity_enabled) { "1" } else { "0" }) + [char]13 + [char]10 + "ClearTextPassword = " + $(if ($Policy.password_reversible_encryption) { "1" } else { "0" }) + [char]13 + [char]10 + "[Version]" + [char]13 + [char]10 + 'signature="$CHICAGO$"' + [char]13 + [char]10 + "Revision=1"
            $secContent | Set-Content -Path $secEditFile -Force -Encoding Unicode
            secedit /configure /db $secEditDb /cfg $secEditFile /areas SECURITYPOLICY 2>&1 | Out-Null
            Remove-Item $secEditFile -Force -ErrorAction SilentlyContinue
            Remove-Item $secEditDb -Force -ErrorAction SilentlyContinue
            Write-Log "Password complexity settings applied via secedit"
            $changesApplied = $true
        } catch { Write-Log "Error applying password complexity: $_" -Level "WARN" }

        # === Audit Policy (via auditpol) ===
        try {
            $auditMap = @{
                "audit_logon_events" = "Logon/Logoff"
                "audit_object_access" = "Object Access"
                "audit_privilege_use" = "Privilege Use"
                "audit_policy_change" = "Policy Change"
                "audit_account_management" = "Account Management"
                "audit_process_tracking" = "Detailed Tracking"
                "audit_system_events" = "System"
                "audit_account_logon" = "Account Logon"
                "audit_ds_access" = "DS Access"
            }
            foreach ($key in $auditMap.Keys) {
                $value = $Policy.$key
                if ($null -eq $value) { continue }
                $category = $auditMap[$key]
                switch ($value) {
                    "none" { auditpol /set /category:"$category" /success:disable /failure:disable 2>&1 | Out-Null }
                    "success" { auditpol /set /category:"$category" /success:enable /failure:disable 2>&1 | Out-Null }
                    "failure" { auditpol /set /category:"$category" /success:disable /failure:enable 2>&1 | Out-Null }
                    "success_failure" { auditpol /set /category:"$category" /success:enable /failure:enable 2>&1 | Out-Null }
                }
            }
            Write-Log "Audit policies applied via auditpol"
            $changesApplied = $true
        } catch { Write-Log "Error applying audit policy: $_" -Level "WARN" }

        # === Security Options (registry) ===
        try {
            $secOptPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
            if (-not (Test-Path $secOptPath)) { New-Item -Path $secOptPath -Force | Out-Null }
            if ($null -ne $Policy.interactive_logon_require_ctrl_alt_del) { Set-ItemProperty -Path $secOptPath -Name "DisableCAD" -Value $(if ($Policy.interactive_logon_require_ctrl_alt_del) { 0 } else { 1 }) -Type DWord -Force; $changesApplied = $true }
            if ($null -ne $Policy.interactive_logon_dont_display_last_user) { Set-ItemProperty -Path $secOptPath -Name "DontDisplayLastUserName" -Value $(if ($Policy.interactive_logon_dont_display_last_user) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true }
            if ($Policy.interactive_logon_message_title) { Set-ItemProperty -Path $secOptPath -Name "LegalNoticeCaption" -Value $Policy.interactive_logon_message_title -Type String -Force; $changesApplied = $true }
            if ($Policy.interactive_logon_message_text) { Set-ItemProperty -Path $secOptPath -Name "LegalNoticeText" -Value $Policy.interactive_logon_message_text -Type String -Force; $changesApplied = $true }
            $lsaPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa"
            if ($null -ne $Policy.network_access_restrict_anonymous) { Set-ItemProperty -Path $lsaPath -Name "RestrictAnonymous" -Value $(if ($Policy.network_access_restrict_anonymous) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true }
            if ($null -ne $Policy.network_security_lan_manager_level) { Set-ItemProperty -Path $lsaPath -Name "LmCompatibilityLevel" -Value $Policy.network_security_lan_manager_level -Type DWord -Force; $changesApplied = $true }
            if ($null -ne $Policy.shutdown_clear_virtual_memory) {
                $memPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management"
                Set-ItemProperty -Path $memPath -Name "ClearPageFileAtShutdown" -Value $(if ($Policy.shutdown_clear_virtual_memory) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true
            }
            Write-Log "Security options applied"
        } catch { Write-Log "Error applying security options: $_" -Level "WARN" }

        # === Administrative Templates - System (registry) ===
        try {
            $explorerPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer"
            $systemPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
            if (-not (Test-Path $explorerPath)) { New-Item -Path $explorerPath -Force | Out-Null }
            if ($null -ne $Policy.disable_registry_tools) { Set-ItemProperty -Path $systemPath -Name "DisableRegistryTools" -Value $(if ($Policy.disable_registry_tools) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true }
            if ($null -ne $Policy.disable_task_manager) { Set-ItemProperty -Path $systemPath -Name "DisableTaskMgr" -Value $(if ($Policy.disable_task_manager) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true }
            if ($null -ne $Policy.disable_cmd_prompt) { Set-ItemProperty -Path $systemPath -Name "DisableCMD" -Value $(if ($Policy.disable_cmd_prompt) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true }
            if ($null -ne $Policy.disable_run_command) { Set-ItemProperty -Path $explorerPath -Name "NoRun" -Value $(if ($Policy.disable_run_command) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true }
            if ($null -ne $Policy.disable_control_panel) { Set-ItemProperty -Path $explorerPath -Name "NoControlPanel" -Value $(if ($Policy.disable_control_panel) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true }
            Write-Log "Admin template (system) settings applied"
        } catch { Write-Log "Error applying admin template system settings: $_" -Level "WARN" }

        # === Administrative Templates - Network (registry) ===
        try {
            if ($null -ne $Policy.disable_ipv6) {
                $ipv6Path = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters"
                Set-ItemProperty -Path $ipv6Path -Name "DisabledComponents" -Value $(if ($Policy.disable_ipv6) { 255 } else { 0 }) -Type DWord -Force; $changesApplied = $true
            }
            Write-Log "Admin template (network) settings applied"
        } catch { Write-Log "Error applying admin template network settings: $_" -Level "WARN" }

        # === Administrative Templates - Windows Components (registry) ===
        try {
            $telemetryPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection"
            if (-not (Test-Path $telemetryPath)) { New-Item -Path $telemetryPath -Force | Out-Null }
            if ($null -ne $Policy.disable_telemetry -or $null -ne $Policy.telemetry_level) {
                $level = if ($Policy.disable_telemetry) { 0 } else { $Policy.telemetry_level }
                Set-ItemProperty -Path $telemetryPath -Name "AllowTelemetry" -Value $level -Type DWord -Force; $changesApplied = $true
            }
            if ($null -ne $Policy.disable_consumer_features) {
                $cloudPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent"
                if (-not (Test-Path $cloudPath)) { New-Item -Path $cloudPath -Force | Out-Null }
                Set-ItemProperty -Path $cloudPath -Name "DisableWindowsConsumerFeatures" -Value $(if ($Policy.disable_consumer_features) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true
            }
            if ($null -ne $Policy.disable_game_bar) {
                $gamePath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR"
                if (-not (Test-Path $gamePath)) { New-Item -Path $gamePath -Force | Out-Null }
                Set-ItemProperty -Path $gamePath -Name "AllowGameDVR" -Value $(if ($Policy.disable_game_bar) { 0 } else { 1 }) -Type DWord -Force; $changesApplied = $true
            }
            Write-Log "Admin template (components) settings applied"
        } catch { Write-Log "Error applying admin template component settings: $_" -Level "WARN" }

        # === Remote Desktop (registry) ===
        try {
            $rdpPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server"
            if ($null -ne $Policy.remote_desktop_enabled) {
                Set-ItemProperty -Path $rdpPath -Name "fDenyTSConnections" -Value $(if ($Policy.remote_desktop_enabled) { 0 } else { 1 }) -Type DWord -Force; $changesApplied = $true
            }
            if ($null -ne $Policy.remote_desktop_nla_required) {
                $rdpWinStaPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp"
                Set-ItemProperty -Path $rdpWinStaPath -Name "UserAuthentication" -Value $(if ($Policy.remote_desktop_nla_required) { 1 } else { 0 }) -Type DWord -Force; $changesApplied = $true
            }
            Write-Log "Remote Desktop settings applied"
        } catch { Write-Log "Error applying RDP settings: $_" -Level "WARN" }

        # === Power Settings (via powercfg) ===
        try {
            if ($null -ne $Policy.screen_timeout_ac_minutes) { powercfg /change monitor-timeout-ac $Policy.screen_timeout_ac_minutes 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.screen_timeout_dc_minutes) { powercfg /change monitor-timeout-dc $Policy.screen_timeout_dc_minutes 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.sleep_timeout_ac_minutes) { powercfg /change standby-timeout-ac $Policy.sleep_timeout_ac_minutes 2>&1 | Out-Null; $changesApplied = $true }
            if ($null -ne $Policy.sleep_timeout_dc_minutes) { powercfg /change standby-timeout-dc $Policy.sleep_timeout_dc_minutes 2>&1 | Out-Null; $changesApplied = $true }
            Write-Log "Power settings applied via powercfg"
        } catch { Write-Log "Error applying power settings: $_" -Level "WARN" }

        # === Custom Registry Settings ===
        try {
            $customSettings = $Policy.custom_registry_settings
            if ($customSettings -and $customSettings.Count -gt 0) {
                foreach ($reg in $customSettings) {
                    $hivePath = switch ($reg.hive) { "HKLM" { "HKLM:\" } "HKCU" { "HKCU:\" } "HKCR" { "HKCR:\" } "HKU" { "HKU:\" } default { "HKLM:\" } }
                    $fullPath = "$hivePath$($reg.path)"
                    if (-not (Test-Path $fullPath)) { New-Item -Path $fullPath -Force | Out-Null }
                    $regType = switch ($reg.type) { "REG_SZ" { "String" } "REG_DWORD" { "DWord" } "REG_QWORD" { "QWord" } "REG_MULTI_SZ" { "MultiString" } "REG_EXPAND_SZ" { "ExpandString" } default { "String" } }
                    $regValue = $reg.value
                    if ($regType -eq "DWord" -or $regType -eq "QWord") { try { $regValue = [long]$regValue } catch { } }
                    Set-ItemProperty -Path $fullPath -Name $reg.name -Value $regValue -Type $regType -Force
                }
                Write-Log "Custom registry settings applied: $($customSettings.Count) entries"
                $changesApplied = $true
            }
        } catch { Write-Log "Error applying custom registry settings: $_" -Level "WARN" }

        if ($changesApplied) { $policyHash | Set-Content -Path $policyHashFile -Force; Write-Log "GPO policy applied successfully" }
        return $changesApplied
    } catch { Write-Log "Error applying GPO policy: $_" -Level "ERROR"; return $false }
}
