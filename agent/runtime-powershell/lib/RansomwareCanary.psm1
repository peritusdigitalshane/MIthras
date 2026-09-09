# RansomwareCanary.psm1 -- v0.6.6
#
# Drops a small set of decoy files in tempting locations and watches them
# for modification / deletion / rename. Ransomware that walks user
# documents will trip a canary BEFORE it gets to real customer data, giving
# us a critical-severity alert (and the chance to auto-isolate) seconds
# after first touch instead of after the user notices the ransom note.
#
# Design choices:
#   * Files live in C:\Users\Public\Documents\ -- visible to any user
#     session, walked by every ransomware family that targets user docs.
#   * Plus a hidden canary at C:\ProgramData\Mithras\canary\ for ransomware
#     that walks ProgramData (rare but seen).
#   * File names are deliberately bait: "IMPORTANT - DO NOT DELETE",
#     "Tax Records 2024", "Vendor Invoices" -- the kind of name a victim
#     would never want to lose.
#   * Content has valid magic bytes (PDF / DOCX / XLSX) so file-type
#     filters in ransomware don't skip them.
#   * State: canary-state.json maps each canary path to its expected
#     sha256, size, and mtime. Any drift on Test-MithrasCanaries returns
#     a tripped record.
#   * Polling cadence: every heartbeat (30s default as of v0.7.6). Catches
#     ransomware that takes seconds-to-minutes to walk a fleet, and faster
#     cadence means less time between encryption start and tripped alert.
#   * Idempotent re-creation: Initialize-MithrasCanaries replaces canaries
#     that were deleted or modified (after they were already shipped as
#     tripped), so the trap re-arms automatically.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$script:CANARY_STATE_FILE = 'C:\ProgramData\Mithras\canary-state.json'
$script:CANARY_DIR_HIDDEN = 'C:\ProgramData\Mithras\canary'

# Tempting bait filenames. Mix of locations + extensions. Public Documents
# is walked by basically every ransomware family that targets endpoints.
$script:CANARY_SPECS = @(
    @{ path = 'C:\Users\Public\Documents\IMPORTANT - DO NOT DELETE.docx';  type = 'docx' }
    @{ path = 'C:\Users\Public\Documents\Vendor Invoices Master.xlsx';     type = 'xlsx' }
    @{ path = 'C:\Users\Public\Documents\Tax Records 2024.pdf';            type = 'pdf'  }
    @{ path = 'C:\Users\Public\Documents\Customer Database Backup.xlsx';   type = 'xlsx' }
    @{ path = 'C:\ProgramData\Mithras\canary\_archive_2024.zip';           type = 'zip'  }
)

function _CnLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'canary.log') -Value "[$(Get-Date -Format o)] [$lvl] $msg" -Encoding UTF8
    } catch {}
}

function _ReadState {
    if (Test-Path $script:CANARY_STATE_FILE) {
        try {
            $raw = Get-Content $script:CANARY_STATE_FILE -Raw
            if ($raw) { return (ConvertFrom-Json $raw) }
        } catch {}
    }
    return @{}
}

function _WriteState($state) {
    try {
        $dir = Split-Path $script:CANARY_STATE_FILE -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $state | ConvertTo-Json -Depth 4 | Set-Content -Path $script:CANARY_STATE_FILE -Force -Encoding utf8
    } catch {}
}

# Build canary content with valid magic bytes so ransomware extension
# filters treat it as a real document. Content is otherwise garbage --
# the SHA256 is computed at write time and stored in state.
function _BuildCanaryBytes {
    param([string]$Type)

    $rand = New-Object byte[] 1024
    (New-Object Random).NextBytes($rand)

    # PowerShell's array `+` produces Object[], which [System.IO.File]::WriteAllBytes
    # rejects with a misleading "Could not find file" error. We assemble via a
    # generic List[byte] and cast to byte[] before returning.
    $list = New-Object System.Collections.Generic.List[byte]
    switch ($Type) {
        'pdf' {
            # %PDF-1.7 header (real magic) + random body + %%EOF trailer.
            $hdr = [System.Text.Encoding]::ASCII.GetBytes("%PDF-1.7`n%PDFCANARY`n")
            $trl = [System.Text.Encoding]::ASCII.GetBytes("`n%%EOF`n")
            $list.AddRange([byte[]]$hdr)
            $list.AddRange([byte[]]$rand)
            $list.AddRange([byte[]]$trl)
        }
        'docx' {
            # ZIP magic (DOCX is a ZIP). Real opener will fail; ransomware filter is happy.
            $list.AddRange([byte[]]@(0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00))
            $list.AddRange([byte[]]$rand)
        }
        'xlsx' {
            $list.AddRange([byte[]]@(0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00))
            $list.AddRange([byte[]]$rand)
        }
        'zip' {
            $list.AddRange([byte[]]@(0x50, 0x4B, 0x03, 0x04))
            $list.AddRange([byte[]]$rand)
        }
        default {
            $list.AddRange([byte[]]$rand)
        }
    }
    return ,$list.ToArray()
}

