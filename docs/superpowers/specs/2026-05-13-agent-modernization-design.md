# Peritus Secure Agent — Modernization Design (Phases 1-4)

**Status:** Approved 2026-05-13
**Scope:** Phases 1-4 of a 5-phase modernization. Phase 5 (code-signing + EDR-grade telemetry) deferred.
**Target environment:** `apidev.peritusdigital.com.au` (self-hosted replica on Proxmox VM `peritus-supabase`, 192.168.99.143)

---

## 1. Overview

### Problem

The current PowerShell agent was sufficient as a proof-of-concept but has structural issues that block enterprise use:

- **No identity model.** Agents authenticate via a shared anon key. Any leaked agent install lets an attacker speak to the platform as any tenant.
- **Secrets in plaintext.** Config file on disk holds JWTs and API URLs unencrypted.
- **No push channel.** Console-issued commands are picked up only on the next heartbeat (default 60s). Time-to-isolate is unacceptable for active incidents.
- **No service hardening.** Runs as a scheduled task; no auto-restart, no crash recovery, no signed updates.
- **No observability.** End-user has no idea the agent exists; operator has only heartbeat presence, no event stream.
- **CORS is wide open.** Edge functions accept requests from any origin.

### Goal

Produce a production-grade Windows endpoint agent that:

- Authenticates with per-agent credentials, bound at enrollment time
- Stores all secrets DPAPI-encrypted at rest
- Receives commands in under one second via a websocket push channel, with heartbeat as fallback
- Runs as a true Windows service with crash recovery and signed auto-update
- Streams structured events to a SOC-visible dashboard
- Gives the end-user a tray-icon status indicator (read-only — no kill-switch)
- Ships in two interchangeable runtime variants (NSSM-wrapped PowerShell, compiled .NET 8 single-file) sharing one API contract

### Non-goals (Phase 5 territory)

- Code signing (Authenticode) — deferred
- EDR-grade kernel telemetry — deferred
- Cross-platform support (Linux/macOS) — out of scope; Windows-only

### Architectural principles

- **Single source of truth in Postgres.** Every command, event, and version manifest lives in the platform database — local agent state is a cache, never authoritative.
- **Asymmetric signing for code, symmetric HMAC for messages.** Ed25519 for update binaries (verified offline by agent), HMAC-SHA256 with per-agent secret for runtime API calls.
- **No new infrastructure.** Reuse Supabase Realtime, Postgres NOTIFY, existing edge runtime. No MQTT broker, no SignalR hub, no separate websocket server.
- **Show, don't control (end-user UX).** Tray app surfaces status but cannot stop the service or disable scans. Those are console operations.

---

## 2. Phase 1 — Security Plumbing

### 2.1 Enrollment

A one-time enrollment token, generated in the console, binds an installer to a tenant + agent identity. Token is used once, exchanged for a permanent `agent_id` + `agent_secret`.

**`public.enrollment_tokens`**

```sql
CREATE TABLE public.enrollment_tokens (
    token           text PRIMARY KEY,                    -- 32-byte URL-safe random
    organization_id uuid NOT NULL REFERENCES public.organizations(id),
    created_by      uuid NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',
    used_at         timestamptz,
    used_by_agent   uuid REFERENCES public.agents(id),
    hostname_hint   text                                  -- optional pre-fill from console
);
```

**Edge function `agent-enroll`**

- Validates token not used, not expired
- Generates `agent_id` (uuid v4) and `agent_secret` (32-byte random, base64url)
- Inserts row into `public.agents` with `organization_id` from token
- Marks token used
- Returns `{ agent_id, agent_secret, api_base_url }` once — never retrievable again
- Rate-limited: 5 attempts per token IP per hour

### 2.2 Local secret storage (DPAPI)

Agent stores `{ agent_id, agent_secret, api_base_url }` at `C:\ProgramData\PeritusSecureAgent\config.dat`, encrypted with `DPAPI_LocalMachine` scope. Only LocalSystem (and admins via the API) can decrypt. File ACLs restrict to `SYSTEM` + `Administrators` only.

C# (Path B):
```csharp
ProtectedData.Protect(json, optionalEntropy: null, DataProtectionScope.LocalMachine)
```

