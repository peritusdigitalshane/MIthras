# WdacEnforcer.psm1 -- v0.6.0
#
# Wires Windows Defender Application Control (WDAC) through the modular
# Mithras agent. Mirrors the AppWhitelist state machine for OS SKUs that
# support kernel-level enforcement (Win10/11 Enterprise, Server 2016+):
#
#   * fetches /wdac-policy from agent-api
#   * converts the rule list into a CI Policy XML
#   * applies via Set-CIPolicy (Win10/11 modern) or by writing the
#     compiled .p7b to %SystemRoot%\System32\CodeIntegrity\
#   * reports apply result back via /wdac-applied
#
# Rule types honoured (mirrors AppWhitelist):
#   publisher       -- Authenticode CN
#   path            -- C:\Path\*  glob
#   hash            -- SHA-256 file hash
#   file_name       -- bare exe filename (case-insensitive)
#   trusted_path    -- path glob AND publisher must both match (Airlock-style)
#
# Safety:
#   * never applies anything if the assigned rule set is empty
#   * Audit mode is the default and is a SAFE state (logs only, no enforcement)
#   * Enforce mode requires a real assignment whose `mode` field reads 'enforce'
#   * If Set-CIPolicy is unavailable (older OS), this module is a no-op and
#     reports back with an explanatory error -- the AppWhitelist user-mode
#     path remains in effect.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

function _WdacLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'collectors.log') -Value "[$(Get-Date -Format o)] [$lvl] wdac: $msg" -Encoding UTF8
    } catch {}
}

function Test-WdacSupported {
    # Set-CIPolicy ships on Win10 1903+, Server 2019+. ConvertFrom-CIPolicy
    # is the conversion path; if it's missing we can't ship a usable policy.
    return [bool](Get-Command -Name ConvertFrom-CIPolicy -ErrorAction SilentlyContinue)
}

function Get-WdacPolicy {
    param(
        [Parameter(Mandatory)][string]$AgentToken,
        [Parameter(Mandatory)][string]$ApiBaseUrl
    )
    try {
        $h = @{ 'x-agent-token' = $AgentToken }
        $r = Invoke-RestMethod -Uri "$ApiBaseUrl/wdac-policy" -Method GET -Headers $h -TimeoutSec 30 -ErrorAction Stop
        return @{ ok = $true; rules = $r.rules; rules_hash = $r.rules_hash; rules_count = $r.rules_count }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message; rules = @(); rules_hash = $null; rules_count = 0 }
    }
}

function Send-WdacApplied {
    param(
        [Parameter(Mandatory)][string]$AgentToken,
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][string]$RulesHash,
        [Parameter(Mandatory)][ValidateSet('audit','enforce','off')][string]$Mode,
        [string]$ErrorMessage,
        [string]$RuleSetId
    )
    try {
        $h    = @{ 'Content-Type'='application/json'; 'x-agent-token' = $AgentToken }
        $body = @{ rules_hash = $RulesHash; mode = $Mode }
        if ($ErrorMessage) { $body.error      = $ErrorMessage }
        if ($RuleSetId)    { $body.rule_set_id = $RuleSetId }
        $r = Invoke-RestMethod -Uri "$ApiBaseUrl/wdac-applied" -Method POST -Headers $h `
                -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 30 -ErrorAction Stop
        return @{ ok = $true; updated = $r.updated }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    }
}

function _XmlEsc($s) {
    if (-not $s) { return '' }
    return ([string]$s).Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&apos;')
}

function ConvertTo-WdacPolicyXml {
    # Build a minimal-but-valid CI Policy XML from a flat rule array. Returns
    # the XML string; the caller writes it to disk and runs ConvertFrom-CIPolicy.
    #
    # Mode parameter affects the PolicyOptions block:
    #   audit   -> ASM "Enabled:Audit Mode" present, no UMCI enforcement
    #   enforce -> Audit option REMOVED; UMCI enforcement on
    param(
        [Parameter(Mandatory)][array]$Rules,
        [ValidateSet('audit','enforce')][string]$Mode = 'audit'
    )

    $allowSb = New-Object System.Text.StringBuilder
    $signerSb = New-Object System.Text.StringBuilder
    $fileRefSb = New-Object System.Text.StringBuilder
    $idx = 0

    foreach ($r in $Rules) {
        $idx++
        $type = ([string]$r.rule_type).ToLower()
        $val  = [string]$r.value
        if (-not $val) { continue }
        $act  = if ($r.action -eq 'block') { 'Deny' } else { 'Allow' }

        switch ($type) {
            'hash' {
                # CI policy allow-by-hash uses a FileAttribute on a hash rule.
                [void]$fileRefSb.AppendLine(("    <Allow ID=`"ID_ALLOW_H_$idx`" FriendlyName=`"" + (_XmlEsc $r.description) + "`" Hash=`"" + ($val.ToUpperInvariant()) + "`" />"))
            }
            'path' {
                [void]$fileRefSb.AppendLine(("    <Allow ID=`"ID_ALLOW_P_$idx`" FriendlyName=`"" + (_XmlEsc $r.description) + "`" FilePath=`"" + (_XmlEsc $val) + "`" />"))
            }
            'file_name' {
                [void]$fileRefSb.AppendLine(("    <Allow ID=`"ID_ALLOW_N_$idx`" FriendlyName=`"" + (_XmlEsc $r.description) + "`" FileName=`"" + (_XmlEsc $val) + "`" />"))
            }
            'publisher' {
                # WDAC schema: <Signer> MUST have a <CertRoot> child before
                # any <CertPublisher>. Wellknown=06 is the Microsoft Product
                # Root, which acts as the chain anchor; the CertPublisher
                # then narrows the rule to the named subject DN. Without
                # CertRoot the policy XML fails ConvertFrom-CIPolicy with
                # "invalid child element 'CertPublisher'" and the apply hangs.
                [void]$signerSb.AppendLine(("    <Signer ID=`"ID_SIGNER_S_$idx`" Name=`"" + (_XmlEsc $val) + "`"><CertRoot Type=`"Wellknown`" Value=`"06`" /><CertPublisher Value=`"" + (_XmlEsc $val) + "`" /></Signer>"))
            }
            'trusted_path' {
                # Compound: path filter AND publisher requirement.
                $pub = [string]$r.publisher_name
                if (-not $pub) { continue }
                [void]$fileRefSb.AppendLine(("    <Allow ID=`"ID_ALLOW_TP_$idx`" FriendlyName=`"" + (_XmlEsc $r.description) + "`" FilePath=`"" + (_XmlEsc $val) + "`" />"))
                [void]$signerSb.AppendLine(("    <Signer ID=`"ID_SIGNER_TP_$idx`" Name=`"" + (_XmlEsc $pub) + "`"><CertRoot Type=`"Wellknown`" Value=`"06`" /><CertPublisher Value=`"" + (_XmlEsc $pub) + "`" /><FileAttribRef RuleID=`"ID_ALLOW_TP_$idx`" /></Signer>"))
            }
        }
    }

    $policyOptions = if ($Mode -eq 'audit') {
        @'
    <Rule><Option>Enabled:Unsigned System Integrity Policy</Option></Rule>
    <Rule><Option>Enabled:Audit Mode</Option></Rule>
    <Rule><Option>Enabled:Advanced Boot Options Menu</Option></Rule>
'@
    } else {
        @'
    <Rule><Option>Enabled:Unsigned System Integrity Policy</Option></Rule>
    <Rule><Option>Enabled:Advanced Boot Options Menu</Option></Rule>
'@
    }

    $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<SiPolicy xmlns="urn:schemas-microsoft-com:sipolicy">
  <VersionEx>1.0.0.0</VersionEx>
  <PolicyTypeID>{A244370E-44C9-4C06-B551-F6016E563076}</PolicyTypeID>
  <PlatformID>{2E07F7E4-194C-4D20-B7C9-6F44A6C5A234}</PlatformID>
  <Rules>
