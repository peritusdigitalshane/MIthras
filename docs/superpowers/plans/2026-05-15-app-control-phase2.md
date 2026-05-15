# App-Control Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add publisher-hint population in the edge function, policy templates with a "start from template" dialog, and a pilot ring promotion panel using existing endpoint groups.

**Architecture:** Three independent layers — (1) backend: edge function populates `publisher` from file path heuristics; (2) database: two new migrations (templates table + rings table) plus a SQL function update; (3) frontend: new hooks + a template select in the create dialog + a `RuleSetRingsPanel` wired into the rule set detail view.

**Tech Stack:** Deno/TypeScript (edge functions), PostgreSQL (migrations), React + TanStack Query + shadcn/ui (frontend).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/agent-app-control/index.ts` | Modify | Add `inferPublisher()` helper; populate `publisher` column on upsert when null |
| `supabase/migrations/20260515120000_wdac_policy_templates.sql` | Create | `wdac_policy_templates` table + RLS + 3 seed rows |
| `supabase/migrations/20260515120100_wdac_rule_set_rings.sql` | Create | `wdac_rule_set_rings` table + RLS |
| `supabase/migrations/20260515120200_app_control_state_rings.sql` | Create | Replace `app_control_state_for_endpoint` to handle ring overrides |
| `src/hooks/useWdacTemplates.ts` | Create | `useWdacTemplates()` query hook |
| `src/hooks/useRuleSets.ts` | Modify | Add `useOrgEndpointGroups()`, `useRuleSetRings()`, `useRingMutations()` |
| `src/components/security/ApplicationControl.tsx` | Modify | Template select in create dialog; audit countdown + rings panel in detail view |
| `src/components/security/RuleSetRingsPanel.tsx` | Create | Rings list, add-ring popover, promote-to-enforce button |
| `scripts/phase2b/deploy-app-control-phase2.sh` | Create | Deploy new migrations + edge function + frontend to replica VM |

---

### Task 1: Edge function — populate publisher from file path

**Files:**
- Modify: `supabase/functions/agent-app-control/index.ts`

- [ ] **Step 1: Add `inferPublisher` helper and apply it in the upsert rows map**

Replace the entire file content with:

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

// Maps path prefixes (uppercase) → display publisher name.
// Checked in order; first match wins.
const PUBLISHER_PREFIXES: [string, string][] = [
    ["C:\\WINDOWS\\", "Windows"],
    ["C:\\PROGRAM FILES\\MICROSOFT OFFICE\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\MICROSOFT OFFICE 16\\", "Microsoft"],
    ["C:\\PROGRAM FILES (X86)\\MICROSOFT OFFICE\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\MICROSOFT\\", "Microsoft"],
    ["C:\\PROGRAM FILES (X86)\\MICROSOFT\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\COMMON FILES\\MICROSOFT SHARED\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\WINDOWSAPPS\\MICROSOFT.", "Microsoft"],
    ["C:\\PROGRAM FILES\\GOOGLE\\CHROME\\", "Google"],
    ["C:\\PROGRAM FILES (X86)\\GOOGLE\\CHROME\\", "Google"],
    ["C:\\PROGRAM FILES\\ADOBE\\", "Adobe"],
    ["C:\\PROGRAM FILES (X86)\\ADOBE\\", "Adobe"],
    ["C:\\PROGRAM FILES\\MOZILLA FIREFOX\\", "Mozilla"],
    ["C:\\PROGRAM FILES\\VIDEOLAN\\", "VLC"],
    ["C:\\PROGRAM FILES\\7-ZIP\\", "7-Zip"],
    ["C:\\PROGRAM FILES\\NOTEPAD++\\", "Notepad++"],
    ["C:\\PROGRAM FILES\\WINRAR\\", "WinRAR"],
    ["C:\\PROGRAM FILES\\TEAMVIEWER\\", "TeamViewer"],
    ["C:\\PROGRAM FILES\\ZOOM\\", "Zoom"],
    ["C:\\PROGRAM FILES\\SLACK TECHNOLOGIES\\", "Slack"],
    ["C:\\PROGRAM FILES\\DROPBOX\\", "Dropbox"],
    ["C:\\PROGRAM FILES (X86)\\DROPBOX\\", "Dropbox"],
    ["C:\\PROGRAM FILES\\CITRIX\\", "Citrix"],
    ["C:\\PROGRAM FILES (X86)\\CITRIX\\", "Citrix"],
];

function inferPublisher(filePath: string): string {
    const upper = filePath.toUpperCase();
    for (const [prefix, pub] of PUBLISHER_PREFIXES) {
        if (upper.startsWith(prefix)) return pub;
    }
    return "Unknown / Unsigned";
}

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
        publisher:        a.publisher ?? inferPublisher(a.file_path),
        product_name:     a.product_name ?? null,
        file_version:     a.file_version ?? null,
        discovery_source: "event_log",
        first_seen_at:    a.first_seen ?? new Date().toISOString(),
        last_seen_at:     new Date().toISOString(),
        execution_count:  Math.max(1, a.exec_count ?? 1),
    }));

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

- [ ] **Step 2: Verify the change builds (TypeScript check)**

```powershell
# Quick syntax check — Deno lint if available, else just confirm no obvious errors
cd C:\Users\Administrator\claude\mithras\peritus-endpoint-guardian
# Visual inspect: confirm inferPublisher is called in rows.map at the publisher line
```

Expected: file saved, `publisher: a.publisher ?? inferPublisher(a.file_path)` on line ~88.

- [ ] **Step 3: Commit**

```powershell
git add supabase/functions/agent-app-control/index.ts
git commit -m "feat(edge): infer publisher hint from file path in agent-app-control/observed

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Migration — `wdac_policy_templates` table + seed data

