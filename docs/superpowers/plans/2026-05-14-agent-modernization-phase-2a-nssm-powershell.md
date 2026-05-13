# Agent Modernization — Phase 2a: NSSM-wrapped PowerShell Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy scheduled-task agent with a true Windows service that uses the Phase 1 HMAC enrolment flow and signed auto-update — shipped as a downloadable installer bundle from the platform.

**Architecture:** Three small PowerShell modules (HMAC signing, DPAPI-encrypted local config, HTTP API client) feeding a long-running main loop, wrapped as a Windows service via NSSM. Installer downloads a versioned zip bundle (PS modules + main loop + `nssm.exe`) signed by the platform's Ed25519 key, verifies, extracts to `C:\ProgramData\PeritusSecure\`, and registers the service. Enrolment uses the one-time `enrollment_tokens` flow from Phase 1, not the legacy org-UUID-as-token mechanism.

**Tech Stack:** PowerShell 5.1+ (Windows Defender ships with it), [NSSM](https://nssm.cc/) (Non-Sucking Service Manager — a single 280 KB exe that wraps any script as a true Windows service), DPAPI via `System.Security.Cryptography.ProtectedData`, Pester for PowerShell unit tests, openssl for Ed25519 verification at install time. Deno edge functions for the new `agent-installer` endpoint.

**Branch:** `agent/phase-2a-nssm-powershell` off `agent/phase-1-security-plumbing`.

**Scope reconciliation with design spec:** The design (`2026-05-13-agent-modernization-design.md` §3 Path A) estimated 4 hours. That was the service script alone — this plan also covers the installer bundle pipeline, the new `agent-installer` edge function, the frontend "Agent Download" UX changes, and the integration test on a real Windows endpoint. Realistic: 1-2 working days.

**Realistic limit:** Most tasks need a Windows endpoint for full end-to-end testing. Pester unit tests run on the workstation. Integration testing (install → enrol → heartbeat → version-check) requires a Windows VM. Task 18 provisions a Proxmox Windows test VM; if you already have one, supply hostname/credentials and skip the provisioning step.

---

## File Structure

**Created:**
- `agent/runtime-powershell/lib/HmacAuth.psm1` — HMAC-SHA256 signing matching the Phase 1 TS reference
- `agent/runtime-powershell/lib/SecureConfig.psm1` — DPAPI LocalMachine encryption wrapping `{ agent_id, agent_secret, api_base_url }` at `C:\ProgramData\PeritusSecure\config.dat`
- `agent/runtime-powershell/lib/ApiClient.psm1` — `Invoke-AgentEnroll`, `Invoke-AgentHeartbeat`, `Invoke-AgentVersionCheck`
- `agent/runtime-powershell/peritus-secure-agent.ps1` — service main loop; runs forever, no `Read-Host`
- `agent/runtime-powershell/install-agent.ps1` — registers NSSM service, runs enrolment
- `agent/runtime-powershell/uninstall-agent.ps1` — stops service, removes config + scheduled task remnants
- `agent/runtime-powershell/tests/HmacAuth.Tests.ps1` — Pester tests with vectors from the design contract
- `agent/runtime-powershell/tests/SecureConfig.Tests.ps1` — Pester tests for round-trip encrypt/decrypt
- `agent/runtime-powershell/agent.version` — single line semver string, e.g. `0.2.0`
- `agent/runtime-powershell/vendor/nssm.exe` — vendored NSSM 2.24 (64-bit), committed binary
- `agent/runtime-powershell/vendor/nssm-LICENSE.txt` — NSSM is public domain, document provenance
- `agent/runtime-powershell/README.md` — operator-facing docs
- `supabase/functions/agent-installer/index.ts` — issues one-time enrolment token + zip download URL
- `scripts/phase2a/build-release.sh` — bash script: package into versioned zip, compute sha256, Ed25519-sign with the VM's signing key, upload to platform, register in `agent_versions`
- `scripts/phase2a/deploy-installer-function.sh` — push agent-installer to replica VM

**Modified:**
- `supabase/config.toml` — register `[functions.agent-installer]` with `verify_jwt = false` (browser calls it from the Agent Download page; security comes from short-lived signed tokens)
- `src/pages/AgentDownload.tsx` — add "Modern (Service)" tab showing a one-liner that runs the new installer; keep legacy tab for in-flight rollouts
- `supabase/migrations/<timestamp>_install_tokens.sql` — new table for one-time install bundle download URLs (separate from enrolment_tokens so they have different lifetimes)

**Touched on VM:**
- `/opt/peritus-agent-releases/` — new directory hosting release zips (served by Caddy at `/agent/v0.2.0.zip`)
- `/etc/caddy/Caddyfile` — add `handle /agent/*` block for static release serving

---

## Conventions for this plan

- **Branch + identity:** already configured (`accounts@peritusdigital.com.au` / `Peritus Digital`) — just `git commit` as normal.
- **PowerShell style:** approved verbs only (`Invoke-`, `Get-`, `Set-`, `New-`). One-letter param aliases avoided. PSScriptAnalyzer-clean.
- **Module pattern:** each `.psm1` exports specific functions via `Export-ModuleMember`. No globals.
- **No interactive prompts in the service main loop.** No `Read-Host`, no `Wait-Event`, no `Get-Credential`. If config is missing, the loop logs an error and exits 1 (NSSM restarts it; if it keeps failing, an operator must re-enrol).
- **Bundled NSSM:** committed binary at `agent/runtime-powershell/vendor/nssm.exe`. SHA-256 pinned in the install script.

---

### Task 1: Create the Phase 2a branch

**Files:** (none — git only)

- [ ] **Step 1: Confirm clean state on `agent/phase-1-security-plumbing`**

Run: `git status && git log -1 --format='%H %s'`
Expected: working tree clean, last commit is the CLAUDE.md docs commit.

- [ ] **Step 2: Create branch**

Run: `git checkout -b agent/phase-2a-nssm-powershell`
Expected: `Switched to a new branch 'agent/phase-2a-nssm-powershell'`

---

### Task 2: Scaffold repo structure

**Files:**
- Create: `agent/runtime-powershell/` directory tree (placeholders so subsequent tasks can commit individual files)

- [ ] **Step 1: Create the directory tree + README placeholder**

Run:
```bash
mkdir -p agent/runtime-powershell/lib agent/runtime-powershell/tests agent/runtime-powershell/vendor scripts/phase2a
```

- [ ] **Step 2: Write README.md placeholder**

Write `agent/runtime-powershell/README.md`:

```markdown
# Peritus Secure Agent — PowerShell + NSSM runtime

Phase 2a runtime. Runs as a Windows service under `NT AUTHORITY\SYSTEM`. Authenticates to the Peritus platform via HMAC-SHA256 (see `agent/contracts/hmac-canonicalization.md`).

## Install (operator)

1. Generate an enrolment token in the platform (Agent Download page).
2. Run the one-liner shown there as an Administrator on the target endpoint.

The installer:
- Downloads a signed bundle (sha256 + Ed25519-verified)
- Extracts to `C:\ProgramData\PeritusSecure\`
- Registers the `PeritusSecureAgent` Windows service via NSSM
- POSTs the enrolment token to the platform to receive a per-endpoint `agent_secret`
- Encrypts `{ agent_id, agent_secret, api_base_url }` to `config.dat` via DPAPI (LocalMachine scope)
- Starts the service

## Uninstall

Run `uninstall-agent.ps1` as Administrator. Removes the service, the config file, and (optionally) deactivates the endpoint server-side.

## Layout

- `peritus-secure-agent.ps1` — service main loop
- `lib/HmacAuth.psm1` — request signing
- `lib/SecureConfig.psm1` — DPAPI wrapper
- `lib/ApiClient.psm1` — HTTP client for the agent API
- `tests/` — Pester unit tests
- `vendor/nssm.exe` — Non-Sucking Service Manager 2.24 (public domain)
- `install-agent.ps1` / `uninstall-agent.ps1` — installer scripts
- `agent.version` — semver shipped with this release
```

- [ ] **Step 3: Write agent.version**

Write `agent/runtime-powershell/agent.version` (a single line, no trailing newline):
```
0.2.0
```

- [ ] **Step 4: Commit**

```bash
git add agent/runtime-powershell/README.md agent/runtime-powershell/agent.version
git commit -m "feat(agent): scaffold runtime-powershell directory + 0.2.0 version marker"
```

---

### Task 3: HmacAuth tests (red phase)

**Files:**
- Create: `agent/runtime-powershell/tests/HmacAuth.Tests.ps1`

The test vectors below match those computed from the TS reference (`supabase/functions/_shared/hmac.ts`). Updating either side requires re-pinning both.

- [ ] **Step 1: Confirm Pester is available**

Run: `powershell -NoProfile -Command "Get-Module -ListAvailable Pester | Select-Object Version | Format-Table -HideTableHeaders"`
Expected: at least one version line printed. If Pester is missing, run `powershell -NoProfile -Command "Install-Module -Name Pester -Force -SkipPublisherCheck -Scope CurrentUser"` first.

- [ ] **Step 2: Write the test file**

Write `agent/runtime-powershell/tests/HmacAuth.Tests.ps1`:

```powershell
# Pester v5 tests for HmacAuth.psm1
# Vectors are pinned to match the TypeScript reference at supabase/functions/_shared/hmac.ts

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $moduleRoot 'lib/HmacAuth.psm1') -Force
}

Describe 'ConvertTo-CanonicalJson' {
    It 'sorts object keys lexicographically' {
        $result = ConvertTo-CanonicalJson -Value @{ b = 2; a = 1 }
        $result | Should -Be '{"a":1,"b":2}'
    }

    It 'sorts nested object keys recursively' {
        $obj = [ordered]@{ a = [ordered]@{ d = 4; c = 3 }; b = 2 }
        $result = ConvertTo-CanonicalJson -Value $obj
        $result | Should -Be '{"a":{"c":3,"d":4},"b":2}'
    }

    It 'preserves array order' {
        $result = ConvertTo-CanonicalJson -Value @(3, 1, 2)
        $result | Should -Be '[3,1,2]'
    }

    It 'handles null, true, false, numbers, strings' {
        $obj = [ordered]@{ a = $null; b = $true; c = 1.5; d = 'x' }
        $result = ConvertTo-CanonicalJson -Value $obj
        $result | Should -Be '{"a":null,"b":true,"c":1.5,"d":"x"}'
    }

    It 'escapes special characters in strings the same way as JSON.stringify' {
        $result = ConvertTo-CanonicalJson -Value @{ msg = "line1`nline2`t`"quoted`"" }
        $result | Should -Be '{"msg":"line1\nline2\t\"quoted\""}'
    }
}

