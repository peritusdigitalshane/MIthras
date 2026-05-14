# Application Control — Audit → Enforce — Design

**Date:** 2026-05-14
**Status:** Approved
**Scope:** Windows v1 (modern Phase 2a NSSM PowerShell agent). Linux fapolicyd deferred to v2.

## Goal

Bring application allowlisting to feature-parity with the legacy bearer-token agent, then go further: a hands-off **audit → auto-promote → enforce** workflow that gives MSP operators a defensible Essential 8 ML3 control with minimal day-to-day touch.

The user's framing of the model:

> Set a device in audit mode. Leave it for a set period of time. It whitelists all applications during this time, and then we go into enforcement mode.

This spec turns that into a working feature, fixes the gap where the modern agent doesn't currently observe or enforce, and reshapes the existing UI for the audit-review flow.

## Why now

- The legacy agent (bearer-token `agent-api`) already pushes `wdac_discovered_apps` and pulls `/wdac-policy`. The new Phase 2a NSSM PowerShell agent (shipped 2026-05-13) doesn't, so customers on the modern agent currently have **no app-control telemetry at all**.
- The platform's existing schema is named `wdac_*` and the existing UI screens were built against it, so v1 commits to **WDAC** (Microsoft's current direction, kernel-level enforcement) rather than AppLocker (legacy, user-mode).
- App control is Essential 8 Mitigation #1. For an AU MSP this is the highest-leverage compliance capability the platform can offer.

## Constraints / non-goals

- **Heartbeat-poll for v1.** No new command channel (Phase 3 of agent modernisation is not started). Mode and rule changes propagate through the existing 60-second heartbeat. The response schema is designed so a future command channel can carry the same payload verbatim.
- **Windows only.** Linux (fapolicyd) is a v2 concern.
- **EXE + MSI only.** DLLs, scripts (.ps1/.vbs/.bat), and packaged (Store) apps are out of scope for v1 — separate WDAC rule channels each, each adds 10× the observation volume.
- **Silent block UX.** Standard Windows "blocked by your organization" message; no in-agent toast or request-access flow in v1.
- **No removal of the legacy `/wdac-policy` path.** Both agents read the same policy state during the migration window; the legacy GET endpoint stays until all customers are on the modern agent.

## Architecture

### Data flow

```
Admin                  Platform DB                  pg_cron       Modern Agent (Win)         WDAC
─────                  ───────────                  ───────       ──────────────────        ─────
Create rule set ───►   wdac_rule_sets
                       (audit_window_days=14,
                        auto_promote=true,
                        policy_version=1)

Assign to endpoint ─►  endpoint_rule_set_assignments
                       — trigger creates —►
                       endpoint_app_control_state
                       (audit_until=now+14d,
                        current_mode='audit')

                                                    ──── 60s heartbeat ─────►
                                                    ◄── app_control state ────
                                                         (mode, rules, version)

                                                                         Apply CIPolicy ───► WDAC kernel
                                                                         Tail CodeIntegrity log
                                                                         POST observed ───► wdac_discovered_apps
                                                                         POST blocks  ────► wdac_block_events

                       Hourly:
                       UPDATE state SET mode='enforce'
                       WHERE audit_until < now()
                         AND rs.auto_promote
                                                    ──── next heartbeat ─────►
                                                    ◄── new mode + rules ────
                                                                         Re-apply (enforce) ──► WDAC kernel
```

### Components (each independently testable)

| Component | Responsibility | Depends on |
|---|---|---|
| **DB migrations** | New columns on `wdac_rule_sets`, new tables, assignment triggers, `pg_cron` job, server-side `app_control_state_for_endpoint()` function | Existing wdac_* schema |
| **`agent-heartbeat` patch** | Calls state function, includes `app_control` block in heartbeat response | DB migrations |
| **`agent-app-control/observed` endpoint** | Accepts batch of observed apps from agent, upserts `wdac_discovered_apps` | DB |
| **`agent-app-control/blocked` endpoint** | Accepts batch of block events from agent, inserts `wdac_block_events` | DB |
| **Agent `WdacControl.psm1`** | Apply CIPolicy from heartbeat state, observe via CodeIntegrity event log, push observations + blocks | Existing agent runtime (Phase 2a) |
| **UI: rule set list rework** | Audit countdown, "Promote now" / "Extend audit" buttons, observed app counts | DB + existing `RuleSetsManager.tsx` / `ApplicationControl.tsx` |
| **UI: audit review screen** | Publisher grouping, bulk approve, suggested allowlist, generated-ruleset preview | DB |
| **UI: enforce monitoring screen** | Block-event stream, "Allow this app" / "Allow publisher" actions | New endpoint blocks data |
| **UI: per-endpoint Application Control tab** | Device-scoped state + observed + blocks + "Re-audit this device" | DB |