**Files:**
- Create: `supabase/migrations/20260515120000_wdac_policy_templates.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260515120000_wdac_policy_templates.sql
-- Peritus-curated policy templates. Seeded with 3 starter templates.
-- rules column is a jsonb array of wdac_rule_set_rules-shaped objects
-- (without id/created_at/created_by/rule_set_id — those are added on instantiation).

CREATE TABLE IF NOT EXISTS public.wdac_policy_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  rules       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_system   bool        NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wdac_policy_templates ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read templates.
CREATE POLICY "Authenticated users read templates"
  ON public.wdac_policy_templates FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only super_admins can write templates.
CREATE POLICY "Super admins manage templates"
  ON public.wdac_policy_templates FOR ALL
  USING (public.is_super_admin(auth.uid()));

-- Seed: 3 system templates.
INSERT INTO public.wdac_policy_templates (name, description, rules, is_system) VALUES
(
  'Office Worker',
  'Standard allow-list for an office workstation: Windows, Microsoft Office, Teams, Edge, Chrome, Firefox, Adobe Reader.',
  '[
    {"action":"allow","rule_type":"path","value":"C:\\\\Windows\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Windows OS"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft Office"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office 16\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Office 2016/365"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps (Teams, OneDrive, Edge)"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files (x86)\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps (x86)"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Common Files\\\\Microsoft Shared\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft shared components"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Google\\\\Chrome\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Google Chrome"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Mozilla Firefox\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Mozilla Firefox"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Adobe\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Adobe"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files (x86)\\\\Adobe\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Adobe (x86)"}
  ]'::jsonb,
  true
),
(
  'Dev Workstation',
  'Office Worker baseline plus common developer tools: VS Code, Git, Node.js, Docker, Python.',
  '[
    {"action":"allow","rule_type":"path","value":"C:\\\\Windows\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Windows OS"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files (x86)\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps (x86)"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft Office"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office 16\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Office 2016/365"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Google\\\\Chrome\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Google Chrome"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Mozilla Firefox\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Mozilla Firefox"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft VS Code\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"VS Code"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Git\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Git"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\nodejs\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Node.js"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Docker\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Docker Desktop"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Python*\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Python"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Users\\\\*\\\\AppData\\\\Local\\\\Programs\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"User-installed developer tools"}
  ]'::jsonb,
  true
),
(
  'Reception / Kiosk',
  'Restrictive allow-list for a kiosk or reception terminal: Windows OS and one browser only.',
  '[
    {"action":"allow","rule_type":"path","value":"C:\\\\Windows\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Windows OS"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Google\\\\Chrome\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Google Chrome"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft Edge"}
  ]'::jsonb,
  true
)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Commit**

```powershell
git add supabase/migrations/20260515120000_wdac_policy_templates.sql
git commit -m "feat(db): add wdac_policy_templates table with 3 starter templates

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Migration — `wdac_rule_set_rings` table

