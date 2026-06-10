# RMM replacement + Guacamole remote access — design

**Status:** draft for review (2026-06-03)
**Goal:** Make Mithras a viable replacement for Tactical RMM (or any general-purpose RMM) so we can run one platform per customer instead of two. The driver right now is **remote remediation** — when an endpoint goes into lockdown or has an active threat, the SOC operator should be able to RDP into it from the console without leaving Mithras or reaching for a separate tool.

---

## 1. What we already have vs what Tactical RMM offers

Mithras already covers most of the security-adjacent RMM surface area. The gap is on the general IT-ops side: remote control, ad-hoc scripts, and deep hardware inventory.

| Capability                              | Tactical RMM | Mithras today                                  | Gap                  |
|-----------------------------------------|--------------|------------------------------------------------|----------------------|
| Endpoint agent                          | ✓ (Go)       | ✓ (PowerShell + NSSM)                          | —                    |
| Multi-tenant MSP UI                     | ✓            | ✓                                              | —                    |
| Software inventory                      | ✓            | ✓                                              | —                    |
| Windows Update management               | ✓            | ✓ (WU policies)                                | —                    |
| Defender / antivirus management         | partial      | ✓ (Defender policies, ASR, exclusions)         | —                    |
| Event log forwarding                    | ✓            | ✓                                              | —                    |
| Sysmon                                  | ✗            | ✓                                              | —                    |
| Alerts (UI + email)                     | ✓            | ✓ (+ M365 ITDR, AI triage)                     | —                    |
| Customer reports                        | ✓            | ✓                                              | —                    |
| Microsegmentation / firewall control    | ✗            | ✓                                              | —                    |
| **Remote desktop access**               | ✓ (MeshCentral integration) | **✗** — only Emergency Unlock + agent commands | **Phase 1** |
| **Remote shell / arbitrary PS**         | ✓ (script runner) | **✗** — fixed command-types only          | **Phase 2** |
| **Scheduled custom scripts (cron-like)**| ✓            | ✗                                              | Phase 3              |
| **Deep hardware inventory** (CPU/RAM/disk/peripherals) | ✓ | partial (only Defender status)       | Phase 4              |
| **Service / disk / perf monitoring + thresholds** | ✓  | ✗                                            | Phase 5              |
| **Third-party patch management** (Chrome, Adobe, etc.) | ✓ | ✗                                          | Phase 6              |

**The two gaps that matter for your "remediate the platform remotely" goal are Phase 1 + Phase 2.** The rest is "feature parity for RMM replacement marketing" — important eventually, not blocking on remediation use cases.

---

## 2. Phase 1 — Guacamole-based remote desktop

### 2.1 The user experience

In `EndpointDetail`, alongside the existing **Emergency Unlock** and **Isolate from network** actions, add a **Remote Desktop** button. Click → confirmation dialog (always confirm; this is invasive) → new tab opens a Guacamole web client showing the endpoint's desktop. Operator does what they need to do, closes the tab. Session ends. An alert is created with the operator's name, start/end timestamps, and (optionally) a session recording reference.

### 2.2 Architecture

The fundamental problem: customer endpoints are behind NAT/firewall. We can't initiate a TCP connection *to* them. So the **agent has to initiate the tunnel**, and we relay through docker02.

```
┌────────────────────┐                        ┌─────────────────────────┐
│ Customer endpoint  │                        │ docker02                │
│                    │                        │ ┌─────────────────────┐ │
│  ┌──────────────┐  │  outbound TLS / WSS    │ │ tunnel relay        │ │
│  │ mithras-agent│──┼───────────────────────►│ │ (Go / Node service) │ │
│  └──────────────┘  │  (kept alive)          │ └──────────┬──────────┘ │
│        │           │                        │            │            │
│        │ on demand │                        │            │ local fd   │
│        ▼           │                        │            ▼            │
│  ┌──────────────┐  │   tunneled bytes       │ ┌─────────────────────┐ │
│  │ RDP server   │◄─┼────────────────────────┤ │ guacd               │ │
│  │ (svchost)    │  │                        │ │ (Apache Guacamole)  │ │
│  └──────────────┘  │                        │ └──────────┬──────────┘ │
└────────────────────┘                        │            │            │
                                              │            ▼            │
                                              │ ┌─────────────────────┐ │
                            SOC operator      │ │ guacamole-client    │ │
                            (browser)  ◄──────┤ │ (Tomcat web UI)     │ │
                                              │ └─────────────────────┘ │
                                              │            ▲            │
                                              │            │ session    │
                                              │            │ auth       │
                                              │ ┌─────────────────────┐ │
                                              │ │ Mithras auth proxy  │ │
                                              │ │ (edge function)     │ │
                                              │ └─────────────────────┘ │
                                              └─────────────────────────┘
```