## Data model

### Schema notes (existing reality)

The current schema has two parallel WDAC paths. **This spec targets the modern path** (`wdac_rule_sets`); the legacy path (`wdac_policies` + `wdac_rules`) is preserved for backward compatibility with old bearer-token agents but is not extended by this spec.

- **Modern path:** `wdac_rule_sets` (with `mode IN ('audit','enforce')`) → `wdac_rule_set_rules` (actual rules) → assigned to endpoints via `endpoint_rule_set_assignments` or to groups via `group_rule_set_assignments`. This is what `ApplicationControl.tsx` + `RuleSetsManager.tsx` already drive.
- **Legacy path:** `wdac_policies.mode` → `wdac_rules.policy_id` → `endpoints.wdac_policy_id`. Already wired into legacy `agent-api`. Untouched by this spec.

The unit of audit / enforce in this spec is the **rule set**.

### New columns on `wdac_rule_sets`

```sql
ALTER TABLE public.wdac_rule_sets
  ADD COLUMN audit_window_days int NOT NULL DEFAULT 14,
  ADD COLUMN auto_promote bool NOT NULL DEFAULT true,
  ADD COLUMN policy_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN feature_enabled bool NOT NULL DEFAULT true;
```

- `audit_window_days` — how long new device assignments stay in audit. Admin-editable per rule set.
- `auto_promote` — if true, hourly `pg_cron` job flips the device's effective mode to `enforce` when `audit_until` passes.
- `policy_version` — bumps on any change to the rule set's rules. Agent compares against its last-applied version to decide whether to re-apply WDAC.
- `feature_enabled` — kill switch per rule set; agent treats state as `off` when false.

Trigger: bump `policy_version` on any insert/update/delete in `wdac_rule_set_rules` for that `rule_set_id`.

### New table: per-(endpoint, rule_set) state

```sql
CREATE TABLE public.endpoint_app_control_state (
  endpoint_id  uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  rule_set_id  uuid NOT NULL REFERENCES public.wdac_rule_sets(id) ON DELETE CASCADE,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  audit_until  timestamptz NOT NULL,
  current_mode text NOT NULL DEFAULT 'audit'
    CHECK (current_mode IN ('audit','enforce','off')),
  last_applied_version  bigint,
  last_applied_at       timestamptz,
  apply_failure_count   int NOT NULL DEFAULT 0,
  last_apply_error      text,
  PRIMARY KEY (endpoint_id, rule_set_id)
);

CREATE INDEX idx_eacs_audit_until
  ON public.endpoint_app_control_state (audit_until)
  WHERE current_mode = 'audit';
```

- Created automatically when an endpoint is assigned to a rule set — either directly (`endpoint_rule_set_assignments`) or transitively through a group (`group_rule_set_assignments`). Two triggers, one on each assignment table; both upsert a state row keyed by `(endpoint_id, rule_set_id)`.
- `audit_until = now() + (rs.audit_window_days * interval '1 day')` at row insert.
- `current_mode` is the **effective** mode for that device. Auto-promote flips this without touching `wdac_rule_sets.mode`. A "re-audit this device" admin action extends `audit_until` and resets `current_mode` to `audit`.
- `last_applied_version` lets the agent skip the WDAC apply call when nothing has changed.
- `apply_failure_count` + `last_apply_error` surface stuck devices to operators.
- When an assignment is removed, the corresponding state row is deleted (cascading); agent next heartbeat sees `mode: off` for that rule set.

