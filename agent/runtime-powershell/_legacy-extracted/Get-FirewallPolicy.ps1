function Get-FirewallPolicy {
    param([string]$AgentToken)
    try {
        $headers = @{ "Content-Type" = "application/json"; "x-agent-token" = $AgentToken }
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/firewall-policy" -Method GET -Headers $headers -TimeoutSec 30
        if ($response.success -and $response.rules) {
            Write-Log "Firewall policy retrieved: $($response.rules.Count) rules"
            return $response
        } else {
            Write-Log "No firewall policy configured" -Level "DEBUG"
            return $null
        }
    } catch { Write-Log "Error fetching firewall policy: $_" -Level "WARN"; return $null }
}
