function Get-AssignedPolicy {
    param([string]$AgentToken)
    try {
        $headers = @{ "Content-Type" = "application/json"; "x-agent-token" = $AgentToken }
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/policy" -Method GET -Headers $headers
        return $response.policy
    } catch { Write-Log "Could not fetch policy: $_" -Level "WARN"; return $null }
}
