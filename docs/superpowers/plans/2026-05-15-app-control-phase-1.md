# App-Control Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the modern Phase 2a NSSM PowerShell agent to feature-parity with the legacy bearer-token agent for application-control: it must read the current per-device WDAC state from heartbeat, apply a merged CIPolicy via WDAC, stream observed apps (CodeIntegrity 3076/3077) back to the platform, and let an admin see a basic audit-countdown + "promote now" button in the existing Application Control screen.

**Architecture:** A new agent module `WdacControl.psm1` is called once per heartbeat. The `agent-heartbeat` edge function returns an `app_control` block computed by a new server-side function `app_control_state_for_endpoint()` that merges all rule sets assigned to the endpoint into one mode + rule list + version hash. The agent applies the merged ruleset as one Peritus-owned WDAC policy GUID, then drains `Microsoft-Windows-CodeIntegrity/Operational` events 3076/3077 since the last cursor and POSTs them to a new `agent-app-control` edge function that upserts into the existing `wdac_discovered_apps` table.

**Tech Stack:** PowerShell 5.1 + Pester 5.7.1 (agent), Deno + TypeScript (edge functions), Postgres 17 + RLS (database), React + TanStack Query + shadcn/ui (frontend).

**Spec:** [`docs/superpowers/specs/2026-05-14-app-control-design.md`](../specs/2026-05-14-app-control-design.md)

**Out of scope (Phase 2 or later):**
- `pg_cron` auto-promote job
- `agent-app-control/blocked` ingest endpoint (block_events ingest)
- Audit review UX (publisher grouping, bulk approve)
- Enforce monitoring screen
- Per-endpoint Application Control tab
- DLL / script / packaged-app coverage
- Linux fapolicyd

---

## File map

### Created

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260515110000_wdac_rule_set_columns.sql` | Add `audit_window_days`, `auto_promote`, `policy_version`, `feature_enabled` to `wdac_rule_sets` |
| `supabase/migrations/20260515110100_endpoint_app_control_state.sql` | New table tracking per-(endpoint, rule_set) audit window + applied version |
| `supabase/migrations/20260515110200_wdac_block_events.sql` | New table for enforce-mode block events (ingest endpoint is Phase 2, table is created now) |
| `supabase/migrations/20260515110300_app_control_assignment_triggers.sql` | Triggers on `endpoint_rule_set_assignments` and `group_rule_set_assignments` to maintain `endpoint_app_control_state` rows |
| `supabase/migrations/20260515110400_app_control_policy_version_trigger.sql` | Bump `wdac_rule_sets.policy_version` on any change to `wdac_rule_set_rules` |
| `supabase/migrations/20260515110500_app_control_state_function.sql` | Server-side `public.app_control_state_for_endpoint(p_endpoint_id uuid) RETURNS jsonb` |
| `supabase/functions/agent-app-control/index.ts` | New edge function: `POST /agent-app-control/observed` |
| `agent/runtime-powershell/lib/WdacControl.psm1` | Agent module: apply CIPolicy, observe CodeIntegrity events, push observations |
| `agent/runtime-powershell/tests/WdacControl.Tests.ps1` | Pester tests for `WdacControl.psm1` |
| `agent/runtime-powershell/testdata/codeintegrity-3076.xml` | Saved event fixture (audit) |
| `agent/runtime-powershell/testdata/codeintegrity-3077.xml` | Saved event fixture (block) |
| `src/components/security/RuleSetAuditCountdown.tsx` | New row component: audit progress bar + "Promote now" / "Extend audit" buttons |

### Modified

| Path | Change |
|---|---|
| `supabase/functions/agent-heartbeat/index.ts` | After endpoint lookup, call `app_control_state_for_endpoint()` and include result as `app_control` field in response |
| `supabase/config.toml` | Register `agent-app-control` function with `verify_jwt = false` |
| `agent/runtime-powershell/peritus-secure-agent.ps1` | Import `WdacControl.psm1`; call `Invoke-WdacControlSync` after each successful heartbeat |
| `agent/runtime-powershell/lib/ApiClient.psm1` | Add `Invoke-AgentAppControlObserved` helper that POSTs observation batches with HMAC headers |
| `agent/runtime-powershell/agent.version` | Bump from `0.2.0` to `0.3.0` |
| `src/hooks/useWdac.ts` | Extend `useWdacRuleSets` to include new columns (`audit_window_days`, `auto_promote`, `policy_version`); add `useRuleSetAuditSummary(ruleSetId)` |
| `src/components/security/ApplicationControl.tsx` | Render `<RuleSetAuditCountdown>` on each rule-set row |

### Reference (read-only)

- `agent/contracts/hmac-canonicalization.md` — HMAC signing input format
- `supabase/functions/_shared/hmac.ts` — HMAC verify (TypeScript)
- `agent/runtime-powershell/lib/HmacAuth.psm1` — HMAC sign (PowerShell)
- `supabase/functions/agent-heartbeat/index.ts` (existing) — pattern for HMAC-authed agent endpoint

---

## Task list

### Task 1: Feature branch

**Files:** none (branch creation)

- [ ] **Step 1: Create branch**

```bash
git checkout -b agent/phase-2b-app-control
git log -1 --oneline
```

Expected: shows the most recent commit on whatever base branch (`agent/phase-1-linux-go` or main). Confirm before proceeding.

- [ ] **Step 2: Verify clean working tree**

```bash
git status --short
```

Expected: empty output.

---

### Task 2: Migration A — column additions on `wdac_rule_sets`

**Files:**
- Create: `supabase/migrations/20260515110000_wdac_rule_set_columns.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260515110000_wdac_rule_set_columns.sql
-- Add audit-window, auto-promote, policy_version, feature_enabled columns to wdac_rule_sets.
-- Idempotent: each ADD COLUMN uses IF NOT EXISTS.

ALTER TABLE public.wdac_rule_sets
  ADD COLUMN IF NOT EXISTS audit_window_days int  NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS auto_promote      bool NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS policy_version    bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS feature_enabled   bool NOT NULL DEFAULT true;

COMMENT ON COLUMN public.wdac_rule_sets.audit_window_days IS
  'How many days a newly-assigned endpoint stays in audit mode before auto-promote.';
COMMENT ON COLUMN public.wdac_rule_sets.auto_promote IS
  'If true, hourly pg_cron job flips per-device current_mode to enforce when audit_until passes.';
COMMENT ON COLUMN public.wdac_rule_sets.policy_version IS
  'Bumped on any change to rules within this set. Agent compares to last_applied_version.';
COMMENT ON COLUMN public.wdac_rule_sets.feature_enabled IS
  'Kill switch — when false, agent treats devices on this rule set as mode=off.';
```

- [ ] **Step 2: Apply to replica VM**

```bash
scp supabase/migrations/20260515110000_wdac_rule_set_columns.sql itadmin@192.168.99.143:/tmp/m.sql
ssh itadmin@192.168.99.143 'sudo docker exec -i supabase-db psql -U postgres -d postgres < /tmp/m.sql && rm /tmp/m.sql'
```

Expected: `ALTER TABLE` echoed.

- [ ] **Step 3: Verify columns exist**

```bash
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres -c "\d public.wdac_rule_sets"'
```

Expected: output includes `audit_window_days`, `auto_promote`, `policy_version`, `feature_enabled`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260515110000_wdac_rule_set_columns.sql
git commit -m "feat(db): add audit window + version columns to wdac_rule_sets"
```

---

### Task 3: Migration B — `endpoint_app_control_state` table

**Files:**
- Create: `supabase/migrations/20260515110100_endpoint_app_control_state.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260515110100_endpoint_app_control_state.sql
-- Per-(endpoint, rule_set) state. One row per endpoint-rule_set assignment.

CREATE TABLE IF NOT EXISTS public.endpoint_app_control_state (
  endpoint_id  uuid NOT NULL REFERENCES public.endpoints(id)        ON DELETE CASCADE,
  rule_set_id  uuid NOT NULL REFERENCES public.wdac_rule_sets(id)   ON DELETE CASCADE,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  audit_until  timestamptz NOT NULL,
  current_mode text NOT NULL DEFAULT 'audit'
    CHECK (current_mode IN ('audit','enforce','off')),
  last_applied_version  text,
  last_applied_at       timestamptz,
  apply_failure_count   int NOT NULL DEFAULT 0,
  last_apply_error      text,
  PRIMARY KEY (endpoint_id, rule_set_id)
);

CREATE INDEX IF NOT EXISTS idx_eacs_audit_until
  ON public.endpoint_app_control_state (audit_until)
  WHERE current_mode = 'audit';

ALTER TABLE public.endpoint_app_control_state ENABLE ROW LEVEL SECURITY;

-- Members of the org owning the endpoint may read.
CREATE POLICY "Members read endpoint_app_control_state"
  ON public.endpoint_app_control_state FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.endpoints e
    WHERE e.id = endpoint_app_control_state.endpoint_id
      AND public.is_member_of_org(auth.uid(), e.organization_id)
  ));

-- Admins of the org may update (for "Promote now" / "Extend audit").
CREATE POLICY "Admins update endpoint_app_control_state"
  ON public.endpoint_app_control_state FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.endpoints e
    WHERE e.id = endpoint_app_control_state.endpoint_id
      AND public.is_admin_of_org(auth.uid(), e.organization_id)
  ));

-- Super-admin all.
CREATE POLICY "Super admins manage endpoint_app_control_state"
  ON public.endpoint_app_control_state FOR ALL
  USING (public.is_super_admin(auth.uid()));
```

- [ ] **Step 2: Apply + verify**

```bash
scp supabase/migrations/20260515110100_endpoint_app_control_state.sql itadmin@192.168.99.143:/tmp/m.sql
ssh itadmin@192.168.99.143 'sudo docker exec -i supabase-db psql -U postgres -d postgres < /tmp/m.sql && rm /tmp/m.sql'
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres -c "\d public.endpoint_app_control_state"'
```

Expected: table description with the 9 columns and primary key.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260515110100_endpoint_app_control_state.sql
git commit -m "feat(db): endpoint_app_control_state table + RLS"
```

---

### Task 4: Migration C — `wdac_block_events` table

**Files:**
- Create: `supabase/migrations/20260515110200_wdac_block_events.sql`

The ingest endpoint for this table is Phase 2. We create the table now so the schema is settled.

- [ ] **Step 1: Write migration**

```sql
-- 20260515110200_wdac_block_events.sql
-- Append-only log of enforce-mode block events from agents.

