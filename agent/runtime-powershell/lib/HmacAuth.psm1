# HmacAuth.psm1 — request signing for Peritus Secure Agent
# Matches supabase/functions/_shared/hmac.ts byte-for-byte. See agent/contracts/hmac-canonicalization.md.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-CanonicalJson {
    [CmdletBinding()]
    param([Parameter(Mandatory, Position = 0)][AllowNull()]$Value)

    if ($null -eq $Value) { return 'null' }

    if ($Value -is [bool]) { return $(if ($Value) { 'true' } else { 'false' }) }

    if ($Value -is [int] -or $Value -is [long] -or $Value -is [int16] -or $Value -is [byte] -or $Value -is [sbyte]) {
        return [string]$Value
    }

    if ($Value -is [double] -or $Value -is [float] -or $Value -is [decimal]) {
        if ([double]::IsNaN([double]$Value) -or [double]::IsInfinity([double]$Value)) { return 'null' }
        # Match JS Number.toString() shortest round-trip; integers become "1" not "1.0"
        $d = [double]$Value
        if ($d -eq [Math]::Truncate($d)) { return [string][long]$d }
        return $d.ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }

    if ($Value -is [string]) {
        # JSON-escape matching RFC 8259. Mirrors JS JSON.stringify for strings.
        $sb = [System.Text.StringBuilder]::new()
        [void]$sb.Append('"')
        foreach ($c in $Value.ToCharArray()) {
            $code = [int]$c
            switch ($code) {
                0x22 { [void]$sb.Append('\"');  break }
                0x5C { [void]$sb.Append('\\');  break }
                0x08 { [void]$sb.Append('\b');  break }
                0x0C { [void]$sb.Append('\f');  break }
                0x0A { [void]$sb.Append('\n');  break }
                0x0D { [void]$sb.Append('\r');  break }
                0x09 { [void]$sb.Append('\t');  break }
                default {
                    if ($code -lt 0x20) {
                        [void]$sb.Append('\u')
                        [void]$sb.Append($code.ToString('x4'))
                    } else {
                        [void]$sb.Append($c)
                    }
                }
            }
        }
        [void]$sb.Append('"')
        return $sb.ToString()
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $keys = @($Value.Keys | Sort-Object { [string]$_ })
        $parts = foreach ($k in $keys) {
            $keyJson = ConvertTo-CanonicalJson -Value ([string]$k)
            $valJson = ConvertTo-CanonicalJson -Value $Value[$k]
            "${keyJson}:${valJson}"
        }
        return '{' + ($parts -join ',') + '}'
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        $parts = foreach ($item in $Value) { ConvertTo-CanonicalJson -Value $item }
        return '[' + ($parts -join ',') + ']'
    }

    # PSCustomObject — iterate properties as ordered dictionary
    if ($Value.PSObject -and $Value.PSObject.Properties) {
        $dict = [ordered]@{}
        foreach ($p in $Value.PSObject.Properties) { $dict[$p.Name] = $p.Value }
        return ConvertTo-CanonicalJson -Value $dict
    }

    # Fallback — encode as null to keep output deterministic
    return 'null'
}

function Get-HmacSignature {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Secret,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Timestamp,
        [Parameter()][string]$RawBody = ''
    )

    $message = "$($Method.ToUpperInvariant())`n$Path`n$Timestamp`n$RawBody"
    $key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($message)
    $hmac = [System.Security.Cryptography.HMACSHA256]::new($key)
    try {
        $hash = $hmac.ComputeHash($bytes)
        return -join ($hash | ForEach-Object { $_.ToString('x2') })
    } finally {
        $hmac.Dispose()
    }
}

function New-HmacRequestHeaders {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$AgentId,
        [Parameter(Mandatory)][string]$Secret,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [Parameter()][string]$RawBody = ''
    )

    $ts = [string][long](([DateTimeOffset]::UtcNow).ToUnixTimeSeconds())
    $sig = Get-HmacSignature -Secret $Secret -Method $Method -Path $Path -Timestamp $ts -RawBody $RawBody
    return @{
        'X-Agent-Id'  = $AgentId
        'X-Timestamp' = $ts
        'X-Signature' = $sig
    }
}

Export-ModuleMember -Function ConvertTo-CanonicalJson, Get-HmacSignature, New-HmacRequestHeaders
