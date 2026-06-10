# Mithras Threat Defence Agent — PowerShell + NSSM runtime

Modular PowerShell runtime for the Mithras Threat Defence platform. Runs as a Windows service under `NT AUTHORITY\SYSTEM` (fronted by `MithrasAgent.exe` so Task Manager and the Services console show the Mithras icon + friendly name). Authenticates via HMAC-SHA256 (see `agent/contracts/hmac-canonicalization.md`).

## Install (operator)

1. Generate an enrolment token in the platform (Agent Download page).
2. Run the one-liner shown there as an Administrator on the target endpoint.

The installer:
- Downloads a signed bundle (sha256 + Ed25519-verified)
- Extracts to `C:\ProgramData\Mithras\`
- Registers the `MithrasAgent` Windows service via NSSM (or `MithrasAgent.exe` launcher if bundled)
- Detects any pre-existing `PeritusSecureAgent` install and migrates its DPAPI config so the endpoint stays linked to the same `agent_id` (no duplicate in console)
- POSTs the enrolment token to the platform to receive a per-endpoint `agent_secret` (only on fresh installs)
- Encrypts `{ agent_id, agent_secret, api_base_url }` to `config.dat` via DPAPI (LocalMachine scope)
- Starts the service

## Uninstall

Run `uninstall-agent.ps1` as Administrator. Removes the new and legacy services, config files, and install directories. Use `-KeepLogs` to preserve `C:\ProgramData\Mithras\logs\` for forensics.

## Layout

- `mithras-agent.ps1` — service main loop
- `lib/HmacAuth.psm1` — request signing
- `lib/SecureConfig.psm1` — DPAPI wrapper
- `lib/ApiClient.psm1` — HTTP client for the agent API
- `lib/FirewallAuditCollector.psm1` — pfirewall.log delta shipping with server-stamped `rule_id`
- `lib/SysmonCollector.psm1` / `lib/SysmonInstaller.psm1` — EDR telemetry
- `lib/PolicyEnforcer.psm1` — UAC / Firewall / Windows Update / Defender / GPO policy push
- `lib/CommandExecutor.psm1` — active-response handlers (isolate, kill, quarantine, scan)
- `lib/WdacControl.psm1` — Windows Defender Application Control
- `tests/` — Pester unit tests
- `vendor/nssm.exe` — Non-Sucking Service Manager 2.24 (public domain)
- `install-agent.ps1` / `uninstall-agent.ps1` — installer scripts
- `agent.version` — semver shipped with this release