### New table: block events

```sql
CREATE TABLE public.wdac_block_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint_id       uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  rule_set_id       uuid REFERENCES public.wdac_rule_sets(id) ON DELETE SET NULL,
  blocked_at        timestamptz NOT NULL,
  file_path         text NOT NULL,
  file_hash         text,
  file_name         text,
  publisher         text,
  user_name         text,
  parent_process    text,
  ingested_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wbe_org_time ON public.wdac_block_events (organization_id, blocked_at DESC);
CREATE INDEX idx_wbe_endpoint ON public.wdac_block_events (endpoint_id, blocked_at DESC);
```

`rule_set_id` is nullable (SET NULL on delete) so block-event history survives rule-set deletion. RLS mirrors `wdac_discovered_apps`: member-read, admin-acknowledge, super-admin-all.

### Server-side helper function

An endpoint can have multiple rule sets assigned (direct + group-inherited). The function returns one merged payload: `mode` is the **strictest** active mode across all the endpoint's rule sets (`enforce` beats `audit` beats `off`), and `rules` is the union of all rules from all enabled rule sets. `policy_version` is the hash of all underlying rule-set versions so the agent re-applies only when any of them changes.

```sql
CREATE FUNCTION public.app_control_state_for_endpoint(p_endpoint_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH active AS (
    SELECT s.rule_set_id, s.current_mode, s.audit_until, rs.policy_version
    FROM public.endpoint_app_control_state s
    JOIN public.wdac_rule_sets rs ON rs.id = s.rule_set_id
    WHERE s.endpoint_id = p_endpoint_id
      AND rs.feature_enabled
      AND s.current_mode <> 'off'
  )
  SELECT jsonb_build_object(
    'mode', COALESCE(
      (SELECT 'enforce' WHERE EXISTS (SELECT 1 FROM active WHERE current_mode = 'enforce')),
      (SELECT 'audit'   WHERE EXISTS (SELECT 1 FROM active WHERE current_mode = 'audit')),
      'off'
    ),
    'policy_version', (
      SELECT md5(string_agg(rule_set_id::text || ':' || policy_version::text, ',' ORDER BY rule_set_id))
      FROM active
    ),
    'audit_until', (SELECT min(audit_until) FROM active WHERE current_mode = 'audit'),
    'observation_required', true,
    'rule_sets', (
      SELECT jsonb_agg(jsonb_build_object('id', rule_set_id, 'mode', current_mode))
      FROM active
    ),
    'rules', (
      SELECT jsonb_agg(jsonb_build_object(
        'action',         r.action,
        'rule_type',      r.rule_type,
        'value',          r.value,
        'publisher_name', r.publisher_name,
        'product_name',   r.product_name,
        'file_version_min', r.file_version_min
      ))
      FROM public.wdac_rule_set_rules r
      WHERE r.rule_set_id IN (SELECT rule_set_id FROM active)
    )
  )
  FROM (SELECT 1) _ -- always produce one row
  WHERE EXISTS (SELECT 1 FROM active);
$$;
```

Returns `NULL` if the endpoint has no active rule-set assignment — agent treats that as `mode: off`.

### Auto-promote job

```sql
SELECT cron.schedule('app-control-auto-promote', '0 * * * *', $cron$
  UPDATE public.endpoint_app_control_state s
  SET    current_mode = 'enforce'
  FROM   public.wdac_rule_sets rs
  WHERE  rs.id = s.rule_set_id
    AND  s.current_mode = 'audit'
    AND  s.audit_until < now()
    AND  rs.auto_promote
    AND  rs.feature_enabled;
$cron$);
```

Runs hourly. Per-(device, rule_set) — promotes only the rows whose individual `audit_until` has passed.

## Agent side

### Module: `agent/runtime-powershell/modules/WdacControl.psm1`