**Files:**
- Create: `supabase/migrations/20260515120100_wdac_rule_set_rings.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260515120100_wdac_rule_set_rings.sql
-- Per-(rule_set, endpoint_group) mode override. Allows ring-by-ring promotion
-- from audit → enforce without affecting the whole rule set at once.

CREATE TABLE IF NOT EXISTS public.wdac_rule_set_rings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id uuid NOT NULL REFERENCES public.wdac_rule_sets(id)    ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.endpoint_groups(id)   ON DELETE CASCADE,
  mode        text NOT NULL CHECK (mode IN ('audit','enforce','off')),
  ring_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_wdac_rule_set_rings_rule_set ON public.wdac_rule_set_rings(rule_set_id);
CREATE INDEX IF NOT EXISTS idx_wdac_rule_set_rings_group    ON public.wdac_rule_set_rings(group_id);

ALTER TABLE public.wdac_rule_set_rings ENABLE ROW LEVEL SECURITY;

-- Members of the org can read rings for their org's rule sets.
CREATE POLICY "Members read rings"
  ON public.wdac_rule_set_rings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.wdac_rule_sets rs
    WHERE rs.id = wdac_rule_set_rings.rule_set_id
      AND public.is_member_of_org(auth.uid(), rs.organization_id)
  ));

-- Admins can manage rings.
CREATE POLICY "Admins manage rings"
  ON public.wdac_rule_set_rings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.wdac_rule_sets rs
    WHERE rs.id = wdac_rule_set_rings.rule_set_id
      AND public.is_admin_of_org(auth.uid(), rs.organization_id)
  ));

-- Super admins have full access.
CREATE POLICY "Super admins manage rings"
  ON public.wdac_rule_set_rings FOR ALL
  USING (public.is_super_admin(auth.uid()));
```

- [ ] **Step 2: Commit**

```powershell
git add supabase/migrations/20260515120100_wdac_rule_set_rings.sql
git commit -m "feat(db): add wdac_rule_set_rings table for pilot ring promotion

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Migration — update `app_control_state_for_endpoint` for ring overrides

**Files:**
- Create: `supabase/migrations/20260515120200_app_control_state_rings.sql`

The current function ignores rings. This migration replaces it with a version that checks `wdac_rule_set_rings` — if an endpoint belongs to a group that has a ring entry, that ring's mode overrides the base `endpoint_app_control_state.current_mode` for that rule set. Tie-break: lowest `ring_order` wins.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260515120200_app_control_state_rings.sql
-- Replace app_control_state_for_endpoint to honour wdac_rule_set_rings overrides.

CREATE OR REPLACE FUNCTION public.app_control_state_for_endpoint(p_endpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH active AS (
    -- Base rows: what endpoint_app_control_state says for this endpoint.
    SELECT s.rule_set_id, s.current_mode, s.audit_until, rs.policy_version
    FROM public.endpoint_app_control_state s
    JOIN public.wdac_rule_sets rs ON rs.id = s.rule_set_id
    WHERE s.endpoint_id = p_endpoint_id
      AND rs.feature_enabled
      AND s.current_mode <> 'off'
  ),
  ring_override AS (
    -- Per rule_set, pick the ring with the lowest ring_order that the endpoint
    -- belongs to (DISTINCT ON guarantees one row per rule_set_id).
    SELECT DISTINCT ON (r.rule_set_id)
      r.rule_set_id,
      r.mode AS ring_mode
    FROM public.wdac_rule_set_rings r
    JOIN public.endpoint_group_memberships m ON m.group_id = r.group_id
    WHERE m.endpoint_id = p_endpoint_id
      AND r.rule_set_id IN (SELECT rule_set_id FROM active)
    ORDER BY r.rule_set_id, r.ring_order ASC
  ),
  effective AS (
    -- Merge: ring mode overrides base mode when a ring exists.
    SELECT
      a.rule_set_id,
      COALESCE(ro.ring_mode, a.current_mode) AS effective_mode,
      a.audit_until,
      a.policy_version
    FROM active a
    LEFT JOIN ring_override ro ON ro.rule_set_id = a.rule_set_id
    WHERE COALESCE(ro.ring_mode, a.current_mode) <> 'off'
  ),
  merged AS (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM effective WHERE effective_mode = 'enforce') THEN 'enforce'
        WHEN EXISTS (SELECT 1 FROM effective WHERE effective_mode = 'audit')   THEN 'audit'
        ELSE 'off'
      END                                                                          AS mode,
      md5(COALESCE(string_agg(rule_set_id::text || ':' || policy_version::text, ',' ORDER BY rule_set_id), '')) AS pv,
      (SELECT min(audit_until) FROM effective WHERE effective_mode = 'audit')      AS audit_until,
      (SELECT jsonb_agg(jsonb_build_object('id', rule_set_id, 'mode', effective_mode)) FROM effective) AS rule_sets,
      (SELECT jsonb_agg(jsonb_build_object(
          'action',           r.action,
          'rule_type',        r.rule_type,
          'value',            r.value,
          'publisher_name',   r.publisher_name,
          'product_name',     r.product_name,
          'file_version_min', r.file_version_min
        ))
        FROM public.wdac_rule_set_rules r
        WHERE r.rule_set_id IN (SELECT rule_set_id FROM effective)
      )                                                                            AS rules
    FROM effective
  )
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM effective) THEN
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

- [ ] **Step 2: Commit**

```powershell
git add supabase/migrations/20260515120200_app_control_state_rings.sql
git commit -m "feat(db): update app_control_state_for_endpoint to honour ring mode overrides

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Frontend hook — `useWdacTemplates`

