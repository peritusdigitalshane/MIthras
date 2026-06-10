function Get-UacStatus {
    try {
        $uacPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
        if (-not (Test-Path $uacPath)) { return @{} }
        $reg = Get-ItemProperty -Path $uacPath -ErrorAction SilentlyContinue
        return @{
            uac_enabled = if ($null -ne $reg.EnableLUA) { $reg.EnableLUA -eq 1 } else { $null }
            uac_consent_prompt_admin = $reg.ConsentPromptBehaviorAdmin
            uac_consent_prompt_user = $reg.ConsentPromptBehaviorUser
            uac_prompt_on_secure_desktop = if ($null -ne $reg.PromptOnSecureDesktop) { $reg.PromptOnSecureDesktop -eq 1 } else { $null }
            uac_detect_installations = if ($null -ne $reg.EnableInstallerDetection) { $reg.EnableInstallerDetection -eq 1 } else { $null }
            uac_validate_admin_signatures = if ($null -ne $reg.ValidateAdminCodeSignatures) { $reg.ValidateAdminCodeSignatures -eq 1 } else { $null }
            uac_filter_administrator_token = if ($null -ne $reg.FilterAdministratorToken) { $reg.FilterAdministratorToken -eq 1 } else { $null }
        }
    } catch {
        Write-Log "Error getting UAC status: $_" -Level "ERROR"
        return @{}
    }
}