Describe 'Get-HmacSignature (matches TS reference)' {
    It 'POST /x 1700000000 {} produces the pinned vector' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $sig | Should -Be '8092321aacd5e0ffccd69c7049fd0b4a901f1a7553d64cf76343fa6e5e9a2fe4'
    }

    It 'GET /agent-version-check 1700000000 (empty body) produces the pinned vector' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'GET' -Path '/agent-version-check' -Timestamp '1700000000' -RawBody ''
        $sig | Should -Be '0e288af0dd8480d457a81f4982a7a37368744e8432ff297425498e659a9c8794'
    }

    It 'POST /agent-heartbeat 1700000000 {"a":1} produces the pinned vector' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/agent-heartbeat' -Timestamp '1700000000' -RawBody '{"a":1}'
        $sig | Should -Be 'ab14daa3fb5f1a77692df95d70ab3a27d3ec1991027dc89321816b74471dab2f'
    }

    It 'uppercases the method' {
        $a = Get-HmacSignature -Secret 'secret' -Method 'post' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $b = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $a | Should -Be $b
    }

    It 'produces 64-character lowercase hex' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $sig.Length | Should -Be 64
        $sig | Should -Match '^[0-9a-f]{64}$'
    }

    It 'is deterministic — same input produces same output' {
        $a = Get-HmacSignature -Secret 'k' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $b = Get-HmacSignature -Secret 'k' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $a | Should -Be $b
    }

    It 'changes when any field changes' {
        $base = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $diffSecret = Get-HmacSignature -Secret 's2' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $diffMethod = Get-HmacSignature -Secret 's' -Method 'GET' -Path '/p' -Timestamp '1' -RawBody 'b'
        $diffPath = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p2' -Timestamp '1' -RawBody 'b'
        $diffTs = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p' -Timestamp '2' -RawBody 'b'
        $diffBody = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b2'
        @($base, $diffSecret, $diffMethod, $diffPath, $diffTs, $diffBody) | Sort-Object -Unique | Measure-Object | Select-Object -ExpandProperty Count | Should -Be 6
    }
}

Describe 'New-HmacRequestHeaders' {
    It 'returns a hashtable with the three required headers' {
        $headers = New-HmacRequestHeaders -AgentId '11111111-1111-1111-1111-111111111111' -Secret 'k' -Method 'POST' -Path '/p' -RawBody '{}'
        $headers.Keys | Should -Contain 'X-Agent-Id'
        $headers.Keys | Should -Contain 'X-Timestamp'
        $headers.Keys | Should -Contain 'X-Signature'
        $headers['X-Agent-Id'] | Should -Be '11111111-1111-1111-1111-111111111111'
        $headers['X-Signature'].Length | Should -Be 64
    }

    It 'X-Timestamp is an integer string within 60 seconds of now' {
        $headers = New-HmacRequestHeaders -AgentId 'x' -Secret 'k' -Method 'POST' -Path '/p' -RawBody '{}'
        $ts = [long]$headers['X-Timestamp']
        $now = [long](Get-Date -UFormat %s)
        [Math]::Abs($now - $ts) | Should -BeLessOrEqual 60
    }
}
```

- [ ] **Step 3: Run tests — should fail because the module doesn't exist yet**

Run:
```powershell
powershell -NoProfile -Command "Invoke-Pester -Path agent/runtime-powershell/tests/HmacAuth.Tests.ps1 -Output Detailed"
```
Expected: All tests fail; the error mentions `HmacAuth.psm1` not found.

- [ ] **Step 4: Commit**

```bash
git add agent/runtime-powershell/tests/HmacAuth.Tests.ps1
git commit -m "test(agent): pin Pester vectors for HmacAuth — match TS reference"
```

---

### Task 4: HmacAuth implementation (green phase)

**Files:**
- Create: `agent/runtime-powershell/lib/HmacAuth.psm1`

- [ ] **Step 1: Write the module**

Write `agent/runtime-powershell/lib/HmacAuth.psm1`:

```powershell
# HmacAuth.psm1 — request signing for Peritus Secure Agent
# Matches supabase/functions/_shared/hmac.ts byte-for-byte. See agent/contracts/hmac-canonicalization.md.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-CanonicalJson {
    [CmdletBinding()]
    param([Parameter(Mandatory, Position = 0)]$Value)

    if ($null -eq $Value) { return 'null' }

    if ($Value -is [bool]) { return $(if ($Value) { 'true' } else { 'false' }) }

    if ($Value -is [int] -or $Value -is [long] -or $Value -is [short] -or $Value -is [byte] -or $Value -is [sbyte]) {
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
```

- [ ] **Step 2: Run tests — should pass**

Run:
```powershell
powershell -NoProfile -Command "Invoke-Pester -Path agent/runtime-powershell/tests/HmacAuth.Tests.ps1 -Output Detailed"
```
Expected: All tests pass (Total: 11, Failed: 0).

- [ ] **Step 3: Commit**

```bash
git add agent/runtime-powershell/lib/HmacAuth.psm1
git commit -m "feat(agent): HmacAuth.psm1 — HMAC-SHA256 signing parity with TS reference"
```

---

### Task 5: SecureConfig tests (red phase)

**Files:**
- Create: `agent/runtime-powershell/tests/SecureConfig.Tests.ps1`

- [ ] **Step 1: Write the test file**

Write `agent/runtime-powershell/tests/SecureConfig.Tests.ps1`:

```powershell
# Pester v5 tests for SecureConfig.psm1
# DPAPI-encrypted JSON config round-trip tests.

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $moduleRoot 'lib/SecureConfig.psm1') -Force
    $script:testPath = Join-Path $env:TEMP "peritus-test-config-$([Guid]::NewGuid()).dat"
}

AfterEach {
    if (Test-Path $script:testPath) { Remove-Item $script:testPath -Force }
}

