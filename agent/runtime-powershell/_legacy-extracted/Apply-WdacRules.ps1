function Apply-WdacRules {
    param([Parameter(Mandatory=$true)]$PolicyResponse, [string]$AgentToken)
    $rules = $PolicyResponse.rules; $newHash = $PolicyResponse.rules_hash
    if (-not $rules -or $rules.Count -eq 0) { Write-Log "No WDAC rules to apply"; Remove-WdacCiPolicy; return }
    $currentHash = ""
    if (Test-Path $WdacHashFile) { $currentHash = (Get-Content $WdacHashFile -Raw).Trim() }
    if ($currentHash -eq $newHash) { Write-Log "WDAC rules unchanged (hash: $newHash)"; return }
    Write-Log "WDAC rules changed - applying enforcement"
    $enforcedBlockRules = @($rules | Where-Object { $_.mode -eq "enforced" -and $_.action -eq "block" })
    $enforcedAllowRules = @($rules | Where-Object { $_.mode -eq "enforced" -and $_.action -eq "allow" })
    $auditRules = @($rules | Where-Object { $_.mode -eq "audit" })
    try {
        $policyPath = "$ConfigPath\PeritusWdacPolicy.xml"
        $binaryPolicyPath = "$ConfigPath\PeritusWdacPolicy.bin"
        $cipPath = "$env:windir\System32\CodeIntegrity\CiPolicies\Active\{A244370E-44C9-4C06-B551-F6016E563076}.cip"
        $policyXml = Build-WdacPolicyXml -EnforcedBlockRules $enforcedBlockRules -EnforcedAllowRules $enforcedAllowRules -AuditRules $auditRules
        $policyXml | Set-Content -Path $policyPath -Force -Encoding UTF8
        $deployed = $false
        try {
            if (Get-Command ConvertFrom-CIPolicy -ErrorAction SilentlyContinue) {
                ConvertFrom-CIPolicy -XmlFilePath $policyPath -BinaryFilePath $binaryPolicyPath -ErrorAction Stop
                if (Get-Command CiTool -ErrorAction SilentlyContinue) { CiTool --update-policy $binaryPolicyPath 2>&1 | Out-Null; $deployed = $true }
                else { $cipDir = Split-Path $cipPath -Parent; if (-not (Test-Path $cipDir)) { New-Item -ItemType Directory -Path $cipDir -Force | Out-Null }; Copy-Item $binaryPolicyPath $cipPath -Force; $deployed = $true }
            }
        } catch { Write-Log "WDAC compilation failed: $_" -Level "WARN" }
        if (-not $deployed) { Write-Log "WDAC policy saved but could not be deployed automatically" -Level "WARN" }
        $newHash | Set-Content -Path $WdacHashFile -Force
    } catch { Write-Log "Error applying WDAC policy: $_" -Level "ERROR" }
}