function _HashFile($path) {
    try { return (Get-FileHash -Path $path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLower() }
    catch { return $null }
}

function Initialize-MithrasCanaries {
    <#
    .SYNOPSIS
    Ensure every canary exists with valid magic bytes. Updates state file with
    expected hash/size/mtime for each. Idempotent -- safe to call every loop.
    If a canary was deliberately deleted (after a real trip was shipped), this
    recreates it so the trap re-arms.
    #>

    # Hidden ProgramData canary dir + visibility flags.
    if (-not (Test-Path $script:CANARY_DIR_HIDDEN)) {
        New-Item -ItemType Directory -Path $script:CANARY_DIR_HIDDEN -Force | Out-Null
        try { (Get-Item $script:CANARY_DIR_HIDDEN -Force).Attributes = 'Hidden,System' } catch {}
    }
    # Ensure Public\Documents exists (it always does on Win, but defensive).
    $pubDocs = 'C:\Users\Public\Documents'
    if (-not (Test-Path $pubDocs)) { New-Item -ItemType Directory -Path $pubDocs -Force | Out-Null }

    $state = @{}
    foreach ($spec in $script:CANARY_SPECS) {
        $p = $spec.path
        try {
            if (-not (Test-Path $p)) {
                $bytes = _BuildCanaryBytes -Type $spec.type
                [System.IO.File]::WriteAllBytes($p, $bytes)
                # Mark read-only so casual edits trip a different code path
                # than the silent recompute on _HashFile.
                try { (Get-Item $p -Force).Attributes = 'ReadOnly,Archive' } catch {}
                _CnLog 'INFO' "created canary: $p"
            }
            $hash = _HashFile $p
            $info = Get-Item $p -Force -ErrorAction Stop
            $state[$p] = @{
                sha256 = $hash
                size   = $info.Length
                mtime  = $info.LastWriteTimeUtc.ToString('o')
                type   = $spec.type
            }
        } catch {
            _CnLog 'WARN' "init failed for ${p}: $_"
        }
    }
    _WriteState $state
    return @{ ok = $true; canary_count = $state.Count }
}

function Test-MithrasCanaries {
    <#
    .SYNOPSIS
    Compare each canary against expected state. Returns @() if all canaries
    are intact, or an array of trip records for missing/modified/renamed
    files. Trip records ship as `canary_events` in the heartbeat.

    Returned shape per trip:
      {
        path:           string,    # the canary file
        event_type:     'modified' | 'deleted',
        observed_sha256: string|null,
        expected_sha256: string,
        observed_size:   int|null,
        expected_size:   int,
        event_time:      ISO UTC string
      }
    #>

    $state = _ReadState
    $trips = New-Object System.Collections.Generic.List[hashtable]
    if (-not $state) { return ,@($trips.ToArray()) }

    # _ReadState returns a PSCustomObject from ConvertFrom-Json; iterate
    # PSObject.Properties to handle both empty and populated cases. We
    # tolerate either a hashtable (older state files) or the PSCustomObject
    # shape -- normalise via PSObject.Properties.
    foreach ($prop in @($state.PSObject.Properties)) {
        $path = $prop.Name
        $expected = $prop.Value
        $expSha = if ($expected.PSObject.Properties.Match('sha256').Count -gt 0) { [string]$expected.sha256 } else { '' }
        $expSize = if ($expected.PSObject.Properties.Match('size').Count -gt 0) { [int64]$expected.size } else { 0 }

        if (-not (Test-Path $path)) {
            $trips.Add(@{
                path             = $path
                event_type       = 'deleted'
                observed_sha256  = $null
                expected_sha256  = $expSha
                observed_size    = $null
                expected_size    = $expSize
                event_time       = (Get-Date).ToUniversalTime().ToString('o')
            }) | Out-Null
            _CnLog 'CRITICAL' "canary DELETED: $path"
            continue
        }
        $observedHash = _HashFile $path
        if ($observedHash -and $observedHash -ne $expSha) {
            $info = Get-Item $path -Force -ErrorAction SilentlyContinue
            $trips.Add(@{
                path             = $path
                event_type       = 'modified'
                observed_sha256  = $observedHash
                expected_sha256  = $expSha
                observed_size    = if ($info) { [int64]$info.Length } else { $null }
                expected_size    = $expSize
                event_time       = (Get-Date).ToUniversalTime().ToString('o')
            }) | Out-Null
            _CnLog 'CRITICAL' "canary MODIFIED: $path (was $expSha, now $observedHash)"
        }
    }

    return ,@($trips.ToArray())
}

Export-ModuleMember -Function `
    Initialize-MithrasCanaries, `
    Test-MithrasCanaries