PowerShell (Path A):
```powershell
[System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')
```

### 2.3 Runtime API auth (HMAC)

Every agent → platform call:

1. Canonicalize the request body (JSON with sorted keys, no whitespace)
2. `signature = HMAC-SHA256(agent_secret, "<method>\n<path>\n<timestamp>\n<canonical_body>")`
3. Send headers: `X-Agent-Id`, `X-Timestamp`, `X-Signature`

Edge function validates:
- Timestamp within ±5 minutes (replay protection)
- Signature matches
- Agent not revoked (`agents.is_active = true`)

### 2.4 Signed auto-update

**`public.agent_versions`**

```sql
CREATE TABLE public.agent_versions (
    version         text PRIMARY KEY,                    -- semver e.g. '1.2.3'
    runtime         text NOT NULL,                       -- 'powershell' | 'dotnet'
    download_url    text NOT NULL,                       -- public CDN URL
    sha256          text NOT NULL,
    ed25519_sig     text NOT NULL,                       -- base64 signature of sha256
    min_os_version  text,
    channel         text NOT NULL DEFAULT 'stable',      -- stable | beta | canary
    is_active       boolean NOT NULL DEFAULT true,
    published_at    timestamptz NOT NULL DEFAULT now()
);
```

Signing keypair generated once: `/etc/peritus-supabase/agent-signing.pem` (private, mode 600, root-owned). Public key baked into every agent binary at build time.

**Edge function `agent-version-check`** returns the latest active version for the agent's runtime + channel. Agent verifies `sha256` after download, then verifies `ed25519_sig` against baked-in public key before executing. If either check fails: log critical event, abort update, keep running current version.

### 2.5 CORS lockdown

Replace current wildcard CORS on all `/functions/v1/*` with explicit allow-list:
- `https://appdev.peritusdigital.com.au` (frontend)
- `https://apidev.peritusdigital.com.au` (self-references from edge functions)

Agent calls don't need CORS (they're not browser-originated) — but adding `X-Agent-Id` to the agent UA string lets us tell them apart in logs.

---

## 3. Phase 2 — Service Runtimes

Two interchangeable runtimes, one API contract.

### Path A — NSSM-wrapped PowerShell (~4 hours)