Describe 'Save-SecureConfig / Read-SecureConfig' {
    It 'round-trips a simple object' {
        $cfg = @{ agent_id = 'abc-123'; agent_secret = 'shhh'; api_base_url = 'https://api.example.com' }
        Save-SecureConfig -Path $script:testPath -Config $cfg
        $loaded = Read-SecureConfig -Path $script:testPath
        $loaded.agent_id      | Should -Be 'abc-123'
        $loaded.agent_secret  | Should -Be 'shhh'
        $loaded.api_base_url  | Should -Be 'https://api.example.com'
    }

    It 'writes a file that is NOT plaintext JSON' {
        Save-SecureConfig -Path $script:testPath -Config @{ x = 'plaintext-value' }
        $raw = [System.IO.File]::ReadAllText($script:testPath)
        $raw | Should -Not -Match 'plaintext-value'
    }

    It 'overwrites cleanly when called twice' {
        Save-SecureConfig -Path $script:testPath -Config @{ v = 1 }
        Save-SecureConfig -Path $script:testPath -Config @{ v = 2 }
        $loaded = Read-SecureConfig -Path $script:testPath
        $loaded.v | Should -Be 2
    }

    It 'restricts file ACL to SYSTEM and Administrators' {
        Save-SecureConfig -Path $script:testPath -Config @{ x = 1 }
        $acl = Get-Acl -Path $script:testPath
        $identities = $acl.Access | ForEach-Object { $_.IdentityReference.Value }
        # Either SYSTEM or BUILTIN\Administrators must be present, and Users/Everyone must NOT be
        ($identities -join ' ') | Should -Match '(SYSTEM|Administrators)'
        $identities | Where-Object { $_ -match '(Users|Everyone|Authenticated Users)' } | Should -BeNullOrEmpty
    }

    It 'Read-SecureConfig throws on missing file' {
        $missing = Join-Path $env:TEMP "missing-$([Guid]::NewGuid()).dat"
        { Read-SecureConfig -Path $missing } | Should -Throw
    }
}

Describe 'Test-SecureConfigExists' {
    It 'returns false for a missing file' {
        $missing = Join-Path $env:TEMP "missing-$([Guid]::NewGuid()).dat"
        Test-SecureConfigExists -Path $missing | Should -BeFalse
    }

    It 'returns true after save' {
        Save-SecureConfig -Path $script:testPath -Config @{ x = 1 }
        Test-SecureConfigExists -Path $script:testPath | Should -BeTrue
    }
}
```

- [ ] **Step 2: Run tests — should fail**

Run:
```powershell
powershell -NoProfile -Command "Invoke-Pester -Path agent/runtime-powershell/tests/SecureConfig.Tests.ps1 -Output Detailed"
```
Expected: All tests fail because `SecureConfig.psm1` doesn't exist.

- [ ] **Step 3: Commit**

```bash
git add agent/runtime-powershell/tests/SecureConfig.Tests.ps1
git commit -m "test(agent): SecureConfig DPAPI round-trip + ACL tests"
```

---

### Task 6: SecureConfig implementation (green phase)

**Files:**
- Create: `agent/runtime-powershell/lib/SecureConfig.psm1`

- [ ] **Step 1: Write the module**

Write `agent/runtime-powershell/lib/SecureConfig.psm1`:

```powershell
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
    $rules = @(
        New-Object System.Security.AccessControl.FileSystemAccessRule(
            'NT AUTHORITY\SYSTEM', 'FullControl', 'Allow'),
        New-Object System.Security.AccessControl.FileSystemAccessRule(
            'BUILTIN\Administrators', 'FullControl', 'Allow')
    )
    foreach ($r in $rules) { $acl.AddAccessRule($r) }
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
```

- [ ] **Step 2: Run tests — should pass when run as Administrator**

Run (in an elevated PowerShell session — DPAPI LocalMachine scope needs admin):
```powershell
powershell -NoProfile -Command "Invoke-Pester -Path agent/runtime-powershell/tests/SecureConfig.Tests.ps1 -Output Detailed"
```
Expected: All tests pass (Total: 7, Failed: 0).

**Note:** If you see `System.Security.Cryptography.CryptographicException` errors, you're running non-elevated. The DPAPI LocalMachine scope requires Administrator. Re-launch PowerShell as Admin and retry.

- [ ] **Step 3: Commit**

```bash
git add agent/runtime-powershell/lib/SecureConfig.psm1
git commit -m "feat(agent): SecureConfig.psm1 — DPAPI LocalMachine config encryption + ACL lockdown"
```

---

### Task 7: ApiClient module

**Files:**
- Create: `agent/runtime-powershell/lib/ApiClient.psm1`

This module is thin — it wraps `Invoke-RestMethod` and adds the HMAC headers via the HmacAuth module. No tests at this stage; integration testing happens in Task 17 against the live platform.

- [ ] **Step 1: Write the module**

Write `agent/runtime-powershell/lib/ApiClient.psm1`:

```powershell
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
        [Parameter()][ValidateSet('powershell','dotnet')][string]$Runtime = 'powershell'
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
        [Parameter()][ValidateSet('powershell','dotnet')][string]$Runtime = 'powershell'
    )

    $headers = New-HmacRequestHeaders -AgentId $AgentId -Secret $AgentSecret -Method 'GET' -Path '/agent-version-check' -RawBody ''
    $url = "$ApiBaseUrl/functions/v1/agent-version-check?current=$CurrentVersion&runtime=$Runtime"

    # 204 means no version published — Invoke-RestMethod throws on empty bodies, so use Invoke-WebRequest
    $resp = Invoke-WebRequest -Uri $url -Method Get -Headers $headers -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 204) { return $null }
    if ($resp.Content) { return $resp.Content | ConvertFrom-Json }
    return $null
}

Export-ModuleMember -Function Invoke-AgentEnroll, Invoke-AgentHeartbeat, Invoke-AgentVersionCheck
```

- [ ] **Step 2: Commit**

```bash
git add agent/runtime-powershell/lib/ApiClient.psm1
git commit -m "feat(agent): ApiClient.psm1 — HMAC-authenticated wrappers for agent-enroll / heartbeat / version-check"
```

---

### Task 8: Service main loop

**Files:**
- Create: `agent/runtime-powershell/peritus-secure-agent.ps1`

The main loop is intentionally minimal. Phase 2a only proves the service plumbing — heartbeat + version-check + log forwarding stays mostly stubbed. Phase 3 (Realtime) adds command execution, Phase 4 adds full event-log forwarding.

- [ ] **Step 1: Write the script**

Write `agent/runtime-powershell/peritus-secure-agent.ps1`:

```powershell
# peritus-secure-agent.ps1 — Phase 2a service main loop.
# Runs as NT AUTHORITY\SYSTEM under NSSM. No interactive prompts.
#
# Behaviour:
#   1. Read DPAPI-encrypted config (agent_id, agent_secret, api_base_url) from $ConfigFile.
#   2. Loop:
#       a. Heartbeat — POST /agent-heartbeat with current OS / Defender / agent version metadata.
#       b. Every 10 heartbeats, GET /agent-version-check.
#       c. Sleep HEARTBEAT_INTERVAL_SECONDS.
#   3. If config is missing, log critical event and exit 1 — NSSM restarts via exponential backoff.

[CmdletBinding()]
param(
    [int]$HeartbeatIntervalSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Paths
$script:AgentRoot   = 'C:\ProgramData\PeritusSecure'
$script:ConfigFile  = Join-Path $script:AgentRoot 'config.dat'
$script:LogDir      = Join-Path $script:AgentRoot 'logs'
$script:InstallRoot = Join-Path $script:AgentRoot 'install'
$script:AgentVersion = (Get-Content (Join-Path $PSScriptRoot 'agent.version') -Raw).Trim()

# Modules
Import-Module (Join-Path $PSScriptRoot 'lib/HmacAuth.psm1')    -Force
Import-Module (Join-Path $PSScriptRoot 'lib/SecureConfig.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'lib/ApiClient.psm1')    -Force

# Logging — file + Windows Event Log
$script:EventSource = 'Peritus Secure Agent'
function Write-AgentLog {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('Info','Warn','Error','Critical')][string]$Level = 'Info'
    )
    $ts = (Get-Date).ToString('o')
    $line = "[$ts] [$Level] $Message"
    Write-Host $line

    if (-not (Test-Path $script:LogDir)) {
        New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null
    }
    $logFile = Join-Path $script:LogDir ("agent-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
    Add-Content -Path $logFile -Value $line -Encoding UTF8

    # Event Log — best-effort
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists($script:EventSource)) {
            [System.Diagnostics.EventLog]::CreateEventSource($script:EventSource, 'Application')
        }
        $entryType = switch ($Level) { 'Info' { 'Information' } 'Warn' { 'Warning' } default { 'Error' } }
        [System.Diagnostics.EventLog]::WriteEntry($script:EventSource, $Message, $entryType)
    } catch {
        # If event source creation fails (non-admin context), fall back silently to file logging only.
    }
}

