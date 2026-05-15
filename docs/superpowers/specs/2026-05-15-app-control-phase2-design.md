# App-Control Phase 2 Design — Easier Audit → Enforce

## Goal

Make the WDAC audit-to-enforce journey fast and low-risk for MSP operators who are not WDAC experts. Three features: (1) publisher grouping + bulk approve in the discovered-apps screen, (2) starter rule-set templates, (3) pilot ring promotion using existing endpoint groups.

---

## Context

Phase 1 shipped the full audit→enforce pipeline: agents stream CodeIntegrity 3076/3077 events to the platform, the heartbeat response carries a merged policy, and the agent applies it via ConvertFrom-CIPolicy / CiTool. The gap is UX: operators today must approve hundreds of discovered apps one by one, have no starting point when creating a new rule set, and must flip the entire org to enforce at once.

---

## Approach

Extend the existing rule-set detail page and "New Rule Set" dialog. No new navigation routes. No wizard. All three features land on surfaces that already exist.

---

## Data Model

### 1. `wdac_discovered_apps.publisher` — already exists, will be populated

The column exists (`publisher TEXT`) but is currently null for CodeIntegrity-sourced observations because the agent does not extract Authenticode data. Instead, the `agent-app-control/observed` edge function will compute a publisher hint from the `file_path` using a hardcoded path-prefix map (see Backend section) and write it into the `publisher` column on upsert. No schema migration needed for this column.

### 2. `wdac_policy_templates` (new table)

```sql
CREATE TABLE public.wdac_policy_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  rules       jsonb NOT NULL DEFAULT '[]',  -- array of wdac_rule_set_rules-shaped objects
  is_system   bool NOT NULL DEFAULT true,   -- false reserved for future org-level templates
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

RLS: SELECT open to all authenticated users; INSERT/UPDATE/DELETE restricted to super_admins only (system-curated).

Seeded with three templates (see Templates section).

### 3. `wdac_rule_set_rings` (new table)

```sql
CREATE TABLE public.wdac_rule_set_rings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id uuid NOT NULL REFERENCES public.wdac_rule_sets(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.endpoint_groups(id) ON DELETE CASCADE,
  mode        text NOT NULL CHECK (mode IN ('audit','enforce','off')),
  ring_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, group_id)
);
```

RLS: SELECT for org members; INSERT/UPDATE/DELETE for org admins (checked via `wdac_rule_sets.organization_id`).

### 4. `app_control_state_for_endpoint()` — updated

The function gains a ring-mode lookup. After computing the base mode from `endpoint_app_control_state`, it checks `wdac_rule_set_rings` for any ring whose `group_id` matches a group the endpoint belongs to. If found, the ring's mode overrides the row in `endpoint_app_control_state` for that rule set. Tie-break: enforce > audit > off; if multiple groups match, use the lowest `ring_order` (most specific ring wins).

The change is purely inside the SQL function body — the function signature, return type, and callers are unchanged.

---

## Feature 1 — Publisher Grouping + Bulk Approve

### Backend (edge function: `agent-app-control/observed`)

When an observation upsert arrives, compute publisher from file_path using this prefix map (TypeScript):

```typescript
const PUBLISHER_PREFIXES: [string, string][] = [
  ['C:\\Windows\\', 'Windows'],
  ['C:\\Program Files\\Microsoft ', 'Microsoft'],
  ['C:\\Program Files (x86)\\Microsoft ', 'Microsoft'],
  ['C:\\Program Files\\Common Files\\Microsoft ', 'Microsoft'],
  ['C:\\Program Files\\Google\\', 'Google'],
  ['C:\\Program Files (x86)\\Google\\', 'Google'],
  ['C:\\Program Files\\Adobe\\', 'Adobe'],
  ['C:\\Program Files (x86)\\Adobe\\', 'Adobe'],
  ['C:\\Program Files\\Mozilla Firefox\\', 'Mozilla'],
  ['C:\\Program Files\\VideoLAN\\', 'VLC'],
  ['C:\\Program Files\\7-Zip\\', '7-Zip'],
  ['C:\\Program Files\\Notepad++\\', 'Notepad++'],
  ['C:\\Program Files\\WinRAR\\', 'WinRAR'],
  ['C:\\Program Files\\TeamViewer\\', 'TeamViewer'],
  ['C:\\Program Files\\Zoom\\', 'Zoom'],
];