**Files:**
- Create: `src/hooks/useWdacTemplates.ts`

- [ ] **Step 1: Write the hook file**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WdacPolicyTemplate {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  rules: Array<{
    action: "allow" | "block";
    rule_type: "publisher" | "path" | "hash" | "file_name";
    value: string;
    publisher_name: string | null;
    product_name: string | null;
    file_version_min: string | null;
    description: string | null;
  }>;
}

export function useWdacTemplates() {
  return useQuery({
    queryKey: ["wdac-policy-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wdac_policy_templates")
        .select("id, name, description, is_system, rules")
        .order("name");

      if (error) throw error;
      return (data ?? []) as WdacPolicyTemplate[];
    },
    staleTime: 5 * 60 * 1000, // templates rarely change
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
cd C:\Users\Administrator\claude\mithras\peritus-endpoint-guardian
npm run build 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 5
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```powershell
git add src/hooks/useWdacTemplates.ts
git commit -m "feat(ui): add useWdacTemplates hook

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Frontend hooks — endpoint groups, rings queries, ring mutations

**Files:**
- Modify: `src/hooks/useRuleSets.ts` (append new exports at the bottom)

- [ ] **Step 1: Append new interfaces and hooks to `src/hooks/useRuleSets.ts`**

Add the following block at the **end** of the file, before the closing (there is no closing brace at file level — just append after line 410):

```typescript
// ─── Endpoint groups (needed by ring panel) ────────────────────────────────

export interface EndpointGroup {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
}

export function useOrgEndpointGroups() {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["endpoint-groups", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      const { data, error } = await supabase
        .from("endpoint_groups")
        .select("id, name, description, organization_id")
        .eq("organization_id", currentOrganization.id)
        .order("name");

      if (error) throw error;
      return (data ?? []) as EndpointGroup[];
    },
    enabled: !!currentOrganization?.id,
  });
}

// ─── Rule set rings ─────────────────────────────────────────────────────────

export interface RuleSetRing {
  id: string;
  rule_set_id: string;
  group_id: string;
  mode: "audit" | "enforce" | "off";
  ring_order: number;
  created_at: string;
  group_name: string;
  endpoint_count: number;
}

export function useRuleSetRings(ruleSetId: string | null) {
  return useQuery({
    queryKey: ["rule-set-rings", ruleSetId],
    queryFn: async () => {
      if (!ruleSetId) return [];

      const { data: rings, error } = await supabase
        .from("wdac_rule_set_rings")
        .select("*, endpoint_groups(id, name)")
        .eq("rule_set_id", ruleSetId)
        .order("ring_order");

      if (error) throw error;
      if (!rings?.length) return [];

      const groupIds = rings.map((r: any) => r.group_id);
      const { data: memberships } = await supabase
        .from("endpoint_group_memberships")
        .select("group_id")
        .in("group_id", groupIds);

      const countMap = new Map<string, number>();
      (memberships ?? []).forEach((m: any) => {
        countMap.set(m.group_id, (countMap.get(m.group_id) ?? 0) + 1);
      });

      return rings.map((r: any) => ({
        id: r.id,
        rule_set_id: r.rule_set_id,
        group_id: r.group_id,
        mode: r.mode as "audit" | "enforce" | "off",
        ring_order: r.ring_order,
        created_at: r.created_at,
        group_name: r.endpoint_groups?.name ?? "Unknown Group",
        endpoint_count: countMap.get(r.group_id) ?? 0,
      })) as RuleSetRing[];
    },
    enabled: !!ruleSetId,
  });
}