# --------------------------------------------------------------------------
# Startup
# --------------------------------------------------------------------------

Write-AgentLog "Peritus Secure Agent v$script:AgentVersion starting"

if (-not (Test-SecureConfigExists -Path $script:ConfigFile)) {
    Write-AgentLog -Level Critical "Config file not found at $script:ConfigFile — agent has not been enrolled. Exiting."
    exit 1
}

try {
    $cfg = Read-SecureConfig -Path $script:ConfigFile
} catch {
    Write-AgentLog -Level Critical "Failed to read config: $_. Exiting."
    exit 1
}

foreach ($k in @('agent_id','agent_secret','api_base_url')) {
    if (-not $cfg.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($cfg[$k])) {
        Write-AgentLog -Level Critical "Config is missing required key '$k'. Exiting."
        exit 1
    }
}

$script:AgentId    = $cfg['agent_id']
$script:AgentSecret = $cfg['agent_secret']
$script:ApiBaseUrl = $cfg['api_base_url'].TrimEnd('/')

Write-AgentLog "Enrolled agent_id=$script:AgentId api=$script:ApiBaseUrl"

# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------

$iteration = 0
$versionCheckEvery = 10

while ($true) {
    $iteration++

    # Heartbeat
    try {
        $defenderStatus = $null
        try { $defenderStatus = Get-MpComputerStatus -ErrorAction Stop } catch {}
        $payload = @{
            agent_version    = $script:AgentVersion
            os_version       = (Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
            os_build         = [string](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue).BuildNumber
            defender_version = if ($defenderStatus) { [string]$defenderStatus.AMEngineVersion } else { $null }
        }
        $resp = Invoke-AgentHeartbeat -ApiBaseUrl $script:ApiBaseUrl -AgentId $script:AgentId -AgentSecret $script:AgentSecret -Payload $payload
        Write-AgentLog "Heartbeat OK — next_check_in=$($resp.next_check_in)s, commands=$($resp.commands.Count)"
    } catch {
        Write-AgentLog -Level Warn "Heartbeat failed: $_"
    }

    # Periodic version check
    if (($iteration % $versionCheckEvery) -eq 0) {
        try {
            $latest = Invoke-AgentVersionCheck -ApiBaseUrl $script:ApiBaseUrl -AgentId $script:AgentId -AgentSecret $script:AgentSecret -CurrentVersion $script:AgentVersion
            if ($latest -and $latest.update_available) {
                Write-AgentLog "Update available: $($latest.latest) (current $script:AgentVersion). Auto-update not yet implemented."
                # Phase 2a does NOT auto-install updates. Phase 2b (or a follow-up task) handles signed-binary download + verify + swap.
            }
        } catch {
            Write-AgentLog -Level Warn "Version check failed: $_"
        }
    }

    Start-Sleep -Seconds $HeartbeatIntervalSeconds
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/runtime-powershell/peritus-secure-agent.ps1
git commit -m "feat(agent): service main loop — heartbeat + periodic version-check, NSSM-friendly"
```

---

### Task 9: Vendor NSSM 2.24

**Files:**
- Create: `agent/runtime-powershell/vendor/nssm.exe` (committed binary, 64-bit)
- Create: `agent/runtime-powershell/vendor/nssm-LICENSE.txt`
- Create: `agent/runtime-powershell/vendor/nssm.sha256`

NSSM is public domain. We vendor the 64-bit binary from the official release 2.24.

- [ ] **Step 1: Download NSSM 2.24 to the workstation**

Run (in PowerShell):
```powershell
$tempZip = "$env:TEMP\nssm-2.24.zip"
Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $tempZip
$expected = '52bcf02f9efe5a7cf960d83ca6e0a637fe9bdbfb900886e2fc5876d83d36c2bf'
$actual = (Get-FileHash -Path $tempZip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw "NSSM download checksum mismatch! Got $actual, expected $expected" }
Expand-Archive -Path $tempZip -DestinationPath "$env:TEMP\nssm-extract" -Force
Copy-Item "$env:TEMP\nssm-extract\nssm-2.24\win64\nssm.exe" "agent\runtime-powershell\vendor\nssm.exe"
Copy-Item "$env:TEMP\nssm-extract\nssm-2.24\README.txt" "agent\runtime-powershell\vendor\nssm-LICENSE.txt"
(Get-FileHash 'agent\runtime-powershell\vendor\nssm.exe' -Algorithm SHA256).Hash.ToLower() | Set-Content 'agent\runtime-powershell\vendor\nssm.sha256' -NoNewline
```

Expected: `nssm.exe` (~280 KB), `nssm-LICENSE.txt` (~3 KB), `nssm.sha256` (single 64-char hex line).

- [ ] **Step 2: Verify the SHA256 file**

Run: `cat agent/runtime-powershell/vendor/nssm.sha256`
Expected: a single 64-char lowercase hex string.

- [ ] **Step 3: Commit**

```bash
git add agent/runtime-powershell/vendor/nssm.exe agent/runtime-powershell/vendor/nssm-LICENSE.txt agent/runtime-powershell/vendor/nssm.sha256
git commit -m "build(agent): vendor NSSM 2.24 (64-bit) + license + sha256 manifest"
```

---

### Task 10: install-agent.ps1

**Files:**
- Create: `agent/runtime-powershell/install-agent.ps1`

- [ ] **Step 1: Write the installer**

Write `agent/runtime-powershell/install-agent.ps1`:

```powershell
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install the Peritus Secure Agent as a Windows service.
.DESCRIPTION
    1. Copies agent files to C:\ProgramData\PeritusSecure\install
    2. Runs enrolment against the platform to obtain agent_id + agent_secret
    3. Saves credentials to DPAPI-encrypted config.dat
    4. Registers the Windows service "PeritusSecureAgent" via NSSM
    5. Starts the service
.PARAMETER EnrollmentToken
    One-time token generated in the platform's Agent Download page.
.PARAMETER ApiBaseUrl
    Base URL of the Peritus platform, e.g. https://api.cmwcollective.com.au
.PARAMETER ServiceName
    Optional override for the service name. Default: PeritusSecureAgent
.PARAMETER Force
    Re-install over an existing service installation.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnrollmentToken,
    [Parameter(Mandatory)][string]$ApiBaseUrl,
    [string]$ServiceName = 'PeritusSecureAgent',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AgentRoot   = 'C:\ProgramData\PeritusSecure'
$InstallRoot = Join-Path $AgentRoot 'install'
$ConfigFile  = Join-Path $AgentRoot 'config.dat'
$NssmExe     = Join-Path $InstallRoot 'vendor\nssm.exe'

function Write-Step { param([string]$Msg) Write-Host "[install] $Msg" }

# 1. Refuse to clobber an existing install unless -Force
if ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and -not $Force) {
    throw "Service '$ServiceName' already exists. Re-run with -Force to reinstall."
}

# 2. Stop / remove old service if present
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Step "Stopping existing service"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
}

# 3. Copy files
Write-Step "Staging files at $InstallRoot"
if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $InstallRoot -Recurse -Force -Exclude 'install-agent.ps1','uninstall-agent.ps1','tests'

# Self-copy the installer so we can call uninstall from the install dir
Copy-Item -Path (Join-Path $PSScriptRoot 'uninstall-agent.ps1') -Destination $InstallRoot -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $NssmExe)) { throw "Bundle is missing nssm.exe at $NssmExe" }

# 4. Import modules from the staged location for enrolment
Import-Module (Join-Path $InstallRoot 'lib/HmacAuth.psm1')    -Force
Import-Module (Join-Path $InstallRoot 'lib/SecureConfig.psm1') -Force
Import-Module (Join-Path $InstallRoot 'lib/ApiClient.psm1')    -Force