function inferPublisher(filePath: string): string {
  const upper = filePath.toUpperCase();
  for (const [prefix, pub] of PUBLISHER_PREFIXES) {
    if (upper.startsWith(prefix.toUpperCase())) return pub;
  }
  return 'Unknown / Unsigned';
}
```

On upsert, set `publisher = inferPublisher(app.file_path)` if the existing row has `publisher IS NULL`.

### Frontend (`src/components/security/DiscoveredAppsTable.tsx` — new or extended)

The rule set detail page's discovered-apps section gains a toggle: **"Individual" | "By Publisher"**.

**Individual view** (existing behaviour): one row per (file_path, file_hash), approve button per row creates a `hash` rule in `wdac_rule_set_rules`.

**By Publisher view** (new):
- Group rows by `publisher` value.
- Each group row shows: publisher name, app count, total exec_count, "Trust Publisher" button.
- "Trust Publisher" creates a `path` allow rule with value = the publisher's root directory pattern (e.g. `C:\Program Files\Microsoft *`). The path-pattern map is the same prefix list used on the backend.
- "Unknown / Unsigned" bucket appears at the bottom; apps in it must be approved individually (no bulk trust button).
- Expanding a publisher row reveals the individual file list.

---

## Feature 2 — Starter Templates

### Backend

Seed migration inserts three templates into `wdac_policy_templates`:

**Office Worker** — allow rules for:
- `path C:\Windows\*`
- `path C:\Program Files\Microsoft Office\*`
- `path C:\Program Files\Microsoft\*` (Teams, OneDrive, Edge)
- `path C:\Program Files (x86)\Microsoft\*`
- `path C:\Program Files\Google\Chrome\*`
- `path C:\Program Files\Mozilla Firefox\*`
- `path C:\Program Files\Adobe\*`

**Dev Workstation** — everything in Office Worker plus:
- `path C:\Program Files\Microsoft VS Code\*`
- `path C:\Program Files\Git\*`
- `path C:\Program Files\nodejs\*`
- `path C:\Program Files\Docker\*`
- `path C:\Users\*\AppData\Local\Programs\*` (user-installed dev tools)

**Reception / Kiosk** — restrictive:
- `path C:\Windows\*`
- `path C:\Program Files\Google\Chrome\*`
- `path C:\Program Files\Microsoft\Edge\*`

### Frontend (`src/components/security/NewRuleSetDialog.tsx` — modified)

Add a "Start from template" `<Select>` above the Name field. Options: blank (default), Office Worker, Dev Workstation, Reception / Kiosk. On selection, the rules list is pre-populated with the template's rules (fetched from `wdac_policy_templates`). Operator can edit, add, or remove rules before saving. Templates are cosmetic starting points — selecting one does not lock the rule set.

---

## Feature 3 — Pilot Ring Promotion

### UI (`src/components/security/RuleSetRingsPanel.tsx` — new)

A collapsible "Rings" section on the rule set detail page, below the existing audit countdown. Contains:

- A list of assigned rings, each row showing: group name, endpoint count, current ring mode badge (Audit / Enforce), ring order, "Promote to Enforce" button (if currently audit), "Remove ring" button.
- "Add ring" button: opens a `<Select>` of endpoint groups that belong to the same org and aren't already in a ring for this rule set.
- When adding a ring, default mode = audit (i.e. same as or more conservative than the rule set global mode).

**Promote to Enforce flow:**
1. Operator clicks "Promote to Enforce" on a ring row.
2. Confirmation dialog: "Move [group name] ([N] endpoints) to enforce mode?"
3. On confirm: `UPDATE wdac_rule_set_rings SET mode='enforce' WHERE id=?`
4. The next heartbeat for each endpoint in that group will receive `mode: 'enforce'` from `app_control_state_for_endpoint()`.
5. Toast: "Ring promoted — endpoints will switch to enforce on next heartbeat."

**Ring order** is editable (number input or drag). Lower order = higher priority when an endpoint is in multiple groups.

### How rings affect the agent

`app_control_state_for_endpoint()` updated (SQL):

```sql
-- Inside the function, after the existing active CTE:
, ring_override AS (
  SELECT r.mode AS ring_mode, r.ring_order
  FROM public.wdac_rule_set_rings r
  JOIN public.endpoint_group_memberships m ON m.group_id = r.group_id
  WHERE m.endpoint_id = p_endpoint_id
    AND r.rule_set_id IN (SELECT rule_set_id FROM active)
  ORDER BY r.ring_order ASC
  LIMIT 1
)
```

If a `ring_override` row exists, its `ring_mode` replaces the corresponding `active.current_mode` for that rule set when building the merged mode. Enforce still beats audit across rule sets.

---

## Error Handling

- **Template load fails**: "New Rule Set" dialog shows rule list empty with an inline error; operator can still create a blank rule set.
- **"Trust Publisher" insert fails**: toast error, no partial writes (wrap in a transaction or insert rules individually with per-row error recovery).
- **Ring promote fails**: toast error, row reverts visually via TanStack Query cache invalidation.
- **`app_control_state_for_endpoint` ring CTE finds no match**: falls through to existing behaviour (no regression).

---

## Testing

### Unit / integration (Pester — no new PowerShell code, so no new Pester tests)

### Frontend hooks
- `useWdacTemplates()` — fetches `wdac_policy_templates` ordered by name.
- `useRuleSetRings(ruleSetId)` — fetches `wdac_rule_set_rings` joined to `endpoint_groups` + group member count.
- `usePromoteRing()` — mutation: UPDATE mode to enforce.
- `useAddRing()` / `useRemoveRing()` — mutations.

### Database
- Migration test: after migration, `wdac_rule_set_rings` exists, 3 templates are seeded.
- SQL function test (run against replica): assign endpoint to two groups, add both groups as rings with different modes (audit/enforce), call `app_control_state_for_endpoint` and assert mode = enforce.

### Manual smoke test on replica
1. Create rule set from "Office Worker" template — verify rules pre-populated.
2. Enroll a discovered app observation (use `curl` against `agent-app-control/observed`) — verify `publisher` is set.
3. Toggle "By Publisher" — verify Microsoft group appears with bulk-trust button.
4. Add a ring (e.g. "IT Staff" group) to a rule set in audit mode — verify ring row appears.
5. Promote ring to enforce — verify next heartbeat response for an endpoint in that group returns `mode: enforce`.

---

## Out of Scope

- Custom (org-level) templates — `is_system = false` is reserved but not implemented.
- Automatic ring promotion (promote after N block-free days) — manual only.
- Rollback button (demote enforce → audit) — can be added later; ring row UPDATE is trivially reversible by editing mode in the DB directly for now.
- Percentage-based ring selection.
- Authenticode signature extraction in the agent.
