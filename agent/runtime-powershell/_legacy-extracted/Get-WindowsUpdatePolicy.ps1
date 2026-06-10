function Get-WindowsUpdatePolicy {
    param([string]$AgentToken)
    try {
        $headers = @{ "Content-Type" = "application/json"; "x-agent-token" = $AgentToken }
        $response = Invoke-RestMethod -Uri "$ApiBaseUrl/windows-update-policy" -Method GET -Headers $headers
        return $response
    } catch { Write-Log "Could not fetch Windows Update policy: $_" -Level "WARN"; return $null }
}