export function useRingMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addRing = useMutation({
    mutationFn: async ({ ruleSetId, groupId, mode = "audit", ringOrder = 0 }: {
      ruleSetId: string;
      groupId: string;
      mode?: "audit" | "enforce" | "off";
      ringOrder?: number;
    }) => {
      const { data, error } = await supabase
        .from("wdac_rule_set_rings")
        .insert({ rule_set_id: ruleSetId, group_id: groupId, mode, ring_order: ringOrder })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["rule-set-rings", data.rule_set_id] });
      toast({ title: "Ring added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add ring", description: error.message, variant: "destructive" });
    },
  });

  const removeRing = useMutation({
    mutationFn: async ({ ringId, ruleSetId }: { ringId: string; ruleSetId: string }) => {
      const { error } = await supabase.from("wdac_rule_set_rings").delete().eq("id", ringId);
      if (error) throw error;
      return ruleSetId;
    },
    onSuccess: (ruleSetId) => {
      queryClient.invalidateQueries({ queryKey: ["rule-set-rings", ruleSetId] });
      toast({ title: "Ring removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove ring", description: error.message, variant: "destructive" });
    },
  });

  const promoteRing = useMutation({
    mutationFn: async ({ ringId, ruleSetId }: { ringId: string; ruleSetId: string }) => {
      const { data, error } = await supabase
        .from("wdac_rule_set_rings")
        .update({ mode: "enforce" })
        .eq("id", ringId)
        .select()
        .single();
      if (error) throw error;
      return { data, ruleSetId };
    },
    onSuccess: ({ ruleSetId }) => {
      queryClient.invalidateQueries({ queryKey: ["rule-set-rings", ruleSetId] });
      toast({ title: "Ring promoted to enforce — endpoints switch on next heartbeat" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to promote ring", description: error.message, variant: "destructive" });
    },
  });

  return { addRing, removeRing, promoteRing };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 5
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```powershell
git add src/hooks/useRuleSets.ts
git commit -m "feat(ui): add endpoint groups, ring query, and ring mutation hooks

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: `RuleSetRingsPanel` component

**Files:**
- Create: `src/components/security/RuleSetRingsPanel.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { useState } from "react";
import { useRuleSetRings, useRingMutations, useOrgEndpointGroups } from "@/hooks/useRuleSets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Plus, Trash2, ShieldCheck, Eye, Users } from "lucide-react";

interface RuleSetRingsPanelProps {
  ruleSetId: string;
}

export function RuleSetRingsPanel({ ruleSetId }: RuleSetRingsPanelProps) {
  const { data: rings, isLoading } = useRuleSetRings(ruleSetId);
  const { data: allGroups } = useOrgEndpointGroups();
  const { addRing, removeRing, promoteRing } = useRingMutations();
  const [addGroupId, setAddGroupId] = useState<string>("");
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);

  const assignedGroupIds = new Set((rings ?? []).map(r => r.group_id));
  const availableGroups = (allGroups ?? []).filter(g => !assignedGroupIds.has(g.id));

  const handleAddRing = () => {
    if (!addGroupId) return;
    addRing.mutate(
      { ruleSetId, groupId: addGroupId, mode: "audit", ringOrder: (rings?.length ?? 0) },
      {
        onSuccess: () => {
          setAddGroupId("");
          setAddPopoverOpen(false);
        },
      }
    );
  };

  const handlePromote = (ringId: string) => {
    if (!confirm("Promote this ring to enforce mode? Endpoints in this group will block unauthorized apps on their next heartbeat.")) return;
    promoteRing.mutate({ ringId, ruleSetId });
  };

  const handleRemove = (ringId: string) => {
    if (!confirm("Remove this ring? The group will revert to the rule set's global mode.")) return;
    removeRing.mutate({ ringId, ruleSetId });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Pilot Rings ({rings?.length ?? 0})
          </CardTitle>
          {availableGroups.length > 0 && (
            <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Ring
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Add endpoint group as pilot ring</p>
                  <p className="text-xs text-muted-foreground">
                    The group starts in audit mode. Promote it to enforce when you're satisfied.
                  </p>
                  <Select value={addGroupId} onValueChange={setAddGroupId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a group…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableGroups.map(g => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!addGroupId || addRing.isPending}
                    onClick={handleAddRing}
                  >
                    {addRing.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                    Add Ring
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !rings?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No rings yet. Add an endpoint group to pilot enforce mode before rolling out to everyone.
          </p>
        ) : (
          <div className="space-y-2">
            {rings.map((ring) => (
              <div
                key={ring.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{ring.group_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {ring.endpoint_count} endpoint{ring.endpoint_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      ring.mode === "enforce"
                        ? "border-destructive/50 text-destructive bg-destructive/10 text-xs"
                        : "border-amber-500/50 text-amber-600 bg-amber-500/10 text-xs"
                    }
                  >
                    {ring.mode === "enforce" ? (
                      <ShieldCheck className="h-3 w-3 mr-1" />
                    ) : (
                      <Eye className="h-3 w-3 mr-1" />
                    )}
                    {ring.mode === "enforce" ? "Enforce" : "Audit"}
                  </Badge>
                  {ring.mode !== "enforce" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={promoteRing.isPending}
                      onClick={() => handlePromote(ring.id)}
                    >
                      {promoteRing.isPending ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3 w-3 mr-1" />
                      )}
                      Promote
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleRemove(ring.id)}
                    disabled={removeRing.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 5
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```powershell
git add src/components/security/RuleSetRingsPanel.tsx
git commit -m "feat(ui): add RuleSetRingsPanel component for pilot ring promotion

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Wire template select + rings panel into `ApplicationControl.tsx`

**Files:**
- Modify: `src/components/security/ApplicationControl.tsx`

This task makes two changes to ApplicationControl.tsx:
1. Add template select to the "Create Rule Set" dialog
2. Add `RuleSetAuditCountdown` + `RuleSetRingsPanel` to the rule set detail view

- [ ] **Step 1: Add imports at the top of the file**

After line 4 (`import { RuleSetAuditCountdown } from "./RuleSetAuditCountdown";`), add:

```typescript
import { RuleSetRingsPanel } from "./RuleSetRingsPanel";
import { useWdacTemplates } from "@/hooks/useWdacTemplates";
import { useRuleSetMutations as _useRuleSetMutations } from "@/hooks/useRuleSets";
```

Wait — `useRuleSetMutations` is already imported on line 3. Instead, just add:

```typescript
import { RuleSetRingsPanel } from "./RuleSetRingsPanel";
import { useWdacTemplates } from "@/hooks/useWdacTemplates";
```

These two lines go after line 4 (`import { RuleSetAuditCountdown } from "./RuleSetAuditCountdown";`).

- [ ] **Step 2: Add `useWdacTemplates` call inside the `ApplicationControl` function**

After line 58 (`const { createRuleSet, addRule, addRulesBulk, deleteRule: deleteRuleSetRule, updateRuleSet, deleteRuleSet } = useRuleSetMutations();`), add:

```typescript
  const { data: templates } = useWdacTemplates();
```

- [ ] **Step 3: Add `selectedTemplateId` to component state**

After line 78 (`const [ruleSetForm, setRuleSetForm] = useState({ name: "", description: "", mode: "audit" as "audit" | "enforced" });`), add:

```typescript
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
```

- [ ] **Step 4: Update `handleCreateRuleSet` to clear template selection**

Replace line 314-317:
```typescript
  const handleCreateRuleSet = () => {
    setEditingRuleSet(null);
    setRuleSetForm({ name: "", description: "", mode: "audit" });
    setShowRuleSetEditor(true);
  };
```

With:
```typescript
  const handleCreateRuleSet = () => {
    setEditingRuleSet(null);
    setRuleSetForm({ name: "", description: "", mode: "audit" });
    setSelectedTemplateId("");
    setShowRuleSetEditor(true);
  };
```

- [ ] **Step 5: Update `handleSaveRuleSet` to apply template rules after create**

Replace lines 327-334:
```typescript
  const handleSaveRuleSet = () => {
    if (editingRuleSet) {
      updateRuleSet.mutate({ id: editingRuleSet.id, ...ruleSetForm });
    } else {
      createRuleSet.mutate(ruleSetForm);
    }
    setShowRuleSetEditor(false);
  };
```

With:
```typescript
  const handleSaveRuleSet = async () => {
    if (editingRuleSet) {
      updateRuleSet.mutate({ id: editingRuleSet.id, ...ruleSetForm });
      setShowRuleSetEditor(false);
      return;
    }
    try {
      const newRuleSet = await createRuleSet.mutateAsync(ruleSetForm);
      if (selectedTemplateId && templates) {
        const tpl = templates.find(t => t.id === selectedTemplateId);
        if (tpl?.rules?.length) {
          await addRulesBulk.mutateAsync(
            tpl.rules.map(r => ({ ...r, rule_set_id: newRuleSet.id }))
          );
        }
      }
    } catch {
      // errors are handled by the mutation's onError toast
    }
    setShowRuleSetEditor(false);
  };
```

- [ ] **Step 6: Add template selector to the Create Rule Set dialog**

In the rule set editor dialog (around line 991, inside `<div className="space-y-4 py-4">`), add the template select as the **first** element, before the Name field. Add this block right after the `<div className="space-y-4 py-4">` opening tag on the create (non-edit) path:

Find this block (around line 991-993):
```typescript
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
```

Replace it with:
```typescript
          <div className="space-y-4 py-4">
            {!editingRuleSet && templates && templates.length > 0 && (
              <div className="space-y-2">
                <Label>Start from template</Label>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Blank rule set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Blank rule set</SelectItem>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.description && <span className="text-xs text-muted-foreground ml-2">— {t.description.slice(0, 50)}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplateId && (
                  <p className="text-xs text-muted-foreground">
                    {templates.find(t => t.id === selectedTemplateId)?.rules?.length ?? 0} rules will be pre-loaded. You can edit them after creating.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Name</Label>
```

- [ ] **Step 7: Add `RuleSetAuditCountdown` and `RuleSetRingsPanel` to the rule set detail view**

In the detail view (which starts at line ~380, inside `if (selectedRuleSetId && selectedRuleSet)`), find the div that wraps the Allow Rules and Block Rules cards (around line 426):

```typescript
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Allow Rules ({allowRules.length})
```

Insert the audit countdown and rings panel right after `<div className="space-y-6">` (before the first `<Card>`):

```typescript
        ) : (
          <div className="space-y-6">
            <RuleSetAuditCountdown
              ruleSetId={selectedRuleSet.id}
              ruleSetName={selectedRuleSet.name}
              auditWindowDays={selectedRuleSet.audit_window_days ?? 14}
              autoPromote={selectedRuleSet.auto_promote ?? true}
            />
            <RuleSetRingsPanel ruleSetId={selectedRuleSet.id} />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Allow Rules ({allowRules.length})
```

- [ ] **Step 8: Update the Save button to handle async + disable during bulk add**

Find the Save button in the dialog footer (around line 1033):
```typescript
            <Button onClick={handleSaveRuleSet} disabled={!ruleSetForm.name || createRuleSet.isPending || updateRuleSet.isPending}>
              {(createRuleSet.isPending || updateRuleSet.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingRuleSet ? "Save Changes" : "Create"}
            </Button>
```

Replace with:
```typescript
            <Button
              onClick={handleSaveRuleSet}
              disabled={!ruleSetForm.name || createRuleSet.isPending || updateRuleSet.isPending || addRulesBulk.isPending}
            >
              {(createRuleSet.isPending || updateRuleSet.isPending || addRulesBulk.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingRuleSet ? "Save Changes" : "Create"}
            </Button>
```

- [ ] **Step 9: Verify TypeScript compiles with no errors**

```powershell
npm run build 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 10
```

Expected: no `error TS` lines.

- [ ] **Step 10: Commit**

```powershell
git add src/components/security/ApplicationControl.tsx
git commit -m "feat(ui): add template selector to create dialog and rings panel to rule set detail view

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Deploy script + deploy to VM

**Files:**
- Create: `scripts/phase2b/deploy-app-control-phase2.sh`

- [ ] **Step 1: Write the deploy script**

```bash
#!/usr/bin/env bash
# Deploy App-Control Phase 2 to replica VM (192.168.99.143).
# Run from the repo root: bash scripts/phase2b/deploy-app-control-phase2.sh
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
REPO_ROOT=$(git rev-parse --show-toplevel)
SUPABASE_DIR=/opt/peritus-supabase
FUNCTIONS_DIR=/opt/peritus-functions

cd "$REPO_ROOT"

echo "=== [1/5] copying migrations to VM ==="
scp supabase/migrations/20260515120000_wdac_policy_templates.sql       "$VM:/tmp/"
scp supabase/migrations/20260515120100_wdac_rule_set_rings.sql         "$VM:/tmp/"
scp supabase/migrations/20260515120200_app_control_state_rings.sql     "$VM:/tmp/"

echo "=== [2/5] applying migrations ==="
ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
COMPOSE="sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml"

apply() {
    local file=$1
    echo "  applying $file"
    $COMPOSE exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "/tmp/$file"
}

apply 20260515120000_wdac_policy_templates.sql
apply 20260515120100_wdac_rule_set_rings.sql
apply 20260515120200_app_control_state_rings.sql
REMOTE

echo "=== [3/5] deploying agent-app-control edge function ==="
ssh "$VM" "sudo mkdir -p $FUNCTIONS_DIR/agent-app-control"
scp supabase/functions/agent-app-control/index.ts "$VM:/tmp/agent-app-control-index.ts"
ssh "$VM" "sudo install -m 644 /tmp/agent-app-control-index.ts $FUNCTIONS_DIR/agent-app-control/index.ts"

echo "=== [4/5] reloading edge runtime ==="
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml restart functions"
sleep 5
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml logs functions --tail=10"

echo "=== [5/5] building + deploying frontend ==="
cd "$REPO_ROOT"
VITE_SUPABASE_URL=http://192.168.99.143:8000 \
VITE_SUPABASE_ANON_KEY=$(ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T supabase-auth sh -c 'echo \$ANON_KEY' 2>/dev/null || cat /opt/peritus-supabase/.env | grep ANON_KEY | cut -d= -f2") \
  npm run build -- --mode staging 2>&1 | tail -5

echo "  copying dist to VM"
ssh "$VM" "sudo mkdir -p /opt/peritus-frontend"
rsync -az --delete dist/ "$VM:/tmp/peritus-frontend-dist/"
ssh "$VM" "sudo rsync -az --delete /tmp/peritus-frontend-dist/ /opt/peritus-frontend/"

echo "=== deploy complete ==="
```

- [ ] **Step 2: Make the script executable and commit**

```powershell
# On Linux (Bash tool):
# chmod +x scripts/phase2b/deploy-app-control-phase2.sh
git add scripts/phase2b/deploy-app-control-phase2.sh
git commit -m "chore: add phase2b deploy script for app-control phase 2

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 3: Check the ANON_KEY on the VM to pass to the frontend build**

```bash
ssh itadmin@192.168.99.143 "grep ANON_KEY /opt/peritus-supabase/.env | head -1"
```

Expected: a line like `ANON_KEY=eyJ...` (a JWT).

- [ ] **Step 4: Run the build locally pointing at the replica (get the anon key first)**

```powershell
# Adjust VITE_SUPABASE_ANON_KEY to the value from step 3
$env:VITE_SUPABASE_URL = "http://apidev.peritusdigital.com.au"
$env:VITE_SUPABASE_ANON_KEY = "<anon key from step 3>"
npm run build
```

Expected: `dist/` produced with no TypeScript errors.

- [ ] **Step 5: Apply migrations on VM**

```bash
bash scripts/phase2b/deploy-app-control-phase2.sh
```

Expected output:
```
=== [1/5] copying migrations to VM ===
=== [2/5] applying migrations ===
  applying 20260515120000_wdac_policy_templates.sql
  applying 20260515120100_wdac_rule_set_rings.sql
  applying 20260515120200_app_control_state_rings.sql
=== [3/5] deploying agent-app-control edge function ===
=== [4/5] reloading edge runtime ===
...functions container restarted...
=== [5/5] building + deploying frontend ===
=== deploy complete ===
```

- [ ] **Step 6: Smoke test — verify templates seeded**

```bash
ssh itadmin@192.168.99.143 "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T db psql -U postgres -d postgres -c \"SELECT name FROM wdac_policy_templates ORDER BY name;\""
```

Expected:
```
       name
------------------
 Dev Workstation
 Office Worker
 Reception / Kiosk
(3 rows)
```

- [ ] **Step 7: Smoke test — verify rings table exists**

```bash
ssh itadmin@192.168.99.143 "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml exec -T db psql -U postgres -d postgres -c \"\d wdac_rule_set_rings\""
```

Expected: table description showing `rule_set_id`, `group_id`, `mode`, `ring_order` columns.

- [ ] **Step 8: Smoke test — open frontend and verify template dropdown appears**

Open `https://appdev.peritusdigital.com.au` in a browser (hosts file must point to 192.168.99.143).

Navigate to: Security → Application Control → Rule Sets tab → "Create Rule Set".

Expected: "Start from template" dropdown appears above the Name field with options: blank, Office Worker, Dev Workstation, Reception / Kiosk.

- [ ] **Step 9: Smoke test — create rule set from template and verify rules**

1. Select "Office Worker" from the template dropdown.
2. Enter a name (e.g. "Test Office").
3. Click Create.
4. Click the new rule set to open the detail view.

Expected: Allow Rules section shows ~10 path-based rules (Windows, Microsoft, Chrome, Firefox, Adobe).

- [ ] **Step 10: Smoke test — add a ring and verify the panel**

1. In the detail view, verify "Pilot Rings" panel appears.
2. If endpoint groups exist: click "Add Ring", select a group, click "Add Ring".
3. Verify the ring appears with mode badge "Audit" and a "Promote" button.
4. Click "Promote" → confirm → verify badge changes to "Enforce".

- [ ] **Step 11: Final commit if any fixups were needed during smoke test**

```powershell
git add -p   # stage only intentional changes
git commit -m "fix: smoke test fixups for app-control phase 2"
```

---

## Self-Review Checklist

**Spec coverage:**
- Publisher hint: ✅ Task 1 populates `publisher` column via path heuristics
- Templates table: ✅ Task 2 creates + seeds
- Template UI: ✅ Task 8 adds dropdown to create dialog, bulk-adds rules on create
- Rings table: ✅ Task 3 creates with correct FK + RLS
- Rings SQL function: ✅ Task 4 replaces function with ring CTE
- Rings UI: ✅ Task 7 creates panel, Task 8 wires it in
- Audit countdown in detail view: ✅ Task 8 Step 7 adds it
- Deploy: ✅ Task 9

**Placeholder scan:** None found — all steps have concrete code.

**Type consistency:**
- `RuleSetRing.mode` is `"audit" | "enforce" | "off"` in the hook and in the component — consistent.
- Template `rules` array shape matches `wdac_rule_set_rules` insert shape (sans id/created_at/created_by/rule_set_id) — consistent.
- `useWdacTemplates` returns `WdacPolicyTemplate[]`, consumed in `ApplicationControl.tsx` as `templates` — consistent.
