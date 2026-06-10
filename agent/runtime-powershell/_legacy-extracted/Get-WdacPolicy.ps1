function Get-WdacPolicy {
    param([string]$AgentToken)
    try {
        $headers = @{ "Content-Type" = "application/json"; "x-agent-token" = $AgentToken }
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/wdac-policy" -Method GET -Headers $headers
        return $response
    } catch { Write-Log "Could not fetch WDAC policy: $_" -Level "WARN"; return $null }
}