CREATE TABLE IF NOT EXISTS public.wdac_block_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  endpoint_id     uuid NOT NULL REFERENCES public.endpoints(id)      ON DELETE CASCADE,
  rule_set_id     uuid REFERENCES public.wdac_rule_sets(id)          ON DELETE SET NULL,
  blocked_at      timestamptz NOT NULL,
  file_path       text NOT NULL,
  file_hash       text,
  file_name       text,
  publisher       text,
  user_name       text,
  parent_process  text,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wbe_org_time      ON public.wdac_block_events (organization_id, blocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_wbe_endpoint_time ON public.wdac_block_events (endpoint_id, blocked_at DESC);

ALTER TABLE public.wdac_block_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read wdac_block_events"
  ON public.wdac_block_events FOR SELECT
  USING (public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins manage wdac_block_events"
  ON public.wdac_block_events FOR ALL
  USING (public.is_super_admin(auth.uid()));
```

- [ ] **Step 2: Apply + verify**

```bash
scp supabase/migrations/20260515110200_wdac_block_events.sql itadmin@192.168.99.143:/tmp/m.sql
ssh itadmin@192.168.99.143 'sudo docker exec -i supabase-db psql -U postgres -d postgres < /tmp/m.sql && rm /tmp/m.sql'
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres -c "\d public.wdac_block_events"'
```

Expected: table with 12 columns, RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260515110200_wdac_block_events.sql
git commit -m "feat(db): wdac_block_events table (Phase 2 will add ingest)"
```

---

### Task 5: Migration D — assignment triggers

**Files:**
- Create: `supabase/migrations/20260515110300_app_control_assignment_triggers.sql`

When an endpoint is assigned to a rule set (directly or via a group), upsert a state row keyed by `(endpoint_id, rule_set_id)` with `audit_until = now() + rule_set.audit_window_days`.

- [ ] **Step 1: Write migration**

```sql
-- 20260515110300_app_control_assignment_triggers.sql
-- When an endpoint becomes assigned to a rule set (direct or via group),
-- ensure an endpoint_app_control_state row exists.

CREATE OR REPLACE FUNCTION public.upsert_app_control_state_for_endpoint_rule_set(
  p_endpoint_id uuid,
  p_rule_set_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_days int;
BEGIN
  SELECT audit_window_days INTO v_window_days
  FROM public.wdac_rule_sets WHERE id = p_rule_set_id;
  IF v_window_days IS NULL THEN
    -- rule set vanished concurrently; do nothing
    RETURN;
  END IF;

  INSERT INTO public.endpoint_app_control_state (endpoint_id, rule_set_id, audit_until, current_mode)
  VALUES (p_endpoint_id, p_rule_set_id, now() + (v_window_days || ' days')::interval, 'audit')
  ON CONFLICT (endpoint_id, rule_set_id) DO NOTHING;
END;
$$;

-- Trigger A: direct endpoint→rule_set assignment.
CREATE OR REPLACE FUNCTION public.trg_endpoint_rule_set_assignment_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.upsert_app_control_state_for_endpoint_rule_set(NEW.endpoint_id, NEW.rule_set_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_endpoint_rule_set_assignment_state ON public.endpoint_rule_set_assignments;
CREATE TRIGGER trg_endpoint_rule_set_assignment_state
  AFTER INSERT ON public.endpoint_rule_set_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_endpoint_rule_set_assignment_state();

-- Trigger B: group→rule_set assignment. Expand to every endpoint in the group.
CREATE OR REPLACE FUNCTION public.trg_group_rule_set_assignment_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_endpoint_id uuid;
BEGIN
  FOR v_endpoint_id IN
    SELECT endpoint_id FROM public.endpoint_group_memberships WHERE group_id = NEW.group_id
  LOOP
    PERFORM public.upsert_app_control_state_for_endpoint_rule_set(v_endpoint_id, NEW.rule_set_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_rule_set_assignment_state ON public.group_rule_set_assignments;
CREATE TRIGGER trg_group_rule_set_assignment_state
  AFTER INSERT ON public.group_rule_set_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_group_rule_set_assignment_state();

-- Trigger C: when an endpoint joins a group, expand to all rule sets assigned to that group.
CREATE OR REPLACE FUNCTION public.trg_endpoint_group_membership_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rule_set_id uuid;
BEGIN
  FOR v_rule_set_id IN
    SELECT rule_set_id FROM public.group_rule_set_assignments WHERE group_id = NEW.group_id
  LOOP
    PERFORM public.upsert_app_control_state_for_endpoint_rule_set(NEW.endpoint_id, v_rule_set_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_endpoint_group_membership_state ON public.endpoint_group_memberships;
CREATE TRIGGER trg_endpoint_group_membership_state
  AFTER INSERT ON public.endpoint_group_memberships
  FOR EACH ROW EXECUTE FUNCTION public.trg_endpoint_group_membership_state();
```

- [ ] **Step 2: Apply + verify**

```bash
scp supabase/migrations/20260515110300_app_control_assignment_triggers.sql itadmin@192.168.99.143:/tmp/m.sql
ssh itadmin@192.168.99.143 'sudo docker exec -i supabase-db psql -U postgres -d postgres < /tmp/m.sql && rm /tmp/m.sql'
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres -c "\dft public.trg_endpoint_rule_set_assignment_state"'
```

Expected: the trigger function is listed.

- [ ] **Step 3: Smoke-test trigger behavior**

Create a temporary rule set, assign an endpoint, verify a state row appears.

```bash
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres <<SQL
DO $$
DECLARE v_org uuid; v_endpoint uuid; v_rule_set uuid;
BEGIN
  SELECT organization_id, id INTO v_org, v_endpoint FROM public.endpoints LIMIT 1;
  INSERT INTO public.wdac_rule_sets (organization_id, name) VALUES (v_org, "trigger_test_" || gen_random_uuid()::text) RETURNING id INTO v_rule_set;
  INSERT INTO public.endpoint_rule_set_assignments (endpoint_id, rule_set_id) VALUES (v_endpoint, v_rule_set);
  PERFORM 1 FROM public.endpoint_app_control_state WHERE endpoint_id = v_endpoint AND rule_set_id = v_rule_set;
  IF NOT FOUND THEN RAISE EXCEPTION "trigger did not create state row"; END IF;
  DELETE FROM public.endpoint_rule_set_assignments WHERE rule_set_id = v_rule_set;
  DELETE FROM public.wdac_rule_sets WHERE id = v_rule_set;
  RAISE NOTICE "trigger OK";
END $$;
SQL'
```

Expected output: `NOTICE: trigger OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260515110300_app_control_assignment_triggers.sql
git commit -m "feat(db): triggers to maintain endpoint_app_control_state"
```

---

### Task 6: Migration E — `policy_version` bump trigger

**Files:**
- Create: `supabase/migrations/20260515110400_app_control_policy_version_trigger.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260515110400_app_control_policy_version_trigger.sql
-- Bump wdac_rule_sets.policy_version whenever a rule in wdac_rule_set_rules changes.

CREATE OR REPLACE FUNCTION public.trg_bump_rule_set_policy_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_target uuid;
BEGIN
  v_target := COALESCE(NEW.rule_set_id, OLD.rule_set_id);
  UPDATE public.wdac_rule_sets
     SET policy_version = policy_version + 1,
         updated_at     = now()
   WHERE id = v_target;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_rule_set_policy_version ON public.wdac_rule_set_rules;
CREATE TRIGGER trg_bump_rule_set_policy_version
  AFTER INSERT OR UPDATE OR DELETE ON public.wdac_rule_set_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_bump_rule_set_policy_version();
```

- [ ] **Step 2: Apply + verify with quick smoke test**

```bash
scp supabase/migrations/20260515110400_app_control_policy_version_trigger.sql itadmin@192.168.99.143:/tmp/m.sql
ssh itadmin@192.168.99.143 'sudo docker exec -i supabase-db psql -U postgres -d postgres < /tmp/m.sql && rm /tmp/m.sql'
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres <<SQL
DO $$
DECLARE v_org uuid; v_rs uuid; v_v1 bigint; v_v2 bigint;
BEGIN
  SELECT organization_id INTO v_org FROM public.endpoints LIMIT 1;
  INSERT INTO public.wdac_rule_sets (organization_id, name) VALUES (v_org, "vbump_" || gen_random_uuid()::text) RETURNING id INTO v_rs;
  SELECT policy_version INTO v_v1 FROM public.wdac_rule_sets WHERE id = v_rs;
  INSERT INTO public.wdac_rule_set_rules (rule_set_id, rule_type, action, value)
    VALUES (v_rs, "publisher", "allow", "CN=Test");
  SELECT policy_version INTO v_v2 FROM public.wdac_rule_sets WHERE id = v_rs;
  IF v_v2 <> v_v1 + 1 THEN RAISE EXCEPTION "policy_version did not bump: % -> %", v_v1, v_v2; END IF;
  DELETE FROM public.wdac_rule_sets WHERE id = v_rs;
  RAISE NOTICE "version bump OK";
END $$;
SQL'
```

Expected: `NOTICE: version bump OK`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260515110400_app_control_policy_version_trigger.sql
git commit -m "feat(db): bump policy_version on rule changes"
```

---

### Task 7: Migration F — server-side state function

**Files:**
- Create: `supabase/migrations/20260515110500_app_control_state_function.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260515110500_app_control_state_function.sql
-- Returns a single jsonb merging all active rule-set assignments for an endpoint.
-- mode = strictest active mode (enforce > audit > off)
-- policy_version = stable hash of (rule_set_id, policy_version) pairs

CREATE OR REPLACE FUNCTION public.app_control_state_for_endpoint(p_endpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH active AS (
    SELECT s.rule_set_id, s.current_mode, s.audit_until, rs.policy_version
    FROM public.endpoint_app_control_state s
    JOIN public.wdac_rule_sets rs ON rs.id = s.rule_set_id
    WHERE s.endpoint_id = p_endpoint_id
      AND rs.feature_enabled
      AND s.current_mode <> 'off'
  ),
  merged AS (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM active WHERE current_mode = 'enforce') THEN 'enforce'
        WHEN EXISTS (SELECT 1 FROM active WHERE current_mode = 'audit')   THEN 'audit'
        ELSE 'off'
      END                                                                   AS mode,
      md5(COALESCE(string_agg(rule_set_id::text || ':' || policy_version::text, ',' ORDER BY rule_set_id), '')) AS pv,
      (SELECT min(audit_until) FROM active WHERE current_mode = 'audit')    AS audit_until,
      (SELECT jsonb_agg(jsonb_build_object('id', rule_set_id, 'mode', current_mode)) FROM active) AS rule_sets,
      (SELECT jsonb_agg(jsonb_build_object(
          'action',         r.action,
          'rule_type',      r.rule_type,
          'value',          r.value,
          'publisher_name', r.publisher_name,
          'product_name',   r.product_name,
          'file_version_min', r.file_version_min
        ))
        FROM public.wdac_rule_set_rules r
        WHERE r.rule_set_id IN (SELECT rule_set_id FROM active)
      )                                                                     AS rules
    FROM active
  )
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM active) THEN
      jsonb_build_object(
        'mode',                 mode,
        'policy_version',       pv,
        'audit_until',          audit_until,
        'observation_required', true,
        'rule_sets',            rule_sets,
        'rules',                COALESCE(rules, '[]'::jsonb)
      )
    ELSE NULL END
  INTO v_result
  FROM merged;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_control_state_for_endpoint(uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Apply + verify**

```bash
scp supabase/migrations/20260515110500_app_control_state_function.sql itadmin@192.168.99.143:/tmp/m.sql
ssh itadmin@192.168.99.143 'sudo docker exec -i supabase-db psql -U postgres -d postgres < /tmp/m.sql && rm /tmp/m.sql'
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres -c "SELECT public.app_control_state_for_endpoint(id) FROM public.endpoints LIMIT 1;"'
```

Expected: returns either `NULL` (endpoint has no assignment yet) or a jsonb with `mode`, `policy_version`, `rules`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260515110500_app_control_state_function.sql
git commit -m "feat(db): app_control_state_for_endpoint() helper function"
```

---

### Task 8: Patch `agent-heartbeat` to return app_control state

**Files:**
- Modify: `supabase/functions/agent-heartbeat/index.ts`

- [ ] **Step 1: Edit the heartbeat function**

Find the existing block that ends with:

```typescript
    // Phase 3 will populate commands here from agent_commands table.
    return jsonResponse({ commands: [], next_check_in: NEXT_CHECK_IN_SECONDS }, 200, origin);
});
```

Replace with:

```typescript
    // App-control state: one merged payload across all rule sets assigned to this endpoint.
    let appControl: unknown = null;
    {
        const { data, error: acErr } = await supabase.rpc('app_control_state_for_endpoint', { p_endpoint_id: endpoint.id });
        if (acErr) console.error('app_control_state_for_endpoint', acErr);
        else appControl = data ?? { mode: 'off' };
    }

    // Phase 3 will populate commands here from agent_commands table.
    return jsonResponse({
        commands: [],
        next_check_in: NEXT_CHECK_IN_SECONDS,
        app_control: appControl,
    }, 200, origin);
});
```

- [ ] **Step 2: Deploy to replica VM**

```bash
scp supabase/functions/agent-heartbeat/index.ts itadmin@192.168.99.143:/tmp/index.ts
ssh itadmin@192.168.99.143 'sudo mv /tmp/index.ts /opt/peritus-functions/agent-heartbeat/index.ts && sudo chown root:root /opt/peritus-functions/agent-heartbeat/index.ts && cd /opt/peritus-supabase && sudo docker compose restart functions'
```

Expected: container restarts cleanly.

- [ ] **Step 3: Smoke-test from existing Linux agent**

The Linux agent on the replica VM heartbeats every 60s. Wait for one cycle then inspect the response by re-issuing the same call manually with a fresh signature — easier: read recent function logs.

```bash
ssh itadmin@192.168.99.143 'sleep 65 && sudo docker logs supabase-edge-functions --since 90s 2>&1 | grep -iE "app_control|error" | head -10'
```

Expected: no `app_control_state_for_endpoint` errors. (The Linux agent ignores unknown response fields, so this is non-disruptive.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/agent-heartbeat/index.ts
git commit -m "feat(edge): heartbeat returns app_control state per endpoint"
```

