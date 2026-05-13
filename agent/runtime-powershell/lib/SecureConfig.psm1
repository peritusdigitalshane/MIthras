# SecureConfig.psm1 — DPAPI-encrypted JSON config for the Peritus Secure Agent.
# Scope: LocalMachine. Encrypted blob is only decryptable on the same machine, by SYSTEM or local admins.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Security

function Save-SecureConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][hashtable]$Config
    )

    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $json = $Config | ConvertTo-Json -Compress -Depth 10
    $plaintext = [System.Text.Encoding]::UTF8.GetBytes($json)
    $protected = [System.Security.Cryptography.ProtectedData]::Protect(
        $plaintext,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::LocalMachine)

    [System.IO.File]::WriteAllBytes($Path, $protected)

    # ACL: SYSTEM + Administrators full control; everyone else removed
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)   # disable inheritance, do not copy parent rules
    $ruleSystem = New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.NTAccount]'NT AUTHORITY\SYSTEM',
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow)
    $ruleAdmins = New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.NTAccount]'BUILTIN\Administrators',
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($ruleSystem)
    $acl.AddAccessRule($ruleAdmins)
    Set-Acl -Path $Path -AclObject $acl
}

function Read-SecureConfig {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Config file not found: $Path"
    }

    $protected = [System.IO.File]::ReadAllBytes($Path)
    $plaintext = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $protected,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::LocalMachine)

    $json = [System.Text.Encoding]::UTF8.GetString($plaintext)
    $obj = $json | ConvertFrom-Json

    # ConvertFrom-Json returns PSCustomObject; flatten to hashtable for predictable access
    $h = @{}
    foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = $p.Value }
    return $h
}

function Test-SecureConfigExists {
    [CmdletBinding()]
    [OutputType([bool])]
    param([Parameter(Mandatory)][string]$Path)
    return (Test-Path $Path)
}

Export-ModuleMember -Function Save-SecureConfig, Read-SecureConfig, Test-SecureConfigExists