# 5. Enrol — exchange the one-time token for { agent_id, agent_secret }
Write-Step "Enrolling at $ApiBaseUrl"
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$enrollResp = Invoke-AgentEnroll `
    -ApiBaseUrl $ApiBaseUrl `
    -EnrollmentToken $EnrollmentToken `
    -Hostname $env:COMPUTERNAME `
    -OsVersion $os.Caption `
    -OsBuild $os.BuildNumber `
    -Runtime 'powershell'

if (-not $enrollResp.agent_id -or -not $enrollResp.agent_secret) {
    throw "Enrolment response missing agent_id or agent_secret"
}
Write-Step "Enrolled — agent_id=$($enrollResp.agent_id)"

# 6. Persist config via DPAPI
$cfg = @{
    agent_id      = $enrollResp.agent_id
    agent_secret  = $enrollResp.agent_secret
    api_base_url  = $enrollResp.api_base_url
}
Save-SecureConfig -Path $ConfigFile -Config $cfg
Write-Step "Wrote DPAPI-encrypted config at $ConfigFile"

# 7. Register the NSSM service
$pwsh   = (Get-Command powershell.exe -ErrorAction Stop).Path
$script = Join-Path $InstallRoot 'peritus-secure-agent.ps1'

Write-Step "Registering service '$ServiceName' via NSSM"
& $NssmExe install $ServiceName $pwsh '-NoProfile' '-NonInteractive' '-ExecutionPolicy' 'Bypass' '-File' $script | Out-Null
& $NssmExe set $ServiceName Description 'Peritus Secure Agent — endpoint security telemetry' | Out-Null
& $NssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $NssmExe set $ServiceName ObjectName 'LocalSystem' | Out-Null
& $NssmExe set $ServiceName AppStdout (Join-Path $AgentRoot 'logs\nssm-stdout.log') | Out-Null
& $NssmExe set $ServiceName AppStderr (Join-Path $AgentRoot 'logs\nssm-stderr.log') | Out-Null
& $NssmExe set $ServiceName AppRotateFiles 1 | Out-Null
& $NssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null
& $NssmExe set $ServiceName AppExit Default Restart | Out-Null
& $NssmExe set $ServiceName AppRestartDelay 5000 | Out-Null

# 8. Start it
Write-Step "Starting service"
Start-Service -Name $ServiceName

Start-Sleep -Seconds 2
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') {
    throw "Service did not reach Running state (got $($svc.Status)). Check $AgentRoot\logs\nssm-stderr.log"
}

Write-Step "Done. Service '$ServiceName' is Running."
Write-Step "Logs: $AgentRoot\logs\"
```

- [ ] **Step 2: Commit**

```bash
git add agent/runtime-powershell/install-agent.ps1
git commit -m "feat(agent): install-agent.ps1 — enrol + DPAPI + NSSM service registration"
```

---

### Task 11: uninstall-agent.ps1

**Files:**
- Create: `agent/runtime-powershell/uninstall-agent.ps1`

- [ ] **Step 1: Write the uninstaller**

Write `agent/runtime-powershell/uninstall-agent.ps1`:

```powershell
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Remove the Peritus Secure Agent from this machine.
.DESCRIPTION
    Stops and removes the Windows service, deletes installed files, removes the DPAPI config.
    Optionally also removes the legacy scheduled task "PeritusSecureAgent" if present.
.PARAMETER KeepLogs
    Preserve log files at C:\ProgramData\PeritusSecure\logs\ for forensics.
.PARAMETER ServiceName
    Optional override for the service name. Default: PeritusSecureAgent
#>
[CmdletBinding()]
param(
    [string]$ServiceName = 'PeritusSecureAgent',
    [switch]$KeepLogs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$AgentRoot   = 'C:\ProgramData\PeritusSecure'
$InstallRoot = Join-Path $AgentRoot 'install'
$LogDir      = Join-Path $AgentRoot 'logs'
$NssmExe     = Join-Path $InstallRoot 'vendor\nssm.exe'

function Write-Step { param([string]$Msg) Write-Host "[uninstall] $Msg" }

# 1. Stop and remove the service via NSSM (preferred) or sc.exe (fallback)
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Step "Stopping service '$ServiceName'"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue

    if (Test-Path $NssmExe) {
        Write-Step "Removing service via NSSM"
        & $NssmExe remove $ServiceName confirm | Out-Null
    } else {
        Write-Step "Removing service via sc.exe"
        & sc.exe delete $ServiceName | Out-Null
    }
} else {
    Write-Step "Service '$ServiceName' not present, skipping"
}

# 2. Remove legacy scheduled task if it exists
$legacyTask = Get-ScheduledTask -TaskName 'PeritusSecureAgent' -ErrorAction SilentlyContinue
if ($legacyTask) {
    Write-Step "Removing legacy scheduled task"
    Unregister-ScheduledTask -TaskName 'PeritusSecureAgent' -Confirm:$false
}

