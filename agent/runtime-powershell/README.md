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
