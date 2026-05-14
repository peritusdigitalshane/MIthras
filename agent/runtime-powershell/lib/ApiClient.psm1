# ApiClient.psm1 — HTTP client for the Peritus Secure Agent API.
# Wraps Invoke-RestMethod with HMAC signing. All non-enrol calls require an existing { agent_id, agent_secret }.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:libRoot = $PSScriptRoot
Import-Module (Join-Path $script:libRoot 'HmacAuth.psm1') -Force

function Invoke-AgentEnroll {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][string]$EnrollmentToken,
        [Parameter(Mandatory)][string]$Hostname,
        [Parameter()][string]$OsVersion,
        [Parameter()][string]$OsBuild,
        [Parameter(Mandatory=$false)][ValidateSet('powershell','dotnet')][string]$Runtime = 'powershell'
    )

    $body = @{
        enrollment_token = $EnrollmentToken
        hostname         = $Hostname
        runtime          = $Runtime
    }
    if ($OsVersion) { $body.os_version = $OsVersion }
    if ($OsBuild)   { $body.os_build   = $OsBuild }

    $url = "$ApiBaseUrl/functions/v1/agent-enroll"
    return Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' `
        -Body ($body | ConvertTo-Json -Compress) -UseBasicParsing
}

function Invoke-AgentHeartbeat {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][string]$AgentId,
        [Parameter(Mandatory)][string]$AgentSecret,
        [Parameter()][hashtable]$Payload = @{}
    )

    $rawBody = ConvertTo-CanonicalJson -Value $Payload
    $headers = New-HmacRequestHeaders -AgentId $AgentId -Secret $AgentSecret -Method 'POST' -Path '/agent-heartbeat' -RawBody $rawBody
    $url = "$ApiBaseUrl/functions/v1/agent-heartbeat"
    return Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' `
        -Headers $headers -Body $rawBody -UseBasicParsing
}

function Invoke-AgentVersionCheck {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][string]$AgentId,
        [Parameter(Mandatory)][string]$AgentSecret,
        [Parameter(Mandatory)][string]$CurrentVersion,
        [Parameter(Mandatory=$false)][ValidateSet('powershell','dotnet')][string]$Runtime = 'powershell'
    )

    $headers = New-HmacRequestHeaders -AgentId $AgentId -Secret $AgentSecret -Method 'GET' -Path '/agent-version-check' -RawBody ''
    $url = "$ApiBaseUrl/functions/v1/agent-version-check?current=$CurrentVersion&runtime=$Runtime"

    # 204 means no version published — Invoke-RestMethod throws on empty bodies, so use Invoke-WebRequest
    $resp = Invoke-WebRequest -Uri $url -Method Get -Headers $headers -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 204) { return $null }
    if ($resp.Content) { return $resp.Content | ConvertFrom-Json }
    return $null
}

function Invoke-AgentAppControlObserved {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][string]$AgentId,
        [Parameter(Mandatory)][string]$AgentSecret,
        [Parameter(Mandatory)][object[]]$Apps,
        [Parameter()][string]$Since
    )

    $payload = @{ apps = $Apps }
    if ($Since) { $payload.since = $Since }

    $rawBody = ConvertTo-CanonicalJson -Value $payload
    $path    = '/agent-app-control/observed'
    $headers = New-HmacRequestHeaders -AgentId $AgentId -Secret $AgentSecret -Method 'POST' -Path $path -RawBody $rawBody
    $url     = "$ApiBaseUrl/functions/v1$path"
    return Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' -Headers $headers -Body $rawBody -UseBasicParsing
}

Export-ModuleMember -Function Invoke-AgentEnroll, Invoke-AgentHeartbeat, Invoke-AgentVersionCheck, Invoke-AgentAppControlObserved