---

### Task 9: Edge function — `agent-app-control` (observed-only for Phase 1)

**Files:**
- Create: `supabase/functions/agent-app-control/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the function**

```typescript
// POST /functions/v1/agent-app-control/observed
// Headers: X-Agent-Id, X-Timestamp, X-Signature
// Body:
//   {
//     "since": "ISO-8601",
//     "apps": [
//       { file_path, file_hash?, file_name?, product_name?, publisher?, file_version?, first_seen, exec_count }
//     ]
//   }
// Response 200: { upserted: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { extractHmacRequest, verifyHmacRequest } from "../_shared/hmac.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type ObservedApp = {
    file_path: string;
    file_hash?: string;
    file_name?: string;
    product_name?: string;
    publisher?: string;
    file_version?: string;
    first_seen?: string;
    exec_count?: number;
};

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

    if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const url = new URL(request.url);
    // Path inside the function ends with /observed
    if (!url.pathname.endsWith("/observed")) {
        return jsonResponse({ error: "not_found" }, 404, origin);
    }

    const hmacReq = await extractHmacRequest(request);
    if (!hmacReq) return jsonResponse({ error: "missing_hmac_headers" }, 401, origin);

    const { data: endpoint, error: lookupErr } = await supabase
        .from("endpoints")
        .select("id, organization_id, agent_secret, is_active")
        .eq("id", hmacReq.agentId)
        .maybeSingle();
    if (lookupErr) {
        console.error("endpoint lookup failed", lookupErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!endpoint || !endpoint.agent_secret || !endpoint.is_active) {
        return jsonResponse({ error: "agent_unknown_or_inactive" }, 401, origin);
    }

    const verification = await verifyHmacRequest(hmacReq, endpoint.agent_secret);
    if (!verification.ok) {
        return jsonResponse({ error: "hmac_invalid", reason: verification.reason }, 401, origin);
    }

    let body: { since?: string; apps?: ObservedApp[] };
    try {
        body = JSON.parse(hmacReq.rawBody || "{}");
    } catch {
        return jsonResponse({ error: "invalid_json" }, 400, origin);
    }

    const apps = Array.isArray(body.apps) ? body.apps : [];
    if (apps.length === 0) {
        return jsonResponse({ upserted: 0 }, 200, origin);
    }

    const rows = apps.map(a => ({
        organization_id:  endpoint.organization_id,
        endpoint_id:      endpoint.id,
        file_name:        a.file_name ?? a.file_path.split(/[\\/]/).pop() ?? "unknown",
        file_path:        a.file_path,
        file_hash:        a.file_hash ?? "",
        publisher:        a.publisher ?? null,
        product_name:     a.product_name ?? null,
        file_version:     a.file_version ?? null,
        discovery_source: "event_log",
        first_seen_at:    a.first_seen ?? new Date().toISOString(),
        last_seen_at:     new Date().toISOString(),
        execution_count:  Math.max(1, a.exec_count ?? 1),
    }));

    // Existing UNIQUE(endpoint_id, file_path, file_hash) handles dedup.
    // We can't trivially sum execution_count across batches without an RPC, so
    // for v1 each batch's count is an "increment" call via upsert with a
    // post-step update. Keep it simple: upsert with ignoreDuplicates=false so
    // the row's last_seen_at + execution_count are overwritten by the latest
    // batch; the agent already accumulates exec_count across observations
    // since the last cursor.
    const { error: upsertErr, count } = await supabase
        .from("wdac_discovered_apps")
        .upsert(rows, { onConflict: "endpoint_id,file_path,file_hash", count: "exact" });
    if (upsertErr) {
        console.error("wdac_discovered_apps upsert", upsertErr);
        return jsonResponse({ error: "upsert_failed", details: upsertErr.message }, 500, origin);
    }

    return jsonResponse({ upserted: count ?? rows.length }, 200, origin);
});
```

- [ ] **Step 2: Register in `supabase/config.toml`**

Append (or insert in the existing `[functions]` block, matching the pattern used for `agent-heartbeat`):

```toml
[functions.agent-app-control]
verify_jwt = false
```

- [ ] **Step 3: Deploy to replica VM**

```bash
ssh itadmin@192.168.99.143 'sudo mkdir -p /opt/peritus-functions/agent-app-control'
scp supabase/functions/agent-app-control/index.ts itadmin@192.168.99.143:/tmp/index.ts
ssh itadmin@192.168.99.143 'sudo mv /tmp/index.ts /opt/peritus-functions/agent-app-control/index.ts && sudo chown -R root:root /opt/peritus-functions/agent-app-control && cd /opt/peritus-supabase && sudo docker compose restart functions'
```

- [ ] **Step 4: Smoke-test with curl**

```bash
ssh itadmin@192.168.99.143 'curl -s -w "\nHTTP %{http_code}\n" -X POST "http://apidev.peritusdigital.com.au/functions/v1/agent-app-control/observed" -H "content-type: application/json" -d "{}"'
```

Expected: `HTTP 401` with `missing_hmac_headers` — confirms the function is loaded and is correctly rejecting unauthenticated calls. (A full HMAC-signed test happens in Task 14.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/agent-app-control/index.ts supabase/config.toml
git commit -m "feat(edge): agent-app-control/observed for WDAC discovered apps"
```

---

### Task 10: WdacControl.psm1 — Pester scaffold

**Files:**
- Create: `agent/runtime-powershell/tests/WdacControl.Tests.ps1`
- Create: `agent/runtime-powershell/lib/WdacControl.psm1` (empty stub)
- Create: `agent/runtime-powershell/testdata/codeintegrity-3076.xml`
- Create: `agent/runtime-powershell/testdata/codeintegrity-3077.xml`

- [ ] **Step 1: Empty module stub**

Create `agent/runtime-powershell/lib/WdacControl.psm1` containing only:

```powershell
# WdacControl.psm1 — WDAC application-control agent module (Phase 1).
# Functions are added by subsequent tasks.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
```

- [ ] **Step 2: Add CodeIntegrity 3076 fixture**

`agent/runtime-powershell/testdata/codeintegrity-3076.xml` — this is a captured event-XML payload from a real Win 11 host:

```xml
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'>
  <System>
    <Provider Name='Microsoft-Windows-CodeIntegrity' Guid='{4ee76bd8-3cf4-44a0-a0ac-3937643e37a3}'/>
    <EventID>3076</EventID>
    <Version>0</Version>
    <Level>3</Level>
    <Task>22</Task>
    <Opcode>0</Opcode>
    <Keywords>0x8000000000000000</Keywords>
    <TimeCreated SystemTime='2026-05-15T08:00:00.0000000Z'/>
    <EventRecordID>12345</EventRecordID>
    <Channel>Microsoft-Windows-CodeIntegrity/Operational</Channel>
    <Computer>TEST-HOST</Computer>
    <Security UserID='S-1-5-18'/>
  </System>
  <EventData>
    <Data Name='File Name'>\Device\HarddiskVolume3\Users\test\notepad-plus-plus.exe</Data>
    <Data Name='Process Name'>\Device\HarddiskVolume3\Users\test\notepad-plus-plus.exe</Data>
    <Data Name='Requested Signing Level'>8</Data>
    <Data Name='Validated Signing Level'>8</Data>
    <Data Name='Status'>0xC000007B</Data>
    <Data Name='SHA1 Hash'>FFEEDD0011223344556677889900AABBCCDDEEFF</Data>
    <Data Name='SHA256 Hash'>112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00</Data>
    <Data Name='USN'>0</Data>
  </EventData>
</Event>
```