```powershell
# Public entry — called by the service main loop after each successful heartbeat.
function Invoke-WdacControlSync {
    param([Parameter(Mandatory)] $State)
    # $State is the app_control block from heartbeat response, or $null

    if ($null -eq $State -or $State.mode -eq 'off') {
        Remove-PeritusManagedPolicy
        return
    }

    if ($State.policy_version -ne (Get-LastAppliedVersion)) {
        # One merged CIPolicy covers all rule sets assigned to this endpoint.
        # Peritus owns a single stable policy GUID per agent install so it never
        # collides with admin-deployed policies on the same device.
        $cipBytes = ConvertTo-CIPolicyBinary -Rules $State.rules -Mode $State.mode
        $apply    = Apply-CIPolicy -Bytes $cipBytes -PolicyGuid (Get-PeritusPolicyGuid)
        if ($apply.ok) {
            Set-LastAppliedVersion $State.policy_version
            Report-ApplySuccess $State.policy_version
        } else {
            Report-ApplyFailure $apply.error
        }
    }

    # Always collect telemetry regardless of mode
    $observed = Get-NewObservations    # tails CodeIntegrity 3076 + 3077 since last cursor
    if ($observed) { Push-Observations $observed }

    if ($State.mode -eq 'enforce') {
        $blocks = Get-NewBlockEvents   # CodeIntegrity 3077 only
        if ($blocks) { Push-BlockEvents $blocks }
    }
}
```

### Telemetry source

`Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational'`:

| Event ID | Meaning | Use |
|---|---|---|
| 3076 | "Code Integrity would have blocked" (audit mode) | Audit observations |
| 3077 | "Code Integrity blocked" (enforce mode) | Block events |
| 3089 | Signature info for events 3076/3077 | Enrich with signer/publisher |
| 3099 | Policy was loaded | Confirms successful apply |

Each event has: file path, Authenticode hash, signer subject + thumbprint, signature level. We don't need ETW or process auditing — CodeIntegrity gives us everything WDAC sees.

### Apply mechanism

1. `ConvertFrom-CIPolicy -XmlFilePath ...` produces a `.cip` binary.
2. Drop to `C:\Windows\System32\CodeIntegrity\CiPolicies\Active\{policy_guid}.cip`.
3. Refresh:
   - Win 11 / Server 2022+: `CiTool.exe --refresh-policy`
   - Win 10: requires reboot. Surface "reboot required" in `apply_failure_count`-adjacent state column.
4. Verify via event 3099. If absent within 10s, treat apply as failed and revert to prior `.cip`.

### State file

`C:\ProgramData\Peritus\WdacState.json` (mode 0600 equivalent — `Set-Acl` to local SYSTEM + admins only):

```json
{
  "peritus_policy_guid": "stable-guid-generated-at-install",
  "last_applied_version": "abcdef123456",
  "last_applied_at": "2026-05-14T08:00:00Z",
  "last_event_cursor": { "recordId": 1234, "logName": "Microsoft-Windows-CodeIntegrity/Operational" }
}
```

`peritus_policy_guid` is generated once at agent install and reused for the life of the install — it identifies the single merged CIPolicy file the agent owns on disk, distinct from any other WDAC policies the admin may deploy. `last_applied_version` is the merged hash returned by the heartbeat state function, not a per-rule-set version.

Lets `Invoke-WdacControlSync` be idempotent across agent restarts.

### Boot-loop guard

If 3 consecutive boots fail to confirm event 3099 within 60 seconds of agent start, revert to the prior `.cip` on disk and surface an alert. Without this, a bad rule generation could brick a fleet.

## Edge functions

### `agent-app-control/observed` (POST)

HMAC-authenticated like other agent endpoints. Body:

```json
{
  "since": "2026-05-14T08:00:00Z",
  "apps": [
    {
      "file_path":    "C:\\Program Files\\Slack\\slack.exe",
      "file_hash":    "ABC123...",
      "file_name":    "slack.exe",
      "product_name": "Slack",
      "publisher":    "CN=Slack Technologies, Inc., O=...",
      "file_version": "4.36.140",
      "first_seen":   "2026-05-14T08:01:23Z",
      "exec_count":   3
    }
  ]
}
```

Upsert into `wdac_discovered_apps` on `(endpoint_id, file_path, file_hash)`, summing `exec_count`, updating `last_seen_at`.

### `agent-app-control/blocked` (POST)