- Lift current `peritus-secure-agent.ps1` into service-friendly form: long-running loop, no `Read-Host`, structured logging
- Wrap with [NSSM](https://nssm.cc/) as Windows service `PeritusSecureAgent`
- Lives at `agent/runtime-powershell/`
- **Build first** — gets us onto real endpoints within a day

### Path B — Compiled .NET 8 single-file (~3 days)

- `peritus-secure-agent.exe`, self-contained (`PublishSingleFile=true, SelfContained=true`)
- Native Windows service via `Microsoft.Extensions.Hosting.WindowsServices`
- DPAPI calls through `System.Security.Cryptography.ProtectedData`
- Lives at `agent/runtime-dotnet/`
- **Production target** — replaces Path A once stable

### Shared API contract (`agent/contracts/`)

Both runtimes implement the same JSON contract against `apidev.peritusdigital.com.au`:

```
POST /functions/v1/agent-enroll             { enrollment_token }
                                            → { agent_id, agent_secret, api_base_url }

POST /functions/v1/agent-heartbeat          { agent_id, payload } + HMAC headers
                                            → { commands[], next_check_in }

POST /functions/v1/agent-event              { agent_id, events[] } + HMAC headers
                                            → 204

GET  /functions/v1/agent-version-check      ?current=X&runtime=Y + HMAC headers
                                            → { latest, url, sha256, ed25519_sig }

POST /functions/v1/agent-realtime-token     { agent_id } + HMAC headers
                                            → { jwt, expires_at }
```

Signing, payload shapes, error codes are byte-identical. Platform never needs to know which runtime is talking.

### Install-time selection

`install-agent.ps1 -Runtime PowerShell|Dotnet [-EnrollmentToken xxx]`. Default to `Dotnet` once Path B is shipped.

---

## 4. Phase 3 — Real-Time Command Channel

### Data model

**`public.agent_commands`**

```sql
CREATE TABLE public.agent_commands (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    command         text NOT NULL,        -- 'scan_now' | 'isolate' | 'collect_logs' | 'update' | 'uninstall'
    parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'pending',
                    -- pending | delivered | acked | failed | expired
    issued_by       uuid REFERENCES auth.users(id),
    issued_at       timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,
    acked_at        timestamptz,
    result          jsonb,
    expires_at      timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_commands;
ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_sees_own ON public.agent_commands
    FOR SELECT TO authenticated
    USING (agent_id = (auth.jwt() ->> 'agent_id')::uuid);
```

### Agent connection flow

1. Service start → call `agent-realtime-token` (HMAC-signed) → receive short-lived (1h) Supabase JWT with custom claim `{ agent_id, role: 'agent' }`
2. Open websocket to `wss://apidev.peritusdigital.com.au/realtime/v1/websocket`
3. Subscribe with filter `agent_id=eq.<uuid>` on `agent_commands` INSERT events
4. Auto-refresh token 5min before expiry
5. On disconnect, reconnect with backoff (1s, 2s, 5s, 15s, 60s capped); heartbeats keep running so console still shows "online"

### Command execution flow

```
Console operator clicks "Isolate endpoint X"
  → INSERT INTO agent_commands (agent_id=X, command='isolate')
  → Postgres NOTIFY → Realtime broadcast
  → Agent receives in ~200ms
  → UPDATE status='delivered', delivered_at=now()
  → Execute (Defender BlockAtFirstSee, drop firewall rules, etc.)
  → UPDATE status='acked', acked_at=now(), result=...
  → Console sees live update
```

### Why Realtime, not webhooks/MQTT/SignalR

- Already running on the platform — zero new infrastructure
- Outbound websocket survives NAT/firewall on endpoint
- Postgres is the single source of truth; console history is automatic
- Falls back gracefully: heartbeat already polls for `status='pending'` rows

### Idempotency & safety

- Every command has a UUID; agent records executed UUIDs in local DPAPI-encrypted SQLite and refuses re-execution
- `expires_at` defaults to 15 minutes
- Destructive commands (`isolate`, `uninstall`) require MFA challenge in console before INSERT

---

## 5. Phase 4 — Logging + Tray UX

### Logging (operator-facing)

Three sinks, one structured logger:

1. **Local rolling file** — `C:\ProgramData\PeritusSecureAgent\logs\agent-YYYY-MM-DD.log`, JSON lines, 50MB × 7 days, gzipped to `archive/`. Survives platform outages.
2. **Windows Event Log** — channel `Peritus Secure Agent`, errors/warnings only. Enterprise SIEMs pick up via WEF without touching our platform.
3. **Platform** — `POST /functions/v1/agent-event`, batched every 30s or immediate on critical events. Lands in existing `public.endpoint_event_logs`.

**Log schema:**
```json
{
  "ts": "2026-05-13T...",
  "agent_id": "uuid",
  "level": "info|warn|error|critical",
  "category": "scan|defender|firewall|update|command|service",
  "msg": "human readable",
  "data": { ... },
  "trace_id": "uuid"
}
```

Hooks directly into Grafana SOC dashboard panel 9 (`endpoint_event_logs` grouped by `level`).

### Tray UX (end-user facing)

**Rule: show, don't control.** Users can see status but cannot stop the agent or disable scans.

**Icon states:**
- Green → all good, recent heartbeat, RTP on
- Yellow → degraded (RTP off, threat pending, missed heartbeat)
- Red → critical (active unresolved threat, no platform connection >1h)
- Grey → service stopped (admin-only visibility; service auto-restarts)

**Right-click (regular user):**
- Open status window
- Run scan now (queues `scan_now` via local named pipe — same code path as console)
- View recent activity (last 20 events from local SQLite)
- Help / About

**Right-click (local admin):** above, plus:
- Open log folder
- Force heartbeat
- Re-enrollment wizard (for orphaned agents)

**Status window:** agent version, last heartbeat, current Defender posture, active threats count, "managed by Peritus" + tenant name. No raw logs.

**Tray ↔ service IPC:** Local named pipe `\\.\pipe\peritus-secure-agent`, JSON-RPC. Service authenticates by checking calling process token (LocalSystem-spawned vs user-spawned) to gate admin commands.

### Crash recovery

- NSSM / .NET host auto-restart with exponential backoff (5s, 30s, 5min capped, 10 attempts before alert)
- Crash dumps → `ProgramData\PeritusSecureAgent\crash\`, uploaded on next successful heartbeat
- Watchdog: separate scheduled task pings named pipe every 5min — two failures → force service restart + log critical event

---

## 6. Workflow / Git Approach

### Branching

- `main` — what's deployed to the replica VM. Protected, squash-merge from PRs.
- `agent/phase-1-security-plumbing`, `agent/phase-2-runtimes`, `agent/phase-3-realtime`, `agent/phase-4-logging-tray` — one branch + one PR per phase.

### Repo layout

```
peritus-endpoint-guardian/
├── src/                          # existing React frontend
├── supabase/functions/           # existing edge functions
├── agent/                        # NEW
│   ├── contracts/                # JSON schemas + signing spec (phase 1)
│   ├── runtime-powershell/       # phase 2 path A
│   ├── runtime-dotnet/           # phase 2 path B
│   ├── tray/                     # phase 4 tray app (WPF, shared with runtime-dotnet)
│   ├── installer/                # MSI + bootstrapper
│   └── tests/
│       ├── integration/          # end-to-end against the replica
│       └── unit/
├── docs/superpowers/{specs,plans}/
└── docker-compose.yml
```

### Per-phase workflow

1. Spec (this document — Sections 2-5 are the per-phase specs)
2. Plan via `superpowers:writing-plans` — one plan file per phase, all four saved up front
3. Execute via `superpowers:subagent-driven-development` — fresh implementer per task, two-stage review (spec compliance → code quality)
4. Deploy phase → replica VM → smoke test → merge to `main`

### Tests

- **Unit:** xUnit (C#), Pester (PowerShell). Both runtimes pass the same contract test suite.
- **Integration:** Windows test VM against `apidev.peritusdigital.com.au`. Test tenant segregated by RLS.
- **Manual smoke before merge:** install on one real test endpoint, verify Grafana SOC dashboard shows events, issue a command, watch <2s execution.

### Deployment cadence

Phase merges to `main` → manual deploy to replica VM. No CI/CD pipeline yet (single VM). Auto-deploy comes when we promote dev → prod.

### Coordination with parallel work

- **Grafana SOC dashboard** — already deployed (2026-05-13). Once Phase 4 lands, panels 4/5/9/11 populate with real telemetry. No coordination needed.
- **React frontend** — untouched during Phases 1-3. Phase 3 adds "Command Center" view; Phase 4 adds "Live Activity" stream. Both additive, separate PRs on top of agent phase PRs.

### Per-phase VM deployment summary

| Phase | New on VM |
|-------|-----------|
| 1 | Edge functions `agent-enroll`, `agent-realtime-token`, `agent-version-check`. Tables `enrollment_tokens`, `agent_versions`. Ed25519 keypair at `/etc/peritus-supabase/agent-signing.pem`. |
| 2 | Agent installer artifacts published to `agent_versions`. |
| 3 | Table `agent_commands` added to `supabase_realtime` publication. Edge function `agent-command-dispatch` (console-side, MFA-gated). |
| 4 | Edge function `agent-event`. RLS on `endpoint_event_logs` scoping writes to authenticated agent JWT. |

---

## 7. Open Items Before Implementation

1. **Build order confirmed:** Path A (NSSM-wrapped PowerShell) first for fast endpoint validation; Path B (.NET 8) second as production target.
2. **Code signing:** deferred to Phase 5. Phases 1-4 ship unsigned; installer warns user.
3. **Test endpoint:** at least one Windows VM for integration testing. To be provisioned via Proxmox on `192.168.99.220` unless an existing VM is available.

---

## 8. Out of Scope (Phase 5 and beyond)

- Authenticode code-signing certificate procurement + signing pipeline
- EDR-grade kernel telemetry (ETW providers, process tree, file integrity monitoring)
- macOS / Linux agents
- Mobile management (MDM integration)
- Threat intelligence enrichment of events
