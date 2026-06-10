function Get-UacPolicy {
    param([string]$AgentToken)
    try {
        $headers = @{ "Content-Type" = "application/json"; "x-agent-token" = $AgentToken }
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/uac-policy" -Method GET -Headers $headers
        return $response
    } catch { Write-Log "Could not fetch UAC policy: $_" -Level "WARN"; return $null }
}
