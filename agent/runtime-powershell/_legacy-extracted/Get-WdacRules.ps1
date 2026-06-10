function Get-WdacRules {
    param([string]$AgentToken)
    try {
        $headers = @{ "Content-Type" = "application/json"; "x-agent-token" = $AgentToken }
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/wdac-policy" -Method GET -Headers $headers -TimeoutSec 30
        if ($response.success) { Write-Log "WDAC policy retrieved: $($response.rules_count) rules"; return $response }
        else { Write-Log "No WDAC policy configured" -Level "DEBUG"; return $null }
    } catch { Write-Log "Error fetching WDAC policy: $_" -Level "WARN"; return $null }
}