# 3. Remove files
if (Test-Path $InstallRoot) {
    Write-Step "Removing $InstallRoot"
    Remove-Item -Path $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$configFile = Join-Path $AgentRoot 'config.dat'
if (Test-Path $configFile) {
    Write-Step "Removing DPAPI config"
    Remove-Item -Path $configFile -Force -ErrorAction SilentlyContinue
}

if (-not $KeepLogs -and (Test-Path $LogDir)) {
    Write-Step "Removing logs"
    Remove-Item -Path $LogDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove the AgentRoot directory if it's now empty
if ((Test-Path $AgentRoot) -and -not (Get-ChildItem $AgentRoot -Force)) {
    Remove-Item -Path $AgentRoot -Force -ErrorAction SilentlyContinue
}

Write-Step "Done."
```

- [ ] **Step 2: Commit**

```bash
git add agent/runtime-powershell/uninstall-agent.ps1
git commit -m "feat(agent): uninstall-agent.ps1 — service removal + cleanup"
```

---

### Task 12: Release build script

**Files:**
- Create: `scripts/phase2a/build-release.sh`

- [ ] **Step 1: Write the script**

Write `scripts/phase2a/build-release.sh`:

```bash
#!/usr/bin/env bash
# Build a release zip of the Phase 2a PowerShell agent and Ed25519-sign it.
# Output:
#   dist/peritus-secure-agent-<version>.zip
#   dist/peritus-secure-agent-<version>.sha256
#   dist/peritus-secure-agent-<version>.sig    (base64 Ed25519 over the sha256)
#
# Usage:
#   bash scripts/phase2a/build-release.sh                          # builds with version from agent.version
#   bash scripts/phase2a/build-release.sh /etc/peritus-supabase/agent-signing.pem   # sign on the VM
#
# The signing key MUST be the same one whose public key lives at
# agent/contracts/agent-signing-public.pem. Phase 1 provisioned this.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
AGENT_DIR="$REPO_ROOT/agent/runtime-powershell"
VERSION=$(cat "$AGENT_DIR/agent.version" | tr -d '[:space:]')
DIST="$REPO_ROOT/dist"
SIGNING_KEY=${1:-}

if [ -z "$VERSION" ]; then
    echo "FATAL: agent.version is empty"
    exit 1
fi

mkdir -p "$DIST"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "Building peritus-secure-agent-$VERSION.zip"

# Copy everything the runtime needs, excluding tests
cp -r "$AGENT_DIR/lib"           "$STAGE/lib"
cp -r "$AGENT_DIR/vendor"        "$STAGE/vendor"
cp    "$AGENT_DIR/peritus-secure-agent.ps1" "$STAGE/"
cp    "$AGENT_DIR/install-agent.ps1"        "$STAGE/"
cp    "$AGENT_DIR/uninstall-agent.ps1"      "$STAGE/"
cp    "$AGENT_DIR/agent.version"            "$STAGE/"
cp    "$AGENT_DIR/README.md"                "$STAGE/"

ZIP="$DIST/peritus-secure-agent-$VERSION.zip"
rm -f "$ZIP"
(cd "$STAGE" && zip -rq "$ZIP" .)
echo "  $(stat -c%s "$ZIP" 2>/dev/null || stat -f%z "$ZIP") bytes"

SHA=$(sha256sum "$ZIP" | awk '{print $1}')
echo "$SHA  peritus-secure-agent-$VERSION.zip" > "$DIST/peritus-secure-agent-$VERSION.sha256"
echo "  sha256: $SHA"

if [ -n "$SIGNING_KEY" ]; then
    if [ ! -r "$SIGNING_KEY" ]; then
        echo "FATAL: signing key not readable at $SIGNING_KEY"
        exit 1
    fi
    # Ed25519 signs raw bytes — we sign the SHA-256 digest (binary).
    SIG_B64=$(printf '%s' "$SHA" | xxd -r -p | openssl pkeyutl -sign -inkey "$SIGNING_KEY" -rawin | base64 -w0)
    echo "$SIG_B64" > "$DIST/peritus-secure-agent-$VERSION.sig"
    echo "  signature: ${SIG_B64:0:32}..."

    # Verify locally using the committed public key
    PUBKEY="$REPO_ROOT/agent/contracts/agent-signing-public.pem"
    if [ -r "$PUBKEY" ]; then
        printf '%s' "$SHA" | xxd -r -p > "$STAGE/digest.bin"
        printf '%s' "$SIG_B64" | base64 -d > "$STAGE/sig.bin"
        if openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$STAGE/digest.bin" -sigfile "$STAGE/sig.bin" >/dev/null 2>&1; then
            echo "  signature verifies against committed public key ✓"
        else
            echo "FATAL: signature does NOT verify against committed public key"
            exit 1
        fi
    fi
else
    echo "  (no signing key provided — skipping Ed25519 signature)"
fi

echo "Done. Artifacts in $DIST/"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/phase2a/build-release.sh
git add scripts/phase2a/build-release.sh
git commit -m "build(agent): phase 2a release zip + sha256 + Ed25519 signature pipeline"
```

---

### Task 13: Build the 0.2.0 release locally

**Files:** (none — produces `dist/` artifacts that we gitignore)

- [ ] **Step 1: Append to `.gitignore`**

Append (if not already present) to `.gitignore`:
```
# Release artifacts
/dist/
```

- [ ] **Step 2: Build the release without signing first to validate the script**

Run: `bash scripts/phase2a/build-release.sh`
Expected output ends with `Done. Artifacts in <repo>/dist/`. Confirm:
- `dist/peritus-secure-agent-0.2.0.zip` exists
- `dist/peritus-secure-agent-0.2.0.sha256` exists, contains a 64-char hex + filename

- [ ] **Step 3: Copy the zip to the VM, sign there using the real key**

Run:
```bash
REPO=$(git rev-parse --show-toplevel)
scp -i ~/.ssh/id_ed25519 "$REPO/dist/peritus-secure-agent-0.2.0.zip" itadmin@192.168.99.143:/tmp/
ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'sudo mkdir -p /opt/peritus-agent-releases && sudo mv /tmp/peritus-secure-agent-0.2.0.zip /opt/peritus-agent-releases/ && sudo chmod 644 /opt/peritus-agent-releases/peritus-secure-agent-0.2.0.zip'

# Compute sha + sign using the VM's private key
ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'cd /opt/peritus-agent-releases && SHA=$(sudo sha256sum peritus-secure-agent-0.2.0.zip | awk "{print \$1}") && echo "sha256=$SHA" && sudo bash -c "printf %s \"$SHA\" | xxd -r -p | openssl pkeyutl -sign -inkey /etc/peritus-supabase/agent-signing.pem -rawin > peritus-secure-agent-0.2.0.sig" && sudo chmod 644 peritus-secure-agent-0.2.0.sig && echo "  sig: $(base64 -w0 peritus-secure-agent-0.2.0.sig | head -c 32)..."'
```

Expected: prints the sha256 and the first 32 chars of the base64 signature.

- [ ] **Step 4: Register the release in `agent_versions`**

Run:
```bash
SHA=$(ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'sudo sha256sum /opt/peritus-agent-releases/peritus-secure-agent-0.2.0.zip | awk "{print \$1}"')
SIG_B64=$(ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'sudo base64 -w0 /opt/peritus-agent-releases/peritus-secure-agent-0.2.0.sig')
ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T db psql -U postgres -d postgres -c \"INSERT INTO public.agent_versions (version, runtime, channel, download_url, sha256, ed25519_sig, is_active) VALUES ('0.2.0', 'powershell', 'stable', 'https://api.cmwcollective.com.au/agent/peritus-secure-agent-0.2.0.zip', '$SHA', '$SIG_B64', true) ON CONFLICT (version, runtime, channel) DO UPDATE SET sha256=EXCLUDED.sha256, ed25519_sig=EXCLUDED.ed25519_sig, download_url=EXCLUDED.download_url, is_active=true\""
```

Expected: `INSERT 0 1` (or `UPDATE 1` on re-run).

- [ ] **Step 5: Commit the .gitignore change**

```bash
git add .gitignore
git commit -m "build: gitignore /dist release artifacts"
```

---

### Task 14: Caddy serves /agent/* static releases

**Files:**
- Modify: `/etc/caddy/Caddyfile` on the VM (not in repo — capture the change in a script)
- Create: `scripts/phase2a/update-caddyfile.sh`

- [ ] **Step 1: Write the script**

Write `scripts/phase2a/update-caddyfile.sh`:

```bash
#!/usr/bin/env bash
# Add /agent/* file-server route to the api.cmwcollective.com.au vhost.
# Idempotent: re-running won't duplicate.
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
CADDYFILE=/etc/caddy/Caddyfile
TMP=$(mktemp)
sudo cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%s)"

# Insert the handler if not already present
if sudo grep -q 'handle /agent/\*' "$CADDYFILE"; then
    echo "/agent/* handler already present"
else
    sudo awk '
    /http:\/\/api\.cmwcollective\.com\.au:80 \{/ {
        print
        print "    handle /agent/* {"
        print "        root * /opt/peritus-agent-releases"
        print "        uri strip_prefix /agent"
        print "        file_server"
        print "    }"
        next
    }
    { print }
    ' "$CADDYFILE" | sudo tee "$TMP" >/dev/null
    sudo mv "$TMP" "$CADDYFILE"
    echo "Added /agent/* handler"
fi

# Also add for apidev.peritusdigital.com.au (replica name)
if sudo grep -q 'apidev.peritusdigital.com.au' "$CADDYFILE" && ! sudo awk '/apidev.peritusdigital.com.au/,/^}/' "$CADDYFILE" | grep -q 'handle /agent'; then
    sudo awk '
    /http:\/\/apidev\.peritusdigital\.com\.au:80 \{/ {
        print
        print "    handle /agent/* {"
        print "        root * /opt/peritus-agent-releases"
        print "        uri strip_prefix /agent"
        print "        file_server"
        print "    }"
        next
    }
    { print }
    ' "$CADDYFILE" | sudo tee "$TMP" >/dev/null
    sudo mv "$TMP" "$CADDYFILE"
    echo "Also added /agent/* handler to apidev.peritusdigital.com.au"
fi

sudo caddy validate --config "$CADDYFILE"
sudo systemctl reload caddy
REMOTE
```

- [ ] **Step 2: Run it**

```bash
chmod +x scripts/phase2a/update-caddyfile.sh
bash scripts/phase2a/update-caddyfile.sh
```

Expected: prints `Added /agent/* handler` (or `already present` on re-run), Caddy validates and reloads.

- [ ] **Step 3: Smoke-test the file server**

Run:
```bash
curl -sS -o /dev/null -w "HTTP %{http_code} size=%{size_download}\n" -H "Host: api.cmwcollective.com.au" http://192.168.99.143/agent/peritus-secure-agent-0.2.0.zip
```
Expected: `HTTP 200 size=<positive number>` matching the zip size.

- [ ] **Step 4: Commit**

```bash
git add scripts/phase2a/update-caddyfile.sh
git commit -m "build(deploy): Caddy handler for /agent/* static release downloads"
```

---

### Task 15: `agent-installer` edge function

**Files:**
- Create: `supabase/functions/agent-installer/index.ts`
- Modify: `supabase/config.toml`

This function takes a one-time enrolment token, validates it, and returns the download URL + sha256 + signature for the latest agent zip for that runtime + channel. The actual download happens client-side via Caddy.

- [ ] **Step 1: Write the function**

Write `supabase/functions/agent-installer/index.ts`:

```typescript
// GET /functions/v1/agent-installer?token=<enrollment_token>&runtime=powershell
// Returns: { token: string, download_url, sha256, ed25519_sig, latest_version, api_base_url }
// Used by the platform Agent Download page to build the one-liner install command.
//
// Auth: the enrolment token itself is the credential. Validated against public.enrollment_tokens
// (must exist, not expired, not used). The token is returned in the response so the install
// script can pass it to agent-enroll. (The token is single-use — it's consumed during the
// actual agent-enroll call, not here.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_API_BASE = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.cmwcollective.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (request) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = request.headers.get("origin");

    if (request.method !== "GET") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token")?.trim() ?? "";
    const runtime = url.searchParams.get("runtime") ?? "powershell";

    if (!token) {
        return jsonResponse({ error: "missing_token" }, 400, origin);
    }
    if (runtime !== "powershell" && runtime !== "dotnet") {
        return jsonResponse({ error: "invalid_runtime" }, 400, origin);
    }

    // Validate the token (existence, expiry, not used)
    const { data: tokenRow, error: tokenErr } = await supabase
        .from("enrollment_tokens")
        .select("token, expires_at, used_at, channel")
        .eq("token", token)
        .maybeSingle();

    if (tokenErr) {
        console.error("enrollment_tokens select failed", tokenErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!tokenRow) {
        return jsonResponse({ error: "token_invalid" }, 401, origin);
    }
    if (tokenRow.used_at) {
        return jsonResponse({ error: "token_already_used" }, 410, origin);
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: "token_expired" }, 410, origin);
    }

    // Look up the latest agent for this runtime + channel
    const { data: latest, error: vErr } = await supabase
        .from("agent_versions")
        .select("version, download_url, sha256, ed25519_sig")
        .eq("runtime", runtime)
        .eq("channel", tokenRow.channel)
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (vErr) {
        console.error("agent_versions select failed", vErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!latest) {
        return jsonResponse({ error: "no_release_published", runtime, channel: tokenRow.channel }, 503, origin);
    }

    return jsonResponse({
        token,
        runtime,
        latest_version: latest.version,
        download_url: latest.download_url,
        sha256: latest.sha256,
        ed25519_sig: latest.ed25519_sig,
        api_base_url: PUBLIC_API_BASE,
    }, 200, origin);
});
```

- [ ] **Step 2: Register in `supabase/config.toml`**

Append to the end of `supabase/config.toml`:
```toml

[functions.agent-installer]
verify_jwt = false
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/agent-installer/index.ts supabase/config.toml
git commit -m "feat(edge): agent-installer — validates enrolment token, returns signed download URL"
```

---

### Task 16: Deploy the new edge function

**Files:**
- Modify: `scripts/phase1/deploy-to-vm.sh` (extend to include agent-installer)

Or write a standalone script — extending the existing one is cleaner.

- [ ] **Step 1: Modify the deploy script to include agent-installer**

Open `scripts/phase1/deploy-to-vm.sh`. In the section that does `scp` of edge function files (around the `# === [3/4] copying edge functions to VM ===` block), add:

```bash
ssh "$VM" "sudo mkdir -p $FUNCTIONS_DIR/agent-installer"
scp supabase/functions/agent-installer/index.ts "$VM:/tmp/agent-installer-index.ts"
```

And in the `install -m 644` block immediately below, add:
```bash
sudo install -m 644 /tmp/agent-installer-index.ts $FUNCTIONS_DIR/agent-installer/index.ts
```

- [ ] **Step 2: Run the deploy**

```bash
bash scripts/phase1/deploy-to-vm.sh
```
Expected: deploy completes, no errors in the functions log tail.

- [ ] **Step 3: Smoke-test the new function**

Generate a test enrolment token first:
```bash
ORG_ID=$(ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T db psql -U postgres -d postgres -tAc "SELECT id FROM public.organizations ORDER BY created_at LIMIT 1"')
USER_ID=$(ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T db psql -U postgres -d postgres -tAc "SELECT id FROM auth.users LIMIT 1"')
TOKEN="phase2a-installer-test-$(date +%s)"
ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T db psql -U postgres -d postgres -c \"INSERT INTO public.enrollment_tokens (token, organization_id, created_by, runtime_hint, channel) VALUES ('$TOKEN', '$ORG_ID', '$USER_ID', 'powershell', 'stable')\""

curl -sS "http://192.168.99.143:8000/functions/v1/agent-installer?token=$TOKEN&runtime=powershell" -H "apikey: $(ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'sudo grep "^ANON_KEY=" /etc/peritus-supabase/.env | cut -d= -f2-')"
```

Expected: JSON response containing `download_url`, `sha256`, `ed25519_sig`, `latest_version: "0.2.0"`, `token`.

- [ ] **Step 4: Commit**

```bash
git add scripts/phase1/deploy-to-vm.sh
git commit -m "build(deploy): include agent-installer in VM deploy script"
```

---

### Task 17: Update Agent Download page

**Files:**
- Modify: `src/pages/AgentDownload.tsx` (add "Modern (Service)" tab)
- Possibly create: `src/components/agent/ServiceInstallTab.tsx`

The existing page hands out the legacy PowerShell scheduled-task command. We add a tab that:
1. Calls a new RPC to create an enrolment token for the current org
2. Shows a one-liner install command with the token embedded

- [ ] **Step 1: Read the existing AgentDownload.tsx to understand its structure**

Run: `head -100 src/pages/AgentDownload.tsx`

Note: this file may differ between the workstation repo and the VM's `/opt/peritus-endpoint-guardian/` checkout (the VM is older and has hardcoded URLs). If a fresh-eyes implementer doesn't see a tab structure here, raise it as a question — we may need to refactor the page to add tabs.

- [ ] **Step 2: Create the new tab component**

Write `src/components/agent/ServiceInstallTab.tsx`:

```typescript
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");

export function ServiceInstallTab() {
    const { currentOrganization } = useTenant();
    const [installCmd, setInstallCmd] = useState<string | null>(null);

    const generateToken = useMutation({
        mutationFn: async () => {
            if (!currentOrganization?.id) throw new Error("no organization selected");
            const { data: user } = await supabase.auth.getUser();
            if (!user.user) throw new Error("not authenticated");

            // Generate a random token client-side (server validates uniqueness via PK)
            const tokenBytes = crypto.getRandomValues(new Uint8Array(24));
            const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");

            const { error } = await supabase.from("enrollment_tokens").insert({
                token,
                organization_id: currentOrganization.id,
                created_by: user.user.id,
                runtime_hint: "powershell",
                channel: "stable",
            });
            if (error) throw error;
            return token;
        },
        onSuccess: (token) => {
            const cmd = `# Run as Administrator on the endpoint:
$ErrorActionPreference = 'Stop'
$resp = Invoke-RestMethod -Uri "${API_BASE}/functions/v1/agent-installer?token=${token}&runtime=powershell"
$zip = "$env:TEMP\\peritus-secure-agent.zip"
$dst = "$env:TEMP\\peritus-secure-agent"
Invoke-WebRequest -Uri $resp.download_url -OutFile $zip
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $resp.sha256) { throw "Bundle sha256 mismatch! Got $actual expected $($resp.sha256)" }
Expand-Archive -Path $zip -DestinationPath $dst -Force
& "$dst\\install-agent.ps1" -EnrollmentToken $resp.token -ApiBaseUrl $resp.api_base_url`;
            setInstallCmd(cmd);
        },
    });

    return (
        <div className="space-y-4">
            <Alert>
                <AlertDescription>
                    The modern agent installs as a true Windows service (auto-restart on crash,
                    visible in <code>services.msc</code>). Recommended for new endpoints.
                </AlertDescription>
            </Alert>

            {!installCmd && (
                <Button onClick={() => generateToken.mutate()} disabled={generateToken.isPending}>
                    {generateToken.isPending ? "Generating…" : "Generate install command"}
                </Button>
            )}

            {generateToken.error && (
                <Alert variant="destructive">
                    <AlertDescription>{String(generateToken.error)}</AlertDescription>
                </Alert>
            )}

            {installCmd && (
                <>
                    <Alert>
                        <AlertDescription>
                            Run the command below as Administrator on the target endpoint.
                            The enrolment token is single-use and expires in 7 days.
                        </AlertDescription>
                    </Alert>
                    <pre className="bg-muted p-4 rounded text-xs overflow-x-auto whitespace-pre-wrap">{installCmd}</pre>
                    <Button variant="outline" onClick={() => navigator.clipboard.writeText(installCmd)}>
                        Copy to clipboard
                    </Button>
                </>
            )}
        </div>
    );
}
```

- [ ] **Step 3: Wire the tab into `src/pages/AgentDownload.tsx`**

The existing page uses some pattern (tabs / sections) — read it first and integrate the new component matching the existing structure. If the page is a single-section flat layout, refactor to a `<Tabs>` (shadcn) with two children:
- "Legacy (Scheduled Task)" — the existing content
- "Modern (Service)" — `<ServiceInstallTab />`

Use the existing shadcn `Tabs / TabsList / TabsTrigger / TabsContent` pattern.

- [ ] **Step 4: Build and verify locally**

```bash
npm run build 2>&1 | tail -10
```
Expected: build completes without TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AgentDownload.tsx src/components/agent/ServiceInstallTab.tsx
git commit -m "feat(frontend): Agent Download page — modern service install tab with one-time enrolment tokens"
```

---

### Task 18: Integration test on a Windows endpoint

This task **requires a Windows endpoint** to run the install command and confirm the service comes up. Skip this task only if you intend to defer endpoint-side testing to a follow-up session.

**Files:** (none — this is a manual verification step that produces evidence)

- [ ] **Step 1: Pick or provision a test endpoint**

Options:
- A Windows VM you already have on the LAN
- Provision via Proxmox: a fresh Windows Server 2022 VM (~10 min)
- Use the workstation itself (this Windows Server) — but uninstall any previous agent first

You need:
- Administrator rights
- Network reachability to `192.168.99.143` (LAN) or `api.cmwcollective.com.au` (public, once DNS routes correctly)
- The hosts-file entry if you're using the `*.cmwcollective.com.au` names

- [ ] **Step 2: Generate an install command from the Agent Download page**

In the platform:
1. Log in
2. Navigate to Agent Download
3. Click the "Modern (Service)" tab
4. Click "Generate install command"
5. Copy the resulting one-liner

- [ ] **Step 3: Run it on the test endpoint**

Open an elevated PowerShell on the endpoint, paste the command, hit enter.

Expected output (paraphrased — match by content, not exact wording):
```
[install] Staging files at C:\ProgramData\PeritusSecure\install
[install] Enrolling at https://api.cmwcollective.com.au
[install] Enrolled — agent_id=<uuid>
[install] Wrote DPAPI-encrypted config at C:\ProgramData\PeritusSecure\config.dat
[install] Registering service 'PeritusSecureAgent' via NSSM
[install] Starting service
[install] Done. Service 'PeritusSecureAgent' is Running.
```

- [ ] **Step 4: Verify the service is real**

On the endpoint:
```powershell
Get-Service PeritusSecureAgent
```
Expected: `Status = Running`, `StartType = Automatic`.

```powershell
Get-Content "C:\ProgramData\PeritusSecure\logs\agent-$(Get-Date -Format yyyy-MM-dd).log" -Tail 20
```
Expected: `[Info] Peritus Secure Agent v0.2.0 starting`, `[Info] Enrolled agent_id=...`, `[Info] Heartbeat OK — next_check_in=60s, commands=0`.

- [ ] **Step 5: Verify server-side**

Run:
```bash
ssh -i ~/.ssh/id_ed25519 itadmin@192.168.99.143 'sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T db psql -U postgres -d postgres -c "SELECT hostname, runtime, agent_version, last_seen_at, is_online FROM public.endpoints WHERE runtime = '"'"'powershell'"'"' ORDER BY enrolled_at DESC LIMIT 3"'
```
Expected: a row with the test hostname, `runtime=powershell`, `agent_version=0.2.0`, recent `last_seen_at`, `is_online=true`.

- [ ] **Step 6: Verify a second heartbeat lands (proves the loop is alive)**

Wait 90 seconds, re-run the SELECT. `last_seen_at` should have moved forward.

- [ ] **Step 7: Run the uninstall to confirm cleanup works**

On the endpoint:
```powershell
& "C:\ProgramData\PeritusSecure\install\uninstall-agent.ps1"
```
Then:
```powershell
Get-Service PeritusSecureAgent -ErrorAction SilentlyContinue
```
Expected: nothing returned (service is gone).

- [ ] **Step 8: Document the test result**

Create `docs/superpowers/specs/2026-05-14-phase-2a-integration-test-evidence.md` with:
- Test endpoint hostname / OS version
- Date/time of test
- The agent_id assigned at enrolment
- Excerpts of the install log + endpoint logs
- Confirmation of two heartbeats
- Confirmation of clean uninstall

Commit it:
```bash
git add docs/superpowers/specs/2026-05-14-phase-2a-integration-test-evidence.md
git commit -m "docs(agent): phase 2a integration test evidence on <hostname>"
```

---

### Task 19: Push branch + open PR

- [ ] **Step 1: Push**

Run: `git push -u origin agent/phase-2a-nssm-powershell`

(Same caveat as Phase 1: GitHub push requires credentials. If headless, defer to user.)

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "Agent phase 2a: NSSM-wrapped PowerShell service runtime" --body "$(cat <<'EOF'
## Summary
- New runtime: `agent/runtime-powershell/` — three PS modules (HmacAuth, SecureConfig, ApiClient), service main loop, install/uninstall scripts, vendored NSSM 2.24.
- Pester unit tests for HmacAuth (cross-runtime parity with TS reference) and SecureConfig (DPAPI round-trip + ACL lockdown).
- New edge function `agent-installer` validates a one-time enrolment token and returns the signed download URL.
- Release pipeline: `scripts/phase2a/build-release.sh` produces versioned zip + sha256 + Ed25519 signature.
- Caddy serves the release zip from `/agent/*` (file-server), no Supabase Storage dependency.
- Frontend: new "Modern (Service)" tab on Agent Download page issues an enrolment token and shows the install one-liner.
- Integration tested on a real Windows endpoint (see `docs/superpowers/specs/2026-05-14-phase-2a-integration-test-evidence.md`).

## Test plan
- [x] `Invoke-Pester agent/runtime-powershell/tests/` — 18 tests pass
- [x] `bash scripts/phase2a/build-release.sh` produces `dist/peritus-secure-agent-0.2.0.zip`
- [x] `agent-installer` endpoint returns a valid manifest for a fresh token
- [x] One-liner install on a Windows VM ends with `Service 'PeritusSecureAgent' is Running.`
- [x] Two heartbeats land in `public.endpoints.last_seen_at`
- [x] Uninstall removes service + DPAPI config + scheduled task remnants

## Known limitations / follow-ups
- Auto-update download + verify + swap not yet implemented in the main loop (just logs "update available"). Comes in Phase 2b or a follow-up.
- Heartbeat payload is minimal — full Defender posture + event log forwarding stays in the legacy agent's `agent-api` for now. Phase 4 of the agent design replaces that.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec Self-Review

**1. Spec coverage** (against design doc §3 Path A):
- "Long-running loop, no Read-Host, structured logging" → Task 8 ✓
- "NSSM as Windows service `PeritusSecureAgent`" → Tasks 9-10 ✓
- Lives at `agent/runtime-powershell/` → Tasks 2-11 ✓
- Shared API contract — uses Phase 1 endpoints via ApiClient.psm1 → Task 7 ✓
- HMAC canonicalization parity → Tasks 3-4 with pinned vectors ✓
- DPAPI local secret storage (§2.2) → Tasks 5-6 ✓
- Signed auto-update download URL via agent_versions → Task 13-15 ✓ (auto-install deferred — documented as follow-up)
- Install-time runtime selection — partially: this plan only ships PowerShell; runtime=powershell is hardcoded. Path B will add the choice. Acceptable for Phase 2a.

**2. Placeholder scan:** none. Every step has the actual code/command.

**3. Type consistency:**
- `AgentId` / `agent_id` — string UUID throughout
- `AgentSecret` / `agent_secret` — string throughout
- `EnrollmentToken` / `enrollment_token` — string throughout
- HMAC headers — `X-Agent-Id`, `X-Timestamp`, `X-Signature` consistent
- `ConvertTo-CanonicalJson` / `Get-HmacSignature` / `New-HmacRequestHeaders` — same names in tests + impl
- `Save-SecureConfig` / `Read-SecureConfig` / `Test-SecureConfigExists` — same in tests + impl
- `Invoke-AgentEnroll` / `Invoke-AgentHeartbeat` / `Invoke-AgentVersionCheck` — same in ApiClient + installer + main loop

No issues found.
