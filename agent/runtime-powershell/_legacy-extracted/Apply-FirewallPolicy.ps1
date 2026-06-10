function Apply-FirewallPolicy {
    param([Parameter(Mandatory=$true)]$PolicyResponse, [switch]$Force)
    $RulePrefix = "PeritusSecure_FW_"
    $rules = $PolicyResponse.rules
    if (-not $rules -or $rules.Count -eq 0) { Write-Log "No firewall rules to apply"; return $false }
    try {
        $applied = 0; $skipped = 0; $enforcedCount = 0; $auditCount = 0
        $existingRules = Get-NetFirewallRule -Name "$RulePrefix*" -ErrorAction SilentlyContinue
        $existingRuleNames = @{}
        if ($existingRules) { foreach ($rule in $existingRules) { $existingRuleNames[$rule.Name] = $rule } }
        $processedRuleNames = @{}
        foreach ($rule in $rules) {
            $ruleId = $rule.id; $serviceName = $rule.service_name; $port = $rule.port; $protocol = $rule.protocol; $action = $rule.action; $mode = $rule.mode; $allowedIps = @($rule.allowed_source_ips)
            $ports = $port -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' }
            foreach ($singlePort in $ports) {
                $ruleName = "$RulePrefix$($serviceName)_$($singlePort)_$($protocol)"
                $processedRuleNames[$ruleName] = $true
                if ($mode -eq "audit") {
                    $auditCount++; $fwAction = "Allow"; $displayName = "[AUDIT] Peritus - $serviceName ($singlePort/$protocol)"
                } else {
                    $enforcedCount++
                    switch ($action) {
                        "block" { $fwAction = "Block"; $displayName = "[BLOCK] Peritus - $serviceName ($singlePort/$protocol)" }
                        "allow" { $fwAction = "Allow"; $displayName = "[ALLOW] Peritus - $serviceName ($singlePort/$protocol)" }
                        "allow_from_groups" {
                            if ($allowedIps.Count -gt 0) { $fwAction = "Allow"; $displayName = "[ALLOW FROM IPs] Peritus - $serviceName ($singlePort/$protocol)" }
                            else { $fwAction = "Block"; $displayName = "[BLOCK - No IPs] Peritus - $serviceName ($singlePort/$protocol)" }
                        }
                        default { $fwAction = "Block"; $displayName = "[BLOCK] Peritus - $serviceName ($singlePort/$protocol)" }
                    }
                }
                $existingRule = $existingRuleNames[$ruleName]
                if ($existingRule -and -not $Force) {
                    $existingAction = $existingRule.Action.ToString()
                    if ($existingAction -eq $fwAction) { $skipped++; continue }
                }
                if ($existingRule) { Remove-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue }
                $ruleParams = @{ Name = $ruleName; DisplayName = $displayName; Direction = "Inbound"; Protocol = if ($protocol -eq "both") { "TCP" } else { $protocol.ToUpper() }; LocalPort = $singlePort; Action = $fwAction; Enabled = "True"; Profile = "Any"; Description = "Managed by Peritus Threat Defence. Rule ID: $ruleId" }
                if ($action -eq "allow_from_groups" -and $allowedIps.Count -gt 0 -and $mode -eq "enforce") { $ruleParams["RemoteAddress"] = $allowedIps }
                try { New-NetFirewallRule @ruleParams -ErrorAction Stop | Out-Null; $applied++ } catch { Write-Log "Failed to create firewall rule $ruleName : $_" -Level "WARN" }
                if ($protocol -eq "both") {
                    $udpRuleName = "$RulePrefix$($serviceName)_$($singlePort)_UDP"
                    $processedRuleNames[$udpRuleName] = $true
                    Remove-NetFirewallRule -Name $udpRuleName -ErrorAction SilentlyContinue
                    $udpRuleParams = $ruleParams.Clone(); $udpRuleParams["Name"] = $udpRuleName; $udpRuleParams["DisplayName"] = $displayName -replace '\)$', '/UDP)'; $udpRuleParams["Protocol"] = "UDP"
                    try { New-NetFirewallRule @udpRuleParams -ErrorAction Stop | Out-Null; $applied++ } catch { Write-Log "Failed to create UDP firewall rule: $_" -Level "WARN" }
                }
            }
        }
        $removedCount = 0
        foreach ($existingName in $existingRuleNames.Keys) {
            if (-not $processedRuleNames.ContainsKey($existingName)) {
                try { Remove-NetFirewallRule -Name $existingName -ErrorAction SilentlyContinue; $removedCount++ } catch {}
            }
        }
        Write-Log "Firewall policy applied: $applied created, $skipped unchanged, $removedCount removed (Audit: $auditCount, Enforce: $enforcedCount)"
        return $true
    } catch { Write-Log "Error applying firewall policy: $_" -Level "ERROR"; return $false }
}
