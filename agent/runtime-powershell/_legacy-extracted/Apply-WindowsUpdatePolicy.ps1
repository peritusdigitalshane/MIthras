function Apply-WindowsUpdatePolicy {
    param([object]$Policy, [switch]$Force)
    if (-not $Policy) { return $false }
    $wuPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
    $wuAUPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
    $policyHashFile = "$ConfigPath\wu_policy_hash.txt"
    $policyJson = $Policy | ConvertTo-Json -Depth 5 -Compress
    $policyHash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($policyJson))).Replace("-", "").Substring(0, 16)
    if (-not $Force -and (Test-Path $policyHashFile)) {
        $lastHash = Get-Content $policyHashFile -ErrorAction SilentlyContinue
        if ($lastHash -eq $policyHash) { Write-Log "Windows Update policy unchanged"; return $false }
    }
    Write-Log "Applying Windows Update policy: $($Policy.name)"
    $changesApplied = $false
    try {
        if (-not (Test-Path $wuPolicyPath)) { New-Item -Path $wuPolicyPath -Force | Out-Null }
        if (-not (Test-Path $wuAUPath)) { New-Item -Path $wuAUPath -Force | Out-Null }
        if ($null -ne $Policy.auto_update_mode) { Set-ItemProperty -Path $wuAUPath -Name "AUOptions" -Value $Policy.auto_update_mode -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.active_hours_start) { Set-ItemProperty -Path $wuPolicyPath -Name "ActiveHoursStart" -Value $Policy.active_hours_start -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.active_hours_end) { Set-ItemProperty -Path $wuPolicyPath -Name "ActiveHoursEnd" -Value $Policy.active_hours_end -Type DWord -Force; $changesApplied = $true }
        if ($null -ne $Policy.feature_update_deferral -and $Policy.feature_update_deferral -gt 0) {
            Set-ItemProperty -Path $wuPolicyPath -Name "DeferFeatureUpdates" -Value 1 -Type DWord -Force
            Set-ItemProperty -Path $wuPolicyPath -Name "DeferFeatureUpdatesPeriodInDays" -Value $Policy.feature_update_deferral -Type DWord -Force; $changesApplied = $true
        }
        if ($null -ne $Policy.quality_update_deferral -and $Policy.quality_update_deferral -gt 0) {
            Set-ItemProperty -Path $wuPolicyPath -Name "DeferQualityUpdates" -Value 1 -Type DWord -Force
            Set-ItemProperty -Path $wuPolicyPath -Name "DeferQualityUpdatesPeriodInDays" -Value $Policy.quality_update_deferral -Type DWord -Force; $changesApplied = $true
        }
        if ($changesApplied) { $policyHash | Set-Content -Path $policyHashFile -Force; Write-Log "Windows Update policy applied" }
        return $changesApplied
    } catch { Write-Log "Error applying Windows Update policy: $_" -Level "ERROR"; return $false }
}
