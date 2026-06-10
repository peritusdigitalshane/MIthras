function Get-GpoPolicy {
    param([string]$AgentToken)
    try {
        $headers = @{ "Content-Type" = "application/json"; "x-agent-token" = $AgentToken }
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/gpo-policy" -Method GET -Headers $headers -TimeoutSec 30
        return $response
    } catch { Write-Log "Could not fetch GPO policy: $_" -Level "WARN"; return $null }
}