Same shape as observed but rows go into `wdac_block_events`. Each block row also includes `blocked_at`, `user_name`, `parent_process`.

### `agent-heartbeat` patch

Existing function adds:

```typescript
const { data: appControl } = await supabase.rpc(
  'app_control_state_for_endpoint',
  { p_endpoint_id: endpoint.id }
);
// ... include `app_control: appControl ?? { mode: 'off' }` in response
```

## UI changes

### Rule-set list (existing Application Control screen)

Each rule-set row gains a status pill. Numbers shown are aggregated across all devices assigned to the rule set:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Customer A workstations                                              │
│ 🟡 Audit · 8 / 14 days · 23 devices · 412 unique apps observed       │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  [Promote now]  [Extend audit]               │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ Customer B reception                                                 │
│ 🟢 Enforced · 12 devices · 17 blocks last 24h                        │
│                                       [Review blocks]  [Edit rules]  │
└──────────────────────────────────────────────────────────────────────┘
```

### Audit review screen

Replaces the flat `DiscoveredApps.tsx` flow. Apps grouped by publisher (Authenticode subject). Trust signals as small pills next to publisher name:

- 🟢 **Microsoft Corporation** — auto-pre-checked (suggested allowlist)
- 🟢 **Adobe Inc.** (verified Authenticode) — auto-pre-checked
- 🟡 **Unknown vendor (signed)** — needs review
- 🔴 **Unsigned** — needs review, fallback to hash rule

Per-publisher row expands to show individual apps with exec counts. Bulk actions per publisher group:

- **Allow all from this publisher** → one publisher rule covering all current and future products + versions
- **Allow specific product** → publisher + product rule
- **Allow exact version only** → hash rule (breaks on update; warn user)
- **Deny** → block rule

Right pane shows the generated ruleset preview (XML / human-readable view) so the operator sees what will actually be applied.

### Enforce monitoring screen

Live block-event stream similar to existing `endpoint_threats`. Per-row actions:

- **Allow this app for everyone** → adds a rule to the policy ruleset (rule_set), bumps `policy_version`
- **Allow publisher** → broader rule
- **Allow once for this device** → out of scope for v1 (no per-device rules); mark for v2

### Per-endpoint detail page

New tab "Application Control" on `/endpoints/<id>`:

- Current mode + audit countdown for this device
- Observed apps for this device (subset of policy-wide)
- Block events for this device (enforce mode)
- "Re-audit this device for N days" button → extends `audit_until` only for this row

### Essential 8 mapping

Existing Essential 8 page (per commit history) gets app-control coverage data wired in:

- Devices in enforce mode → ML3 credit for Mitigation #1
- Devices in audit mode → ML1 credit (monitoring without enforcement)
- Devices with no policy → 0 credit, surfaced as gap

## Rule generation priority

For each observed app, pick the **first** matching rule:

1. **Signed by trusted publisher (Microsoft, major vendor list)** → `publisher` rule using signer subject. Covers future versions automatically.
2. **Signed by other publisher** → `publisher` rule **scoped to that exact `product_name`**. Slightly tighter; still survives vendor updates.
3. **Unsigned but path is `C:\Program Files\*` or `C:\Program Files (x86)\*` or `C:\Windows\*`** → `path` rule. These dirs are admin-write-only by default.
4. **Unsigned, non-system path** → `hash` rule. Will break on update; surface in UI as "this app needs re-approval after update".

### Default-allow policy baseline

Every new policy is created with these allow rules pre-populated (admin can remove if they truly want to):

- Microsoft publisher (covers Defender, Windows core binaries)
- Path: `C:\Windows\*` excluding `C:\Windows\Temp`, `C:\Windows\Tasks`, `C:\Windows\PCHEALTH`
- Path: `C:\Program Files\*`, `C:\Program Files (x86)\*`

Without these, audit mode produces 5,000+ rows on day 1 and the operator drowns.

## Edge cases

| Case | Handling |
|---|---|
| Apply fails on agent | Revert to prior `.cip`, increment `apply_failure_count`, surface as endpoint health alert at 5+ |
| Device offline during policy update | Idempotent — applies on next heartbeat |
| Device removed from policy | Agent sees `mode: off` → unloads the Peritus-managed policy GUID (other admin-deployed WDAC policies untouched) |
| Boot-time policy bricks signing-server access | Boot-critical binaries covered by default baseline; 3-strikes boot-loop guard auto-reverts |
| Vendor releases signed update | Publisher rules auto-allow |
| Vendor key rotation | New publisher rule needed; surfaces as "new signer for known product" in audit |
| Audit noise from one device pollutes policy | All suggested rules reviewable before promote (when `auto_promote=false`); for auto-promote policies, unsigned non-standard-path apps require explicit approval before being allowed |
| Re-audit on existing enforce policy | Per-device `audit_until` extended; agent sees `mode: audit` for that device only |
| Block-loop on first enforce flip | UI banner warns "Promoting will affect 23 devices and would block N apps observed during audit" with the list, before user can click |

## Testing

### Unit (Pester, on agent module)

- Rule generation: given observed apps fixture → expected CIPolicy XML
- State machine: given heartbeat state + last applied version → correct apply/skip/revert decision
- CodeIntegrity event parsing: fixtures for 3076, 3077, 3089 → correct dispatch
- Idempotency: same state applied twice → no second apply

### Integration (replica VM with Windows test endpoint)

- Create policy with 5-min audit window, assign endpoint
- Execute test signed + unsigned binaries → verify `wdac_discovered_apps` populated
- Wait for `pg_cron` to flip mode → verify next heartbeat carries enforce + agent applies + `CiTool /list-policies` shows policy active
- Execute disallowed binary → verify it's blocked + lands in `wdac_block_events`
- Approve via UI → verify next heartbeat carries updated rules + binary now runs
- Restart agent → verify state file makes startup idempotent
- Force apply failure (corrupt XML) → verify rollback + alert

### Production safety / rollout

- **Feature flag** on `organizations.app_control_enabled bool` — start dark, enable per org as you onboard
- **Internal Peritus org first** — ~2 weeks of dogfooding before any customer
- **Default UI values:** `audit_window_days=30` (conservative; user can shorten), `auto_promote=true` with a clear banner "Audit auto-promotes 2026-MM-DD — cancel here"
- **Legacy agent coexistence:** legacy `/wdac-policy` GET remains; both agents read the same DB state; block streaming is modern-agent-only

## Phase split

| Phase | Scope | Effort |
|---|---|---|
| **Phase 1** | Schema migrations, `WdacControl.psm1` (apply + observe), `agent-app-control/observed` endpoint, heartbeat extension, basic UI countdown | ~2 weeks |
| **Phase 2** | `pg_cron` auto-promote job, audit review UX with publisher grouping + bulk approve, block events ingest, enforce monitoring UI | ~1.5 weeks |
| **Phase 3** | Per-endpoint Application Control tab, Essential 8 mapping wiring, generated-ruleset preview pane | ~1 week |
| **v2 (future)** | DLL / script / packaged-app coverage, Linux fapolicyd, request-access toast on agent | — |

Total: ~4.5 weeks for v1. Each phase ships independently — Phase 1 alone gives the modern agent parity with the legacy bearer-token agent.

## Open questions resolved during brainstorming

- **Engine:** WDAC (kernel-level, future-proof), not AppLocker
- **Promotion:** Timer-based with `auto_promote=true` default, per-device timer (not per-policy)
- **Transport:** Heartbeat poll (no command channel dependency)
- **Block UX:** Silent block + admin notification; request-access flow is a v2
- **File scope:** EXE + MSI for v1; DLL / scripts / packaged apps deferred

## Migration / backward compatibility

- Old PowerShell agents continue calling `/wdac-policy` GET and POST-ing to `/apps` — both endpoints stay.
- New endpoint paths (`/agent-app-control/observed`, `/agent-app-control/blocked`) are additive and require HMAC (Phase 1A plumbing).
- Existing `wdac_discovered_apps` rows from legacy agents are valid input to the audit review screen with no transformation.
- A device that switches from legacy to modern agent during an audit period keeps its `endpoint_app_control_state` row — only the source of observations changes.