**Five components, two of them new:**

1. **Apache Guacamole** (`guacd` + `guacamole-client` containers) deployed on docker02. Standard upstream images, public, well-maintained. Configured to accept connections only from the Mithras auth proxy.
2. **Tunnel relay** (new) — a small Go service on docker02 that accepts WSS connections from agents and, on demand, accepts a TCP connection from guacd that gets piped through to a specific agent. One agent = one persistent control connection. Per-session = one ephemeral data channel multiplexed inside the control connection.
3. **Mithras auth proxy** (new) — an edge function that validates a SOC operator's session, generates a short-lived (5-min) Guacamole connection token, and returns the connection URL. Guacamole's `auth-header` extension or a custom auth backend reads the token and binds the session to a specific endpoint.
4. **Agent tunnel module** (new) — `RemoteAccessTunnel.psm1`. On agent start, opens a WSS connection to `wss://tunnel.mithras.com.au/agent/<endpoint_id>` with HMAC auth. Stays open. When the relay says "start RDP session", the agent opens a local TCP connection to `127.0.0.1:3389` and pipes bytes both ways. When the session ends, the data channel closes; control connection persists.
5. **Frontend "Remote Desktop" button** (new) — confirmation dialog → calls auth proxy → opens new tab.

### 2.3 Why this architecture (vs alternatives)

| Option | Pros | Cons |
|---|---|---|
| **Reverse SSH tunnel** (agent dials `ssh -R` to docker02) | Battle-tested, uses OpenSSH built into Win10+ | Win7/2012R2 need Win32-OpenSSH installed separately. SSH key management adds operational load. One TCP port per concurrent session at the relay. |
| **WireGuard mesh** | Fast, low overhead, kernel-level | Requires kernel module install on endpoint. EOL Windows support is poor. Major customer footprint. |
| **Custom WSS tunnel** (the recommendation) | Pure user-mode, works on every Windows ≥ Win7 with no extra install. HTTPS-port (443) → works through any restrictive firewall. Multiplexing means one persistent connection per agent regardless of session count. Same transport reusable for Phase 2 remote shell. | We build it. ~600 lines of Go for the relay, ~300 of PS for the agent module. |
| **MeshCentral integration** | Already does the tunneling + RDP-equivalent (MeshAgent). Open source. Mature. | Adds another auth surface + UI. Operator has to manage *two* consoles. Hard to deeply integrate (e.g. record session metadata into our alerts/incidents). |
| **Cloudflare tunnels** | Zero infra burden | Per-endpoint cost. Vendor lock-in. |

**Recommendation: custom WSS tunnel.** Reuses the same transport for Phase 2, works on EOL Windows (key differentiator per the EOL-hardening positioning), keeps everything inside our auth model, and is small enough to maintain.

### 2.4 Auth flow