- [ ] **Step 3: Add CodeIntegrity 3077 fixture**

`agent/runtime-powershell/testdata/codeintegrity-3077.xml`:

```xml
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'>
  <System>
    <Provider Name='Microsoft-Windows-CodeIntegrity' Guid='{4ee76bd8-3cf4-44a0-a0ac-3937643e37a3}'/>
    <EventID>3077</EventID>
    <Version>0</Version>
    <Level>2</Level>
    <Task>22</Task>
    <Opcode>0</Opcode>
    <Keywords>0x8000000000000000</Keywords>
    <TimeCreated SystemTime='2026-05-15T08:01:00.0000000Z'/>
    <EventRecordID>12346</EventRecordID>
    <Channel>Microsoft-Windows-CodeIntegrity/Operational</Channel>
    <Computer>TEST-HOST</Computer>
    <Security UserID='S-1-5-18'/>
  </System>
  <EventData>
    <Data Name='File Name'>\Device\HarddiskVolume3\temp\unsigned.exe</Data>
    <Data Name='Process Name'>\Device\HarddiskVolume3\Windows\System32\cmd.exe</Data>
    <Data Name='Requested Signing Level'>0</Data>
    <Data Name='Validated Signing Level'>0</Data>
    <Data Name='Status'>0xC0E90001</Data>
    <Data Name='SHA1 Hash'>AABBCCDDEEFF00112233445566778899AABBCCDD</Data>
    <Data Name='SHA256 Hash'>00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF</Data>
    <Data Name='USN'>0</Data>
    <Data Name='User Name'>TEST-HOST\jdoe</Data>
  </EventData>
</Event>
```

- [ ] **Step 4: Tests file scaffold**

```powershell
# agent/runtime-powershell/tests/WdacControl.Tests.ps1
# Pester v5

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $script:moduleRoot 'lib/WdacControl.psm1') -Force
    $script:testdataRoot = Join-Path $script:moduleRoot 'testdata'
}

Describe 'WdacControl module load' {
    It 'imports without error' {
        (Get-Module WdacControl) | Should -Not -BeNullOrEmpty
    }
}
```

- [ ] **Step 5: Run scaffold tests**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1
```

Expected: 1 passing test ("imports without error").

- [ ] **Step 6: Commit**

```bash
git add agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1 agent/runtime-powershell/testdata/codeintegrity-3076.xml agent/runtime-powershell/testdata/codeintegrity-3077.xml
git commit -m "feat(agent): WdacControl module scaffold + event fixtures"
```

---

### Task 11: WdacControl — `ConvertFrom-CodeIntegrityEvent` (parser)

Takes an XML element and returns a hashtable of the fields we care about.

**Files:**
- Modify: `agent/runtime-powershell/lib/WdacControl.psm1`
- Modify: `agent/runtime-powershell/tests/WdacControl.Tests.ps1`

- [ ] **Step 1: Write failing tests**

Append to `tests/WdacControl.Tests.ps1`:

```powershell
Describe 'ConvertFrom-CodeIntegrityEvent' {
    It 'parses a 3076 (audit) event into a hashtable' {
        $xml = [xml](Get-Content (Join-Path $script:testdataRoot 'codeintegrity-3076.xml') -Raw)
        $r = ConvertFrom-CodeIntegrityEvent -EventXml $xml
        $r.event_id    | Should -Be 3076
        $r.file_path   | Should -Match 'notepad-plus-plus\.exe$'
        $r.file_name   | Should -Be 'notepad-plus-plus.exe'
        $r.file_hash   | Should -Be '112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00'
        $r.event_time  | Should -Be '2026-05-15T08:00:00Z'
        $r.is_block    | Should -Be $false
    }

    It 'parses a 3077 (block) event and sets is_block = true' {
        $xml = [xml](Get-Content (Join-Path $script:testdataRoot 'codeintegrity-3077.xml') -Raw)
        $r = ConvertFrom-CodeIntegrityEvent -EventXml $xml
        $r.event_id    | Should -Be 3077
        $r.is_block    | Should -Be $true
        $r.user_name   | Should -Be 'TEST-HOST\jdoe'
        $r.parent_process | Should -Match 'cmd\.exe$'
    }
}
```

- [ ] **Step 2: Run — confirm RED**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1
```

Expected: 2 failing tests (`ConvertFrom-CodeIntegrityEvent` not recognised).

- [ ] **Step 3: Implement**

Append to `lib/WdacControl.psm1`:

```powershell
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

Export-ModuleMember -Function ConvertFrom-CodeIntegrityEvent
```

- [ ] **Step 4: Run — confirm GREEN**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1
```

Expected: 3 passing tests (1 scaffold + 2 parser).

- [ ] **Step 5: Commit**

```bash
git add agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1
git commit -m "feat(agent): ConvertFrom-CodeIntegrityEvent parser + tests"
```

---

### Task 12: WdacControl — `ConvertTo-CIPolicyXml`

Generates a WDAC `.xml` from a rule list. Calling `ConvertFrom-CIPolicy` (built-in WDAC PowerShell cmdlet) on this XML produces the binary `.cip`. For Phase 1 we only need to generate the XML; the actual `.cip` conversion happens via Microsoft's existing cmdlet at apply time.

**Files:**
- Modify: `agent/runtime-powershell/lib/WdacControl.psm1`
- Modify: `agent/runtime-powershell/tests/WdacControl.Tests.ps1`

- [ ] **Step 1: Write failing tests**

Append to tests:

```powershell
Describe 'ConvertTo-CIPolicyXml' {
    It 'produces an XML with PolicyType and rule entries' {
        $rules = @(
            [pscustomobject]@{ action='allow'; rule_type='publisher'; publisher_name='CN=Microsoft Corp'; product_name=$null; value='CN=Microsoft Corp' },
            [pscustomobject]@{ action='allow'; rule_type='hash';      publisher_name=$null;              product_name=$null; value='AABBCC' }
        )
        $xml = ConvertTo-CIPolicyXml -Rules $rules -Mode 'audit' -PolicyGuid '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'
        $xml | Should -Match '<PolicyTypeID>'
        $xml | Should -Match '<Allow ID="ID_ALLOW_0"'
        $xml | Should -Match 'CN=Microsoft Corp'
        $xml | Should -Match 'AABBCC'
    }

    It 'sets the Audit rule option when Mode is audit' {
        $xml = ConvertTo-CIPolicyXml -Rules @() -Mode 'audit' -PolicyGuid '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'
        $xml | Should -Match 'Enabled:Audit Mode'
    }

    It 'omits the Audit rule option when Mode is enforce' {
        $xml = ConvertTo-CIPolicyXml -Rules @() -Mode 'enforce' -PolicyGuid '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'
        $xml | Should -Not -Match 'Enabled:Audit Mode'
    }
}
```

- [ ] **Step 2: Confirm RED**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 3 new failing tests.

- [ ] **Step 3: Implement**

Append to `WdacControl.psm1` before the existing `Export-ModuleMember` (and update the export line):

```powershell
function ConvertTo-CIPolicyXml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][object[]]$Rules,
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
```

- [ ] **Step 4: Confirm GREEN**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1
git commit -m "feat(agent): ConvertTo-CIPolicyXml generator + tests"
```

---

### Task 13: WdacControl — state file (`Get-WdacAgentState` / `Set-WdacAgentState`)

Persists the agent's last-applied policy version + last-seen event cursor across restarts.

**Files:**
- Modify: `agent/runtime-powershell/lib/WdacControl.psm1`
- Modify: `agent/runtime-powershell/tests/WdacControl.Tests.ps1`

- [ ] **Step 1: Write failing tests**

```powershell
Describe 'WdacAgentState' {
    BeforeEach {
        $script:stateFile = Join-Path ([IO.Path]::GetTempPath()) ("wdac-state-" + [guid]::NewGuid() + ".json")
    }

    AfterEach {
        Remove-Item -Path $script:stateFile -ErrorAction SilentlyContinue
    }

    It 'returns a fresh default when file is missing' {
        $s = Get-WdacAgentState -Path $script:stateFile
        $s.last_applied_version | Should -BeNullOrEmpty
        $s.last_event_record_id | Should -Be 0
    }

    It 'round-trips a write then read' {
        Set-WdacAgentState -Path $script:stateFile -State @{
            peritus_policy_guid = '{1111-2222}'
            last_applied_version = 'abc'
            last_applied_at = '2026-05-15T00:00:00Z'
            last_event_record_id = 12345
        }
        $r = Get-WdacAgentState -Path $script:stateFile
        $r.peritus_policy_guid  | Should -Be '{1111-2222}'
        $r.last_applied_version | Should -Be 'abc'
        $r.last_event_record_id | Should -Be 12345
    }

    It 'tolerates a corrupt state file by returning default' {
        Set-Content -Path $script:stateFile -Value 'not json' -Encoding UTF8
        $s = Get-WdacAgentState -Path $script:stateFile
        $s.last_event_record_id | Should -Be 0
    }
}
```

- [ ] **Step 2: Confirm RED**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 3 new failures.

- [ ] **Step 3: Implement**

Append to `WdacControl.psm1`:

```powershell
function Get-WdacAgentState {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $default = @{
        peritus_policy_guid  = $null
        last_applied_version = $null
        last_applied_at      = $null
        last_event_record_id = 0
    }

    if (-not (Test-Path $Path)) { return $default }
    try {
        $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
        $obj = $raw | ConvertFrom-Json -ErrorAction Stop
        $h = @{}
        foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = $p.Value }
        foreach ($k in $default.Keys) { if (-not $h.ContainsKey($k)) { $h[$k] = $default[$k] } }
        return $h
    } catch {
        return $default
    }
}

function Set-WdacAgentState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][hashtable]$State
    )

    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $tmp = "$Path.tmp"
    ($State | ConvertTo-Json -Depth 5) | Set-Content -Path $tmp -Encoding UTF8
    Move-Item -Path $tmp -Destination $Path -Force
}

Export-ModuleMember -Function ConvertFrom-CodeIntegrityEvent, ConvertTo-CIPolicyXml, Get-WdacAgentState, Set-WdacAgentState
```

- [ ] **Step 4: Confirm GREEN**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 9 passing tests.

- [ ] **Step 5: Commit**

```bash
git add agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1
git commit -m "feat(agent): WdacAgentState read/write helpers + tests"
```

---

### Task 14: ApiClient — `Invoke-AgentAppControlObserved`

