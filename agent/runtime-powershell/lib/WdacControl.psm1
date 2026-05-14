# WdacControl.psm1 — WDAC application-control agent module (Phase 1).
# Functions are added by subsequent tasks.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertFrom-CodeIntegrityEvent {
    [CmdletBinding()]
    param([Parameter(Mandatory)][xml]$EventXml)

    $sys  = $EventXml.Event.System
    $data = @{}
    foreach ($d in $EventXml.Event.EventData.Data) {
        $data[$d.Name] = $d.'#text'
    }

    $filePath = $data['File Name']
    $fileName = if ($filePath) { [System.IO.Path]::GetFileName($filePath.TrimEnd('\','/')) } else { $null }

    [hashtable]@{
        event_id       = [int]$sys.EventID
        event_time     = ([datetime]$sys.TimeCreated.SystemTime).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        record_id      = [long]$sys.EventRecordID
        file_path      = $filePath
        file_name      = $fileName
        file_hash      = $data['SHA256 Hash']
        process_name   = $data['Process Name']
        parent_process = $data['Process Name']  # CodeIntegrity emits Process Name = the launcher
        user_name      = $data['User Name']
        is_block       = ([int]$sys.EventID -eq 3077)
    }
}

function ConvertTo-CIPolicyXml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rules,
        [Parameter(Mandatory)][ValidateSet('audit','enforce','off')][string]$Mode,
        [Parameter(Mandatory)][string]$PolicyGuid
    )

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('<?xml version="1.0" encoding="utf-8"?>')
    [void]$sb.AppendLine('<SiPolicy xmlns="urn:schemas-microsoft-com:sipolicy">')
    [void]$sb.AppendLine('  <VersionEx>10.0.0.0</VersionEx>')
    [void]$sb.AppendLine("  <PolicyTypeID>$PolicyGuid</PolicyTypeID>")
    [void]$sb.AppendLine('  <PlatformID>{2E07F7E4-194C-4D20-B7C9-6F44A6C5A234}</PlatformID>')

    [void]$sb.AppendLine('  <Rules>')
    [void]$sb.AppendLine('    <Rule><Option>Enabled:Unsigned System Integrity Policy</Option></Rule>')
    if ($Mode -eq 'audit') {
        [void]$sb.AppendLine('    <Rule><Option>Enabled:Audit Mode</Option></Rule>')
    }
    [void]$sb.AppendLine('  </Rules>')

    # File rules — emit Allow elements with synthetic IDs.
    [void]$sb.AppendLine('  <FileRules>')
    for ($i = 0; $i -lt $Rules.Count; $i++) {
        $r = $Rules[$i]
        $id = "ID_ALLOW_$i"
        $action = if ($r.action -eq 'allow') { 'Allow' } else { 'Deny' }
        switch ($r.rule_type) {
            'hash'      { [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"hash_$i`" Hash=`"$($r.value)`" />") }
            'publisher' { [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"publisher_$i`" PackageFamilyName=`"$($r.publisher_name)`" />") }
            'path'      { [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"path_$i`" FilePath=`"$($r.value)`" />") }
            'file_name' { [void]$sb.AppendLine("    <$action ID=`"$id`" FriendlyName=`"name_$i`" FileName=`"$($r.value)`" />") }
            default     { }
        }
    }
    [void]$sb.AppendLine('  </FileRules>')

    [void]$sb.AppendLine('  <Signers />')
    [void]$sb.AppendLine('  <SigningScenarios />')
    [void]$sb.AppendLine('  <UpdatePolicySigners />')
    [void]$sb.AppendLine('  <CiSigners />')
    [void]$sb.AppendLine('  <HvciOptions>0</HvciOptions>')
    [void]$sb.AppendLine('</SiPolicy>')

    $sb.ToString()
}

Export-ModuleMember -Function ConvertFrom-CodeIntegrityEvent, ConvertTo-CIPolicyXml