1. Operator clicks **Remote Desktop** on `EndpointDetail`.
2. Confirmation dialog (records the operator's *reason* — "incident response", "user-requested help", etc. — for audit).
3. Frontend POSTs to edge function `remote-desktop-start` with `endpoint_id` + reason.
4. Edge function verifies the user has admin or super-admin role on the org owning the endpoint. Generates a short-lived (5-min) `connection_token` (random 32 bytes), stores in a `remote_desktop_sessions` table with `endpoint_id, user_id, token, reason, started_at, ended_at IS NULL, status='pending'`. Returns the Guacamole URL: `https://remote.mithras.com.au/guacamole/#/client/<token>`.
5. Frontend opens that URL in a new tab.
6. Guacamole web client extracts the token from the URL, calls the auth proxy backend to exchange the token for a connection profile. Proxy verifies the token, marks `status='active'`, returns Guacamole connection params:
   - protocol: `rdp`
   - hostname: `relay.docker02.local` (the internal relay address)
   - port: a relay-assigned port that's already bound to the agent's tunnel for this endpoint
   - username: a temporary local Windows account (or stored creds — see § 2.7)
7. Guacamole connects to the relay; relay matches incoming TCP to the agent's tunnel by destination port → opens a data channel → agent receives "start RDP" → agent opens 127.0.0.1:3389 → bytes flow.
8. On session end, frontend or Guacamole calls `remote-desktop-end`. Marks `status='ended'`, sets `ended_at`. An alert is auto-created in the `alerts` table (`alert_type='remote_desktop_session'`, severity `low`, message includes operator + duration + reason) — this gives the SOC an audit trail without polluting the alerts UI.

### 2.5 Authorization model

- **Org admins** can RDP to endpoints in their org.
- **Peritus super-admins** can RDP to any endpoint.
- **End-user notification** (Phase 1.1): show a system-tray notification on the endpoint that "an administrator has connected for remote support" — this is required by AU privacy law for non-emergency RDP sessions. For emergency / incident sessions, the operator can override (logged separately).
- **Two-person rule** (Phase 2 optional): for endpoints with `defender_state.active_threat_count > 0`, require a second admin to approve the session before it activates.

### 2.6 Session recording (Phase 1.5)

Guacamole supports built-in session recording — stores everything as a binary `.guac` file on the server, replayable in the same web client. Enable from the start so:
- compliance posture is documented
- when something goes wrong post-incident, the SOC can replay what was clicked
- helps train new SOC operators

Storage cost is real — RDP sessions at typical desktop bitrate are ~5–20MB/min. Plan: keep 30 days hot on docker02, archive older to S3-compatible backup, or just delete after 30 days (configurable per-org).

### 2.7 Auth into Windows (the awkward bit)

Once Guacamole + the tunnel is set up, the SOC operator still has to log into Windows. Three options:

| Option | Notes |
|---|---|
| **Operator types creds in Guacamole's prompt** | Simplest. Requires operator to know the box's local Administrator password. Bad UX, and operators shouldn't know customer passwords. |
| **Agent provisions a one-time local account** | Agent creates `MithrasSupport-<random>` user with `Remote Desktop Users` membership and a generated password. Returns password to the auth proxy. Account auto-removed when session ends. Best UX, slight risk if cleanup fails. |
| **Vault customer credentials per endpoint** | Customer stores their admin creds in Mithras vault (encrypted at rest). Auth proxy pulls + passes to Guacamole on connect. Requires building a vault. |

**Recommendation: option 2 (ephemeral local account)** for v1. Build vault (option 3) in Phase 7 if customers ask.

### 2.8 What we ship in v1

- Guacamole + tunnel relay containers on docker02 (~2 days work)
- `RemoteAccessTunnel.psm1` agent module + bootstrap from `mithras-agent.ps1` (~1 day)
- `remote-desktop-start` + `remote-desktop-end` edge functions (~½ day)
- `remote_desktop_sessions` table + RLS policies (~½ day)
- Frontend button + confirmation dialog + session-list view (~1 day)
- DNS: `remote.mithras.com.au` and `tunnel.mithras.com.au` → docker02, Caddy reverse proxy, TLS via existing automation (~½ day)
- Ephemeral-account provisioning + teardown (~1 day)
- Session recording enabled (~½ day)
- Basic audit alert on every session (~½ day)

Total: ~7 days of focused work for an MVP. Realistic 2-3 weeks calendar with testing and back-and-forth.

---

## 3. Phase 2 — Remote shell command

Once we have the tunnel from Phase 1, remote shell is small:

- New agent command: `run_powershell` with `params: { script: "...", timeout_seconds: 60 }`
- Agent's `CommandExecutor.psm1` dispatches to `Invoke-RemotePowerShell` which:
  - Validates the script doesn't contain `Stop-Service MithrasAgent` or other suicide patterns
  - Runs with a hard timeout, captures stdout + stderr
  - Returns `{exit_code, stdout, stderr}` in the command result
- UI: a "Run script" action in `EndpointResponseActions` with a code editor (Monaco), output panel
- Audit: every run logs to `activity_logs` + creates an `alerts` row with severity `low`

**Security gates** (non-negotiable):
- Super-admin or org-admin only
- Confirmation modal with "I understand this runs as SYSTEM" checkbox
- Hard 5-minute timeout
- All output stored on the command result row (max 1 MB)
- Sensitive output redaction: if stdout matches `(password|secret|token|key)`, replace with `[REDACTED]` before storing (Phase 2.1)

This unlocks ad-hoc remediation: "clear that registry key", "restart that service", "free up disk space", "rotate a credential", without needing RDP.

---

## 4. Phases 3-6 (later)

Briefly, so the full RMM-replacement story is visible:

- **Phase 3 — Scheduled scripts.** `scheduled_tasks` table (org-scoped) with cron expression + script + target (endpoint or group). pg_cron schedules → queues `run_powershell` commands per endpoint.
- **Phase 4 — Hardware inventory.** New agent collector `HardwareCollector.psm1`. Ships CPU/RAM/disk/monitors/peripherals/BIOS/TPM. New `endpoint_hardware` table.
- **Phase 5 — Service + disk + perf monitoring with thresholds.** Agent ships service state + disk free + CPU/RAM averages every heartbeat. Server-side rules: "alert when service X stops" / "alert when disk Y < 10%" / "alert when CPU > 90% for 10min".
- **Phase 6 — Third-party patch management.** Wrap Chocolatey or winget. New `software_packages` table per org with policy. Agent installs/updates on schedule.

These are 4-8 weeks of work each. The order I'd ship them: 3 (immediate ops value) → 5 (alerting fits security narrative) → 4 (one-shot collection) → 6 (biggest scope, biggest risk).

---

## 4.5. Decisions locked in (2026-06-03)

| Decision | Chosen path |
|---|---|
| Subdomains | New: `remote.mithras.com.au` (Guacamole UI), `tunnel.mithras.com.au` (agent WSS). User configures both on the upstream NPM with **Websockets ON** forwarding to docker02:9080 and :9100 respectively. |
| Windows auth | Ephemeral local account — agent creates `MithrasSupport-<random>` with `Remote Desktop Users` membership and an auto-generated password at session start, removes account on session end. |
| Session recording | 30 days hot on docker02. No archive. Auto-purge older than 30d via cron. |
| Host | docker02 (149.28.186.142). Vultr firewall locks ports 9080 + 9100 to NPM's IP only. |
| Phase 2 run-script auth | Org admins on their own org's endpoints (super-admins inherit by being above org-admin in role hierarchy). |
| Phase 2 confirm UX | Yes/no dialog + checkbox "I understand this runs as SYSTEM". |
| Phase 2 output safety | Auto-redact secrets matching `password|secret|token|api[_-]?key|client[_-]?secret|bearer` → `[REDACTED]` before storing the command result. |

## 5. Open questions / decisions for you

1. **Subdomains:** OK to use `remote.mithras.com.au` for the Guacamole UI and `tunnel.mithras.com.au` for the WSS endpoint? Or fold into `api.mithras.com.au` paths?
2. **Session recording retention:** 30 days hot + 90 days archive? Or 7 days hot, no archive (cheaper, more aggressive)?
3. **End-user notification:** required for non-emergency sessions per AU privacy law — does this need a separate "user consent" flow per-customer, or is the MSP contract sufficient?
4. **Branding:** does Guacamole's UI get re-skinned to Mithras colors (~2 days extra), or do we accept the Guacamole default UI for the v1?
5. **Cost:** the tunnel relay + Guacamole containers will eat ~1 GB RAM and some CPU on docker02. Are we OK with that on the current VM, or do we need to plan for a separate `peritus-remote` host?

---

## 6. Recommendation

Ship Phase 1 (Guacamole + tunnel) first. It's the highest-leverage feature for the remediation use case, it's the foundation for Phase 2, and it cleanly slots into the existing `EndpointResponseActions` UX. Phase 2 (remote shell) lands ~3 days after Phase 1. Together they make Mithras a credible RMM replacement for the "I just need to fix this one thing on one endpoint" workflow that's 80% of ad-hoc IT work.

After Phase 1 and 2 ship, evaluate whether you actually still need Tactical RMM. My guess: for security/incident work, no. For scheduled patching at scale of dozens of endpoints, you might want Phase 3 first.