**Files:**
- Modify: `agent/runtime-powershell/lib/ApiClient.psm1`

The tests for this live in the existing ApiClient.Tests.ps1 path; this codebase doesn't have one yet so we'll add a minimal contract test instead.

- [ ] **Step 1: Create or extend test file**

Create `agent/runtime-powershell/tests/ApiClient.Tests.ps1` (or append, if it exists):

```powershell
BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $script:moduleRoot 'lib/HmacAuth.psm1')  -Force
    Import-Module (Join-Path $script:moduleRoot 'lib/ApiClient.psm1') -Force
}

Describe 'Invoke-AgentAppControlObserved' {
    It 'builds HMAC headers for the /agent-app-control/observed path' {
        # We don't actually POST; we mock Invoke-RestMethod and capture args.
        Mock -CommandName Invoke-RestMethod -ModuleName ApiClient -MockWith { return @{ upserted = 1 } } -Verifiable

        $r = Invoke-AgentAppControlObserved `
            -ApiBaseUrl 'http://example.test' `
            -AgentId    'deadbeef-1111-2222-3333-444455556666' `
            -AgentSecret 'shhh' `
            -Apps       @(@{ file_path = 'C:\test.exe'; first_seen = '2026-05-15T00:00:00Z'; exec_count = 1 })

        $r.upserted | Should -Be 1
        Assert-MockCalled -CommandName Invoke-RestMethod -ModuleName ApiClient -ParameterFilter {
            $Uri -like '*/functions/v1/agent-app-control/observed' -and
            $Headers.ContainsKey('X-Signature') -and
            $Headers.ContainsKey('X-Timestamp') -and
            $Headers['X-Agent-Id'] -eq 'deadbeef-1111-2222-3333-444455556666'
        }
    }
}
```

- [ ] **Step 2: Confirm RED**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/ApiClient.Tests.ps1
```

Expected: 1 failure (`Invoke-AgentAppControlObserved` not found).

- [ ] **Step 3: Implement in `lib/ApiClient.psm1`**

Append a new function:

```powershell
function Invoke-AgentAppControlObserved {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][string]$AgentId,
        [Parameter(Mandatory)][string]$AgentSecret,
        [Parameter(Mandatory)][object[]]$Apps,
        [Parameter()][string]$Since
    )

    $payload = @{ apps = $Apps }
    if ($Since) { $payload.since = $Since }

    $rawBody = ConvertTo-CanonicalJson -Value $payload
    $path    = '/agent-app-control/observed'
    $headers = New-HmacRequestHeaders -AgentId $AgentId -Secret $AgentSecret -Method 'POST' -Path $path -RawBody $rawBody
    $url     = "$ApiBaseUrl/functions/v1$path"
    return Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' -Headers $headers -Body $rawBody -UseBasicParsing
}
```

Also update the `Export-ModuleMember -Function ...` line at the end of `ApiClient.psm1` to include `Invoke-AgentAppControlObserved`.

- [ ] **Step 4: Confirm GREEN**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/ApiClient.Tests.ps1
```

Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add agent/runtime-powershell/lib/ApiClient.psm1 agent/runtime-powershell/tests/ApiClient.Tests.ps1
git commit -m "feat(agent): Invoke-AgentAppControlObserved HMAC client + test"
```

---

### Task 15: WdacControl — `Get-NewWdacObservations` (tail CodeIntegrity log)

Reads CodeIntegrity events newer than the saved record_id, parses them through `ConvertFrom-CodeIntegrityEvent`, and aggregates by `(file_path, file_hash)` into a list ready to POST.

**Files:**
- Modify: `agent/runtime-powershell/lib/WdacControl.psm1`
- Modify: `agent/runtime-powershell/tests/WdacControl.Tests.ps1`

We can't actually call `Get-WinEvent` against a synthetic log in unit tests, so we test the **aggregation logic** by injecting parsed records directly.

- [ ] **Step 1: Write failing test**

```powershell
Describe 'Aggregate-WdacObservations' {
    It 'collapses repeated (file_path, file_hash) into a single row with summed exec_count' {
        $records = @(
            [pscustomobject]@{ file_path='C:\a.exe'; file_hash='AA'; file_name='a.exe'; event_time='2026-05-15T01:00:00Z'; is_block=$false; record_id=1 },
            [pscustomobject]@{ file_path='C:\a.exe'; file_hash='AA'; file_name='a.exe'; event_time='2026-05-15T01:01:00Z'; is_block=$false; record_id=2 },
            [pscustomobject]@{ file_path='C:\b.exe'; file_hash='BB'; file_name='b.exe'; event_time='2026-05-15T01:02:00Z'; is_block=$false; record_id=3 }
        )
        $r = Aggregate-WdacObservations -Records $records
        $r.Count | Should -Be 2
        ($r | Where-Object { $_.file_path -eq 'C:\a.exe' }).exec_count | Should -Be 2
        ($r | Where-Object { $_.file_path -eq 'C:\b.exe' }).exec_count | Should -Be 1
    }

    It 'returns the max record_id across the batch' {
        $records = @(
            [pscustomobject]@{ file_path='C:\a.exe'; file_hash='AA'; file_name='a.exe'; event_time='2026-05-15T01:00:00Z'; is_block=$false; record_id=10 },
            [pscustomobject]@{ file_path='C:\b.exe'; file_hash='BB'; file_name='b.exe'; event_time='2026-05-15T01:01:00Z'; is_block=$false; record_id=20 }
        )
        $max = Get-MaxRecordId -Records $records
        $max | Should -Be 20
    }
}
```

- [ ] **Step 2: Confirm RED**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 2 new failures.

- [ ] **Step 3: Implement**

Append to `WdacControl.psm1`:

```powershell
function Aggregate-WdacObservations {
    [CmdletBinding()]
    param([Parameter(Mandatory)][object[]]$Records)

    $groups = $Records | Group-Object -Property { "$($_.file_path)|$($_.file_hash)" }
    $out = foreach ($g in $groups) {
        $first = $g.Group | Sort-Object event_time | Select-Object -First 1
        [pscustomobject]@{
            file_path    = $first.file_path
            file_name    = $first.file_name
            file_hash    = $first.file_hash
            first_seen   = $first.event_time
            exec_count   = $g.Count
        }
    }
    return @($out)
}

function Get-MaxRecordId {
    [CmdletBinding()]
    param([Parameter(Mandatory)][object[]]$Records)

    if (-not $Records -or $Records.Count -eq 0) { return 0 }
    return ($Records | Measure-Object -Property record_id -Maximum).Maximum
}

function Get-NewWdacObservations {
    [CmdletBinding()]
    param([Parameter(Mandatory)][long]$SinceRecordId)

    # Live event-log read — not exercised in unit tests. Filter by record_id > $SinceRecordId.
    $filter = @{
        LogName    = 'Microsoft-Windows-CodeIntegrity/Operational'
        ProviderName = 'Microsoft-Windows-CodeIntegrity'
        Id         = 3076, 3077
    }
    $events = try { Get-WinEvent -FilterHashtable $filter -ErrorAction Stop } catch { @() }
    $events = $events | Where-Object { [long]$_.RecordId -gt $SinceRecordId }

    $parsed = foreach ($e in $events) {
        try { ConvertFrom-CodeIntegrityEvent -EventXml ([xml]$e.ToXml()) } catch { $null }
    }
    return @($parsed | Where-Object { $_ })
}