$policyOptions
  </Rules>
  <FileRules>
$($fileRefSb.ToString())
  </FileRules>
  <Signers>
$($signerSb.ToString())
  </Signers>
  <SigningScenarios>
    <SigningScenario Value="131" ID="ID_SIGNINGSCENARIO_WINDOWS" FriendlyName="User Mode"><ProductSigners /></SigningScenario>
  </SigningScenarios>
  <UpdatePolicySigners />
  <CiSigners />
  <HvciOptions>0</HvciOptions>
  <Settings>
    <Setting Provider="WindowsLockdown" Key="CI" ValueName="Name"><Value><String>Mithras WDAC</String></Value></Setting>
  </Settings>
</SiPolicy>
"@
    return $xml
}

function Apply-WdacPolicy {
    # Writes the XML policy, compiles via ConvertFrom-CIPolicy, and places the
    # resulting .p7b at the CodeIntegrity directory so the boot loader picks
    # it up. Returns @{ ok, applied_path, error }.
    param(
        [Parameter(Mandatory)][string]$PolicyXml
    )
    if (-not (Test-WdacSupported)) {
        return @{ ok = $false; error = 'wdac_unsupported_on_this_sku'; applied_path = $null }
    }
    try {
        $stage = 'C:\ProgramData\Mithras\wdac'
        if (-not (Test-Path $stage)) { New-Item -ItemType Directory -Path $stage -Force | Out-Null }
        $xmlPath = Join-Path $stage 'mithras-wdac.xml'
        $binPath = Join-Path $stage 'mithras-wdac.bin'
        Set-Content -Path $xmlPath -Value $PolicyXml -Encoding utf8 -Force

        ConvertFrom-CIPolicy -XmlFilePath $xmlPath -BinaryFilePath $binPath -ErrorAction Stop | Out-Null

        # System32\CodeIntegrity\SiPolicy.p7b is read at boot and on policy
        # refresh. CiTool /RefreshPolicy (Win11) re-evaluates without reboot.
        $sysPath = 'C:\Windows\System32\CodeIntegrity\SiPolicy.p7b'
        Copy-Item -Path $binPath -Destination $sysPath -Force

        try { & citool.exe /rp 2>$null | Out-Null } catch {}

        return @{ ok = $true; applied_path = $sysPath; error = $null }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message; applied_path = $null }
    }
}

Export-ModuleMember -Function Test-WdacSupported, Get-WdacPolicy, Send-WdacApplied, ConvertTo-WdacPolicyXml, Apply-WdacPolicy
