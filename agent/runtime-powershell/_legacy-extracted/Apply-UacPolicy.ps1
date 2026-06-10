function Apply-UacPolicy {
    param([object]$Policy, [switch]$Force)
    if (-not $Policy) { return $false }
    $uacPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
    $policyHashFile = "$ConfigPath\uac_policy_hash.txt"
    $policyJson = $Policy | ConvertTo-Json -Depth 5 -Compress
    $policyHash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($policyJson))).Replace("-", "").Substring(0, 16)
    if (-not $Force -and (Test-Path $policyHashFile)) {
        $lastHash = Get-Content $policyHashFile -ErrorAction SilentlyContinue
        if ($lastHash -eq $policyHash) { Write-Log "UAC policy unchanged"; return $false }
    }
    Write-Log "Applying UAC policy: $($Policy.name)"
    $changesApplied = $false
    try {
        if ($null -ne $Policy.enable_lua) { $v = if ($Policy.enable_lua) { 1 } else { 0 }; Set-ItemProperty -Path $uacPath -Name "EnableLUA" -Value $v -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.consent_prompt_admin) { Set-ItemProperty -Path $uacPath -Name "ConsentPromptBehaviorAdmin" -Value $Policy.consent_prompt_admin -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.consent_prompt_user) { Set-ItemProperty -Path $uacPath -Name "ConsentPromptBehaviorUser" -Value $Policy.consent_prompt_user -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.prompt_on_secure_desktop) { $v = if ($Policy.prompt_on_secure_desktop) { 1 } else { 0 }; Set-ItemProperty -Path $uacPath -Name "PromptOnSecureDesktop" -Value $v -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.detect_installations) { $v = if ($Policy.detect_installations) { 1 } else { 0 }; Set-ItemProperty -Path $uacPath -Name "EnableInstallerDetection" -Value $v -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.validate_admin_signatures) { $v = if ($Policy.validate_admin_signatures) { 1 } else { 0 }; Set-ItemProperty -Path $uacPath -Name "ValidateAdminCodeSignatures" -Value $v -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.filter_administrator_token) { $v = if ($Policy.filter_administrator_token) { 1 } else { 0 }; Set-ItemProperty -Path $uacPath -Name "FilterAdministratorToken" -Value $v -Type DWord -Force; $changesApplied = $true }
        if ($changesApplied) { $policyHash | Set-Content -Path $policyHashFile -Force; Write-Log "UAC policy applied" }
        return $changesApplied
    } catch { Write-Log "Error applying UAC policy: $_" -Level "ERROR"; return $false }
}