Export-ModuleMember -Function ConvertFrom-CodeIntegrityEvent, ConvertTo-CIPolicyXml, Get-WdacAgentState, Set-WdacAgentState, Aggregate-WdacObservations, Get-MaxRecordId, Get-NewWdacObservations
```

- [ ] **Step 4: Confirm GREEN**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 11 passing tests.

- [ ] **Step 5: Commit**

```bash
git add agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1
git commit -m "feat(agent): aggregate + tail WDAC observations from CodeIntegrity log"
```

---

### Task 16: WdacControl — `Apply-WdacPolicy` (best-effort, with version skip)

Applies the merged ruleset to the machine. We can't really test the live `CiTool` call in CI, so we test the version-skip logic only and isolate the `CiTool` invocation behind a script-block we can mock.

**Files:**
- Modify: `agent/runtime-powershell/lib/WdacControl.psm1`
- Modify: `agent/runtime-powershell/tests/WdacControl.Tests.ps1`

- [ ] **Step 1: Write failing tests**

```powershell
Describe 'Apply-WdacPolicy' {
    It 'skips apply when policy_version matches last_applied_version' {
        $stateFile = Join-Path ([IO.Path]::GetTempPath()) ("ap-" + [guid]::NewGuid() + ".json")
        Set-WdacAgentState -Path $stateFile -State @{
            peritus_policy_guid  = '{1111}'
            last_applied_version = 'abc'
            last_applied_at      = '2026-05-15T00:00:00Z'
            last_event_record_id = 0
        }

        $applyCalled = $false
        $result = Apply-WdacPolicy `
            -StatePath $stateFile `
            -PolicyVersion 'abc' `
            -Mode 'audit' `
            -Rules @() `
            -ApplyImpl ({ param($CipPath) $applyCalled = $true; $true })

        $result.applied | Should -Be $false
        $applyCalled    | Should -Be $false
        Remove-Item $stateFile -Force
    }

    It 'applies and records new version when policy_version differs' {
        $stateFile = Join-Path ([IO.Path]::GetTempPath()) ("ap-" + [guid]::NewGuid() + ".json")

        $applyArgs = @{}
        $result = Apply-WdacPolicy `
            -StatePath $stateFile `
            -PolicyVersion 'newhash' `
            -Mode 'enforce' `
            -Rules @([pscustomobject]@{ action='allow'; rule_type='hash'; value='AA'; publisher_name=$null; product_name=$null }) `
            -ApplyImpl ({ param($CipPath) $script:capturedPath = $CipPath; return $true })

        $result.applied | Should -Be $true
        (Get-WdacAgentState -Path $stateFile).last_applied_version | Should -Be 'newhash'
        Remove-Item $stateFile -Force
    }

    It 'returns ok=false and increments failure on apply failure' {
        $stateFile = Join-Path ([IO.Path]::GetTempPath()) ("ap-" + [guid]::NewGuid() + ".json")

        $result = Apply-WdacPolicy `
            -StatePath $stateFile `
            -PolicyVersion 'x' `
            -Mode 'audit' `
            -Rules @() `
            -ApplyImpl ({ param($CipPath) return $false })

        $result.applied | Should -Be $false
        $result.error   | Should -Not -BeNullOrEmpty
        Remove-Item $stateFile -Force
    }
}
```

- [ ] **Step 2: Confirm RED**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 3 new failures.

- [ ] **Step 3: Implement**

Append to `WdacControl.psm1`:

```powershell
function Apply-WdacPolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StatePath,
        [Parameter(Mandatory)][string]$PolicyVersion,
        [Parameter(Mandatory)][ValidateSet('audit','enforce','off')][string]$Mode,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rules,
        # Test seam — production caller leaves it default.
        [scriptblock]$ApplyImpl = $null
    )

    $state = Get-WdacAgentState -Path $StatePath
    if ($state.last_applied_version -eq $PolicyVersion) {
        return @{ applied = $false; skipped = $true; error = $null }
    }

    if (-not $state.peritus_policy_guid) {
        $state.peritus_policy_guid = "{$([guid]::NewGuid())}"
    }

    $xml      = ConvertTo-CIPolicyXml -Rules $Rules -Mode $Mode -PolicyGuid $state.peritus_policy_guid
    $tmpXml   = Join-Path ([IO.Path]::GetTempPath()) ("peritus-wdac-" + [guid]::NewGuid() + ".xml")
    $tmpCip   = [IO.Path]::ChangeExtension($tmpXml, '.cip')
    Set-Content -Path $tmpXml -Value $xml -Encoding UTF8

    $ok = $false
    try {
        if ($ApplyImpl) {
            $ok = & $ApplyImpl $tmpCip
        } else {
            # Production path: convert XML -> .cip with the built-in WDAC cmdlet,
            # drop into the WDAC active-policies directory, refresh.
            try {
                ConvertFrom-CIPolicy -XmlFilePath $tmpXml -BinaryFilePath $tmpCip | Out-Null
                $dest = "C:\Windows\System32\CodeIntegrity\CiPolicies\Active\$($state.peritus_policy_guid).cip"
                Copy-Item -Path $tmpCip -Destination $dest -Force
                $refresh = & "C:\Windows\System32\CiTool.exe" --refresh-policy 2>&1
                $ok = ($LASTEXITCODE -eq 0)
            } catch {
                $ok = $false
            }
        }
    } finally {
        Remove-Item -Path $tmpXml -ErrorAction SilentlyContinue
        Remove-Item -Path $tmpCip -ErrorAction SilentlyContinue
    }

    if ($ok) {
        $state.last_applied_version = $PolicyVersion
        $state.last_applied_at      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        Set-WdacAgentState -Path $StatePath -State $state
        return @{ applied = $true; skipped = $false; error = $null }
    } else {
        return @{ applied = $false; skipped = $false; error = "apply failed (mode=$Mode, version=$PolicyVersion)" }
    }
}

Export-ModuleMember -Function ConvertFrom-CodeIntegrityEvent, ConvertTo-CIPolicyXml, Get-WdacAgentState, Set-WdacAgentState, Aggregate-WdacObservations, Get-MaxRecordId, Get-NewWdacObservations, Apply-WdacPolicy
```

- [ ] **Step 4: Confirm GREEN**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 14 passing tests.

- [ ] **Step 5: Commit**

```bash
git add agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1
git commit -m "feat(agent): Apply-WdacPolicy with version skip + injectable apply impl"
```

---

### Task 17: WdacControl — `Invoke-WdacControlSync` orchestrator

Single public entrypoint called by the service main loop after each heartbeat.

**Files:**
- Modify: `agent/runtime-powershell/lib/WdacControl.psm1`
- Modify: `agent/runtime-powershell/tests/WdacControl.Tests.ps1`

- [ ] **Step 1: Write failing test**

```powershell
Describe 'Invoke-WdacControlSync' {
    It 'no-ops when state is null or mode=off' {
        $stateFile = Join-Path ([IO.Path]::GetTempPath()) ("ws-" + [guid]::NewGuid() + ".json")
        $r = Invoke-WdacControlSync -State $null -StatePath $stateFile -OnApply ({ param($x) $false }) -OnObservedBatch ({ param($x) $false })
        $r.applied  | Should -Be $false
        $r.observed | Should -Be 0
        Remove-Item $stateFile -ErrorAction SilentlyContinue
    }

    It 'calls OnApply when policy_version differs and forwards observations to OnObservedBatch' {
        $stateFile = Join-Path ([IO.Path]::GetTempPath()) ("ws-" + [guid]::NewGuid() + ".json")
        $applied = $false
        $observedCount = 0
        $state = [pscustomobject]@{
            mode = 'audit'
            policy_version = 'v1'
            rules = @()
            audit_until = '2026-05-29T00:00:00Z'
        }
        # We can't easily mock Get-NewWdacObservations because of script scope, so
        # the orchestrator accepts an -ObservationProvider script block too.
        $r = Invoke-WdacControlSync `
            -State $state `
            -StatePath $stateFile `
            -OnApply ({ param($cipPath) $script:applied = $true; $true }) `
            -OnObservedBatch ({ param($batch) $script:observedCount = $batch.Count; $true }) `
            -ObservationProvider ({ param($since) @([pscustomobject]@{ file_path='C:\x.exe'; file_hash='HH'; file_name='x.exe'; event_time='2026-05-15T01:00:00Z'; is_block=$false; record_id=1 }) })

        $r.applied      | Should -Be $true
        $r.observed     | Should -Be 1
        Remove-Item $stateFile -ErrorAction SilentlyContinue
    }
}
```

- [ ] **Step 2: Confirm RED**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 2 new failures.

- [ ] **Step 3: Implement**

Append to `WdacControl.psm1`:

```powershell
function Invoke-WdacControlSync {
    [CmdletBinding()]
    param(
        [object]$State,                # the app_control block from heartbeat (or $null)
        [Parameter(Mandatory)][string]$StatePath,
        [Parameter(Mandatory)][scriptblock]$OnApply,             # invoked with .cip path; returns $true on success
        [Parameter(Mandatory)][scriptblock]$OnObservedBatch,     # invoked with [pscustomobject[]] of aggregated apps; returns $true on success
        [scriptblock]$ObservationProvider = $null                # production default = Get-NewWdacObservations
    )

    $result = @{ applied = $false; observed = 0; error = $null }

    if ($null -eq $State -or $State.mode -eq 'off') {
        return $result
    }

    # Apply on version change.
    $apply = Apply-WdacPolicy `
        -StatePath $StatePath `
        -PolicyVersion $State.policy_version `
        -Mode $State.mode `
        -Rules @($State.rules) `
        -ApplyImpl $OnApply
    $result.applied = $apply.applied
    if ($apply.error) { $result.error = $apply.error }

    # Observe — always, in either audit or enforce mode.
    $agentState = Get-WdacAgentState -Path $StatePath
    $since = [long]$agentState.last_event_record_id
    $records = if ($ObservationProvider) { & $ObservationProvider $since } else { Get-NewWdacObservations -SinceRecordId $since }
    $records = @($records)
    if ($records.Count -gt 0) {
        $batch = Aggregate-WdacObservations -Records $records
        $maxId = Get-MaxRecordId -Records $records
        if (& $OnObservedBatch $batch) {
            $agentState.last_event_record_id = $maxId
            Set-WdacAgentState -Path $StatePath -State $agentState
            $result.observed = $batch.Count
        }
    }

    return $result
}

Export-ModuleMember -Function ConvertFrom-CodeIntegrityEvent, ConvertTo-CIPolicyXml, Get-WdacAgentState, Set-WdacAgentState, Aggregate-WdacObservations, Get-MaxRecordId, Get-NewWdacObservations, Apply-WdacPolicy, Invoke-WdacControlSync
```

- [ ] **Step 4: Confirm GREEN**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests/WdacControl.Tests.ps1 -Output Detailed
```

Expected: 16 passing tests.

- [ ] **Step 5: Commit**

```bash
git add agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1
git commit -m "feat(agent): Invoke-WdacControlSync orchestrator + tests"
```

---

### Task 18: Wire `Invoke-WdacControlSync` into the service main loop

**Files:**
- Modify: `agent/runtime-powershell/peritus-secure-agent.ps1`

- [ ] **Step 1: Add module import alongside the existing ones**

After the existing `Import-Module .../lib/ApiClient.psm1 -Force` line at the top of the file, append:

```powershell
Import-Module (Join-Path $PSScriptRoot 'lib/WdacControl.psm1') -Force
```

- [ ] **Step 2: Add a WDAC state file path constant**

After the existing `$script:InstallRoot = Join-Path $script:AgentRoot 'install'` line, add:

```powershell
$script:WdacStateFile = Join-Path $script:AgentRoot 'wdac-state.json'
```

- [ ] **Step 3: Call `Invoke-WdacControlSync` after the heartbeat succeeds**

Inside the main `while ($true) { … }` loop, locate the heartbeat block:

```powershell
        $resp = Invoke-AgentHeartbeat -ApiBaseUrl $script:ApiBaseUrl -AgentId $script:AgentId -AgentSecret $script:AgentSecret -Payload $payload
        Write-AgentLog "Heartbeat OK — next_check_in=$($resp.next_check_in)s, commands=$($resp.commands.Count)"
```

After the `Write-AgentLog "Heartbeat OK …"` line, add:

```powershell
        # App-control sync.
        try {
            $appControlState = $null
            if ($resp.PSObject.Properties.Name -contains 'app_control') { $appControlState = $resp.app_control }

            $apiBase = $script:ApiBaseUrl
            $agentId = $script:AgentId
            $secret  = $script:AgentSecret
            $r = Invoke-WdacControlSync `
                -State $appControlState `
                -StatePath $script:WdacStateFile `
                -OnApply ({
                    param($cipPath)
                    # Production apply path lives inside Apply-WdacPolicy default;
                    # if we ever reach the scriptblock here it means we want a custom hook.
                    # For now, defer to default behavior by returning $true only if the
                    # built-in cmdlet succeeded — this scriptblock is invoked via -ApplyImpl
                    # only in tests, so production path uses Apply-WdacPolicy's internal default.
                    $true
                }) `
                -OnObservedBatch ({
                    param($batch)
                    try {
                        Invoke-AgentAppControlObserved -ApiBaseUrl $apiBase -AgentId $agentId -AgentSecret $secret -Apps $batch | Out-Null
                        return $true
                    } catch {
                        Write-AgentLog -Level Warn "agent-app-control/observed push failed: $_"
                        return $false
                    }
                })

            if ($r.applied)  { Write-AgentLog "WDAC policy applied (version=$($appControlState.policy_version))" }
            if ($r.observed) { Write-AgentLog "WDAC observed $($r.observed) new app(s)" }
            if ($r.error)    { Write-AgentLog -Level Warn "WDAC sync error: $($r.error)" }
        } catch {
            Write-AgentLog -Level Warn "WDAC sync failed: $_"
        }
```

(Note: the `-OnApply` scriptblock above is a no-op stub; production should pass `$null` so `Apply-WdacPolicy` uses its built-in path. Replace the scriptblock with `$null` once you're confident — but Pester's required parameter on `Invoke-WdacControlSync` means we either pass a no-op or relax the parameter to optional. The test signature already has it Mandatory; in the next step we relax this.)

- [ ] **Step 4: Make `-OnApply` optional in `Invoke-WdacControlSync`**

Update `lib/WdacControl.psm1` — change the `[Parameter(Mandatory)][scriptblock]$OnApply` line to:

```powershell
[scriptblock]$OnApply = $null,
```

And update the `Apply-WdacPolicy` call to pass `$null` when `$OnApply` is `$null`:

```powershell
    $apply = Apply-WdacPolicy `
        -StatePath $StatePath `
        -PolicyVersion $State.policy_version `
        -Mode $State.mode `
        -Rules @($State.rules) `
        -ApplyImpl $OnApply
```

(The `Apply-WdacPolicy` parameter `[scriptblock]$ApplyImpl = $null` already handles `$null` by falling through to the built-in path.)

- [ ] **Step 5: Update tests to remove `-OnApply` from the null/off test**

In `tests/WdacControl.Tests.ps1`, update the first `Invoke-WdacControlSync` test:

```powershell
        $r = Invoke-WdacControlSync -State $null -StatePath $stateFile -OnObservedBatch ({ param($x) $false })
```

(Remove the `-OnApply` arg from that test only. The other test keeps its `-OnApply` scriptblock.)

- [ ] **Step 6: Re-run Pester**

```powershell
Invoke-Pester -Path agent/runtime-powershell/tests
```

Expected: all tests still pass.

- [ ] **Step 7: Simplify the call in `peritus-secure-agent.ps1`**

Replace the `-OnApply ({ … return $true })` block with no `-OnApply` argument at all — Production uses the built-in path inside `Apply-WdacPolicy`.

```powershell
            $r = Invoke-WdacControlSync `
                -State $appControlState `
                -StatePath $script:WdacStateFile `
                -OnObservedBatch ({
                    param($batch)
                    try {
                        Invoke-AgentAppControlObserved -ApiBaseUrl $apiBase -AgentId $agentId -AgentSecret $secret -Apps $batch | Out-Null
                        return $true
                    } catch {
                        Write-AgentLog -Level Warn "agent-app-control/observed push failed: $_"
                        return $false
                    }
                })
```

- [ ] **Step 8: Commit**

```bash
git add agent/runtime-powershell/peritus-secure-agent.ps1 agent/runtime-powershell/lib/WdacControl.psm1 agent/runtime-powershell/tests/WdacControl.Tests.ps1
git commit -m "feat(agent): wire WdacControl sync into service main loop"
```

---

### Task 19: Bump agent version + build 0.3.0 release

**Files:**
- Modify: `agent/runtime-powershell/agent.version`

- [ ] **Step 1: Update version**

Replace the file content with:

```
0.3.0
```

- [ ] **Step 2: Run the existing release-build script**

```bash
bash scripts/phase2a/build-release.sh
```

Expected: produces `dist/peritus-secure-agent-0.3.0.zip` (or similar — match the existing Phase 2a build output filename pattern). Note the SHA-256.

- [ ] **Step 3: Sign with the existing Ed25519 key on the replica VM**

```bash
scp dist/peritus-secure-agent-0.3.0.zip itadmin@192.168.99.143:/tmp/agent.zip
ssh itadmin@192.168.99.143 'openssl pkeyutl -sign -inkey /etc/peritus-supabase/agent-signing.pem -rawin -in /tmp/agent.zip -out /tmp/agent.sig && base64 /tmp/agent.sig'
```

Capture the base64 signature.

- [ ] **Step 4: Register in `agent_versions` on the replica VM**

```bash
ssh itadmin@192.168.99.143 "sudo docker exec supabase-db psql -U postgres -d postgres -c \"INSERT INTO public.agent_versions (runtime, channel, version, download_url, sha256, ed25519_sig, is_active, published_at) VALUES ('powershell','stable','0.3.0','https://api.cmwcollective.com.au/agent/peritus-secure-agent-0.3.0.zip','<SHA256>','<BASE64SIG>',true,now());\""
```

Replace `<SHA256>` and `<BASE64SIG>` with the values from steps 2 and 3.

- [ ] **Step 5: Publish the artifact via Caddy's `/agent/*` static route**

```bash
scp dist/peritus-secure-agent-0.3.0.zip itadmin@192.168.99.143:/tmp/
ssh itadmin@192.168.99.143 'sudo mv /tmp/peritus-secure-agent-0.3.0.zip /var/www/agent/peritus-secure-agent-0.3.0.zip && sudo chown caddy:caddy /var/www/agent/peritus-secure-agent-0.3.0.zip && sudo chmod 644 /var/www/agent/peritus-secure-agent-0.3.0.zip'
curl -sI -w "HTTP %{http_code}\n" -o /dev/null "https://api.cmwcollective.com.au/agent/peritus-secure-agent-0.3.0.zip"
```

Expected: HTTP 200.

- [ ] **Step 6: Commit**

```bash
git add agent/runtime-powershell/agent.version
git commit -m "release(agent): bump powershell runtime to 0.3.0 (WdacControl)"
```

---

### Task 20: Frontend hook — extend `useWdac` with the new columns

**Files:**
- Modify: `src/hooks/useWdac.ts`

- [ ] **Step 1: Read the existing hook**

```bash
sed -n '1,80p' src/hooks/useWdac.ts
```

Note the existing `useWdacRuleSets` and the `WdacRuleSet` type.

- [ ] **Step 2: Add the four new columns to the type and select**

Find the existing `WdacRuleSet` interface (or `type`) and add:

```typescript
  audit_window_days: number;
  auto_promote: boolean;
  policy_version: number;
  feature_enabled: boolean;
```

Find the existing `from("wdac_rule_sets").select(...)` call and append the new columns to the select string. For example, if the existing select is `"*"` it already includes them; otherwise add them explicitly.

- [ ] **Step 3: Add a new hook `useRuleSetAuditSummary`**

Append:

```typescript
export interface RuleSetAuditSummary {
  rule_set_id: string;
  devices_in_audit: number;
  devices_in_enforce: number;
  earliest_audit_until: string | null;
  unique_apps_observed: number;
}

export function useRuleSetAuditSummary(ruleSetId: string | null) {
  return useQuery({
    queryKey: ["wdac-rule-set-audit-summary", ruleSetId],
    enabled: !!ruleSetId,
    queryFn: async (): Promise<RuleSetAuditSummary | null> => {
      if (!ruleSetId) return null;

      const [stateRes, appsRes] = await Promise.all([
        supabase
          .from("endpoint_app_control_state")
          .select("current_mode, audit_until")
          .eq("rule_set_id", ruleSetId),
        supabase
          .from("wdac_discovered_apps")
          .select("id", { count: "exact", head: true })
          .in(
            "endpoint_id",
            (await supabase
              .from("endpoint_app_control_state")
              .select("endpoint_id")
              .eq("rule_set_id", ruleSetId)).data?.map((r: { endpoint_id: string }) => r.endpoint_id) ?? []
          ),
      ]);

      const rows = stateRes.data ?? [];
      return {
        rule_set_id: ruleSetId,
        devices_in_audit:   rows.filter((r) => r.current_mode === "audit").length,
        devices_in_enforce: rows.filter((r) => r.current_mode === "enforce").length,
        earliest_audit_until:
          rows.filter((r) => r.current_mode === "audit")
              .map((r) => r.audit_until)
              .sort()[0] ?? null,
        unique_apps_observed: appsRes.count ?? 0,
      };
    },
  });
}
```

- [ ] **Step 4: Type-check**

```bash
npm run build 2>&1 | tail -30
```

Expected: build succeeds (or fails only on unrelated existing type issues — not on the new code).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWdac.ts
git commit -m "feat(ui): rule-set audit summary hook + new column types"
```

---

### Task 21: Frontend component — `RuleSetAuditCountdown`

**Files:**
- Create: `src/components/security/RuleSetAuditCountdown.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRuleSetAuditSummary } from "@/hooks/useWdac";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface RuleSetAuditCountdownProps {
  ruleSetId: string;
  ruleSetName: string;
  auditWindowDays: number;
  autoPromote: boolean;
}

export function RuleSetAuditCountdown({
  ruleSetId,
  ruleSetName,
  auditWindowDays,
  autoPromote,
}: RuleSetAuditCountdownProps) {
  const { data, isLoading } = useRuleSetAuditSummary(ruleSetId);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const daysRemaining = useMemo(() => {
    if (!data?.earliest_audit_until) return null;
    const ms = new Date(data.earliest_audit_until).getTime() - Date.now();
    return Math.max(0, Math.round(ms / 86400000));
  }, [data?.earliest_audit_until]);

  const progress = useMemo(() => {
    if (daysRemaining === null) return 0;
    return Math.min(100, Math.max(0, ((auditWindowDays - daysRemaining) / auditWindowDays) * 100));
  }, [daysRemaining, auditWindowDays]);

  const promoteNow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("endpoint_app_control_state")
        .update({ current_mode: "enforce" })
        .eq("rule_set_id", ruleSetId)
        .eq("current_mode", "audit");
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: `Promoted "${ruleSetName}" to enforce`, description: "All audit-mode devices on this rule set are now enforced." });
      queryClient.invalidateQueries({ queryKey: ["wdac-rule-set-audit-summary", ruleSetId] });
    },
    onError: (e: Error) => {
      toast({ title: "Promote failed", description: e.message, variant: "destructive" });
    },
  });

  const extendAudit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("extend_app_control_audit", {
        p_rule_set_id: ruleSetId,
        p_extra_days: 7,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Audit extended", description: `Added 7 days to all devices in "${ruleSetName}".` });
      queryClient.invalidateQueries({ queryKey: ["wdac-rule-set-audit-summary", ruleSetId] });
    },
    onError: (e: Error) => {
      toast({ title: "Extend failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading audit state...
      </div>
    );
  }

  if (!data || data.devices_in_audit + data.devices_in_enforce === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No devices assigned to this rule set yet.
      </div>
    );
  }

  const inEnforce = data.devices_in_audit === 0 && data.devices_in_enforce > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        {inEnforce ? (
          <Badge variant="default" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Enforced
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> Audit
          </Badge>
        )}
        <span className="text-muted-foreground">
          {data.devices_in_audit + data.devices_in_enforce} devices ·{" "}
          {data.unique_apps_observed} unique apps observed
        </span>
      </div>

      {!inEnforce && daysRemaining !== null && (
        <>
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {daysRemaining} day{daysRemaining === 1 ? "" : "s"} remaining ·{" "}
              {autoPromote ? "auto-promotes when complete" : "manual promote required"}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => extendAudit.mutate()}
                disabled={extendAudit.isPending}
              >
                Extend audit
              </Button>
              <Button
                size="sm"
                onClick={() => promoteNow.mutate()}
                disabled={promoteNow.isPending}
              >
                Promote now
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the RPC the component calls**

Append to the existing assignment-triggers migration (or, cleaner, create a small new migration `20260515110600_extend_app_control_audit.sql`):

```sql
CREATE OR REPLACE FUNCTION public.extend_app_control_audit(
  p_rule_set_id uuid,
  p_extra_days  int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Caller must be admin of the org owning the rule set.
  IF NOT EXISTS (
    SELECT 1 FROM public.wdac_rule_sets rs
    WHERE rs.id = p_rule_set_id
      AND public.is_admin_of_org(auth.uid(), rs.organization_id)
  ) THEN
    RAISE EXCEPTION 'forbidden_not_admin' USING ERRCODE = '42501';
  END IF;

  UPDATE public.endpoint_app_control_state
     SET audit_until = audit_until + (p_extra_days || ' days')::interval,
         current_mode = 'audit'
   WHERE rule_set_id = p_rule_set_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_app_control_audit(uuid, int) TO authenticated;
```

Apply to VM:

```bash
scp supabase/migrations/20260515110600_extend_app_control_audit.sql itadmin@192.168.99.143:/tmp/m.sql
ssh itadmin@192.168.99.143 'sudo docker exec -i supabase-db psql -U postgres -d postgres < /tmp/m.sql && rm /tmp/m.sql'
```

- [ ] **Step 3: Type-check**

```bash
npm run build 2>&1 | tail -30
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/security/RuleSetAuditCountdown.tsx supabase/migrations/20260515110600_extend_app_control_audit.sql
git commit -m "feat(ui,db): RuleSetAuditCountdown component + extend_audit RPC"
```

---

### Task 22: Wire `RuleSetAuditCountdown` into `ApplicationControl.tsx`

**Files:**
- Modify: `src/components/security/ApplicationControl.tsx`

- [ ] **Step 1: Find where rule sets are rendered**

```bash
grep -n "rule_set\|ruleSet\|RuleSet" src/components/security/ApplicationControl.tsx | head -20
```

Identify the JSX block that renders one rule-set row inside the rule-sets tab.

- [ ] **Step 2: Import the new component**

At the top of the file, with the other imports:

```typescript
import { RuleSetAuditCountdown } from "./RuleSetAuditCountdown";
```

- [ ] **Step 3: Render it inside the rule-set row**

Inside the rule-set row JSX (within the rule-sets tab section), add the component:

```tsx
<RuleSetAuditCountdown
  ruleSetId={ruleSet.id}
  ruleSetName={ruleSet.name}
  auditWindowDays={ruleSet.audit_window_days ?? 14}
  autoPromote={ruleSet.auto_promote ?? true}
/>
```

(Exact placement depends on the existing JSX — append it inside the rule-set card body so it appears under the name/description.)

- [ ] **Step 4: Smoke-test in the browser**

```bash
npm run dev
```

Navigate to the Application Control screen on a rule set with at least one assigned endpoint and confirm the countdown renders. (If you have no assigned endpoint, the "No devices assigned" message should render — also acceptable.)

- [ ] **Step 5: Commit**

```bash
git add src/components/security/ApplicationControl.tsx
git commit -m "feat(ui): show audit countdown + promote on each rule-set row"
```

---

### Task 23: End-to-end integration test on the replica VM

Use the existing Windows test endpoint (the one that's already been validated end-to-end in P2A-T18).

- [ ] **Step 1: Pre-conditions on the test endpoint**

Confirm the agent is at 0.2.0 first:

```powershell
Get-Content 'C:\Program Files\PeritusSecure\agent.version'
```

Expected: `0.2.0`.

- [ ] **Step 2: Install the 0.3.0 release**

Use the existing install one-liner pattern (PowerShell Modern Service tab); generate a fresh enrollment token if the device was previously enrolled and re-run the install.

- [ ] **Step 3: Confirm 0.3.0 is running**

```powershell
Get-Content 'C:\Program Files\PeritusSecure\agent.version'
Get-Service -Name 'PeritusSecureAgent' | Select-Object Status, StartType
```

Expected: `0.3.0`, service `Running`, start type `Automatic`.

- [ ] **Step 4: Create a rule set + assign**

In the platform UI, on the test endpoint's organization, create a rule set "phase2b-test" with `audit_window_days=1` (we set short to make the timer test possible later). Assign the test endpoint directly via Application Control → rule-set assignment dialog.

- [ ] **Step 5: Wait one heartbeat and confirm state row appears**

```bash
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres -c "SELECT endpoint_id, rule_set_id, current_mode, audit_until FROM public.endpoint_app_control_state ORDER BY assigned_at DESC LIMIT 5;"'
```

Expected: a row with the test endpoint's ID, mode `audit`, `audit_until` ≈ now + 1 day.

- [ ] **Step 6: Wait two heartbeats (≈ 130s) and confirm observations land**

Run a few unsigned binaries on the test endpoint to generate CodeIntegrity 3076 events:

```powershell
# On the test endpoint — copy a benign exe to a non-standard path so it generates a 3076 in audit
Copy-Item 'C:\Windows\System32\notepad.exe' 'C:\Temp\fake-test-001.exe' -Force
& 'C:\Temp\fake-test-001.exe' & exit
```

Then on the VM:

```bash
sleep 130
ssh itadmin@192.168.99.143 'sudo docker exec supabase-db psql -U postgres -d postgres -c "SELECT file_name, file_path, discovery_source, execution_count, first_seen_at FROM public.wdac_discovered_apps WHERE discovery_source = '\''event_log'\'' AND last_seen_at > now() - interval '\''5 minutes'\'' ORDER BY last_seen_at DESC LIMIT 10;"'
```

Expected: at least one row with `discovery_source = 'event_log'`. (May also include legitimate audit-mode allows from Windows itself — not a problem.)

- [ ] **Step 7: Confirm UI countdown renders correctly**

Open Application Control in the browser, locate "phase2b-test", and confirm:
- Progress bar at < 5%
- "1 device · N unique apps observed"
- "Promote now" + "Extend audit" buttons visible

- [ ] **Step 8: Promote manually**

Click "Promote now". Confirm:
- Toast appears
- Within ~60s the test endpoint's state row flips to `current_mode = 'enforce'`
- Within ~60s after that, the agent's next heartbeat applies the policy (check `wdac-state.json` in `C:\ProgramData\PeritusSecure\`)

- [ ] **Step 9: Confirm enforce mode actually blocks**

```powershell
# On the test endpoint
& 'C:\Temp\fake-test-002.exe'   # this binary has never been observed → not in ruleset
```

Expected: Windows shows "blocked by your organization" or similar. A 3077 event should appear in `Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 5`.

(If `CiTool /list-policies` doesn't show the Peritus policy GUID, the apply path failed — check the agent log at `C:\ProgramData\PeritusSecure\logs\agent-YYYY-MM-DD.log` for the error.)

- [ ] **Step 10: Clean up test artefacts**

```powershell
Remove-Item C:\Temp\fake-test-*.exe -Force
```

On the platform: delete the "phase2b-test" rule set (cascade removes the state rows + assignments).

- [ ] **Step 11: No commit** — integration test only.

---

### Task 24: Plan self-review checkpoint

(Mechanical task — leaving here to satisfy the writing-plans skill's "spec coverage" requirement.)

- [ ] **Step 1: Re-read the spec** (`docs/superpowers/specs/2026-05-14-app-control-design.md`) and confirm each Phase-1 line item is implemented by a task above:

| Spec requirement | Task |
|---|---|
| Schema additions on wdac_rule_sets | Task 2 |
| endpoint_app_control_state table | Task 3 |
| wdac_block_events table | Task 4 |
| Assignment triggers | Task 5 |
| policy_version trigger | Task 6 |
| app_control_state_for_endpoint() | Task 7 |
| agent-heartbeat returns app_control | Task 8 |
| agent-app-control/observed endpoint | Task 9 |
| WdacControl.psm1: CodeIntegrity parser | Task 11 |
| WdacControl.psm1: CIPolicy XML generator | Task 12 |
| WdacControl.psm1: state file | Task 13 |
| ApiClient: HMAC client for observed | Task 14 |
| WdacControl.psm1: observation aggregation + log tail | Task 15 |
| WdacControl.psm1: Apply with version skip | Task 16 |
| WdacControl.psm1: orchestrator | Task 17 |
| Service main loop wires it in | Task 18 |
| Bumped agent version + release | Task 19 |
| UI: audit summary hook | Task 20 |
| UI: countdown + promote/extend component | Task 21 |
| UI: countdown wired into ApplicationControl | Task 22 |
| End-to-end integration test | Task 23 |

If any spec requirement is missing a task, add it inline.

- [ ] **Step 2: No commit** — checkpoint only.

---

### Task 25: Push branch + open PR (DEFERRED until user authorises)

Per the recurring user instruction "keep branches local until I say", **do not push** without explicit authorisation.

When authorised:

- [ ] **Step 1: Push branch**

```bash
git push -u origin agent/phase-2b-app-control
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "agent(phase 2b): WDAC application control — audit + observe + manual promote" --body "$(cat <<'EOF'
## Summary

- Adds the modern agent's first WDAC module (`WdacControl.psm1`) — applies a merged CIPolicy from heartbeat state, tails CodeIntegrity 3076/3077 events, pushes observations.
- New per-(endpoint, rule_set) state table with admin "Promote now" / "Extend audit" controls.
- UI shows audit countdown + observed-app count on each rule-set row.
- Auto-promote (`pg_cron`), block-event ingest, and audit-review UX are out of scope for this PR — they're Phase 2.

## Spec
[docs/superpowers/specs/2026-05-14-app-control-design.md](docs/superpowers/specs/2026-05-14-app-control-design.md)

## Test plan
- [x] Pester unit tests pass (16 tests across `tests/WdacControl.Tests.ps1` + `tests/ApiClient.Tests.ps1`)
- [x] Migrations apply cleanly on the replica VM
- [x] End-to-end on a Windows test endpoint: observe → manual promote → enforce blocks unsigned binary
- [ ] Cloud production deploy (separate PR — promote-to-cloud)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase-1 done when

- All Pester tests pass (`Invoke-Pester -Path agent/runtime-powershell/tests` shows 16+ tests passing)
- The end-to-end on the replica VM in Task 23 succeeds
- Branch is local + ready to push when user authorises
