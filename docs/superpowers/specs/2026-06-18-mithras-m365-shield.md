# Mithras M365 Shield

**Date:** 2026-06-18
**Status:** Phase 1 build
**Owner:** Mithras
**Decision:** ship as an opt-in **module** that customers (or operators on
their behalf) can enable per organisation.

---

## 1. Why

Most SMBs we sell to sit on **M365 Business Basic ($8.10/user)** or
**Standard ($16.40/user)**. To get the identity + threat-protection
features they actually need they would normally have to pay:

| Microsoft SKU | Per-user/mo | What it actually buys |
|---|---|---|
| Entra ID P1 | $6.00 | Conditional Access, MFA enforcement controls, password protection |
| Entra ID P2 | $9.00 | PIM (time-boxed admin elevation), Identity Protection (risk scoring), access reviews |
| Defender for O365 Plan 1 | $2.00 | Safe Links, Safe Attachments, anti-phishing |
| Defender for O365 Plan 2 | $5.00 | Threat Explorer, AIR, Attack Simulator |
| Purview Audit Premium | $3.00 | 1-year audit log retention + search |
| Defender for Cloud Apps | $5.00 | OAuth app governance |

Or skip them all and pay $22.20/user for **M365 Business Premium**, which
bundles most of the above. That's a $14/user/month delta over Basic.

The buyer almost always wants the protection — they balk at the cost.
**Mithras M365 Shield is the cheaper, almost-equivalent substitute
delivered entirely through Microsoft Graph.**

This is a direct extension of the existing positioning shipped at
`/identity-defence` ("Conditional Access outcomes without the P1 licence")
— Shield extends it across the full P1/P2/DfO/Purview surface.

## 2. Goals / non-goals

**Goals**
- Opt-in module a customer can turn on per-org.
- Replicate the **outcomes** of Entra ID P1/P2 + Defender for O365 + Purview
  Audit + Defender for Cloud Apps using Graph API + existing platform infra.
- Coherent single dashboard at `/m365/shield` (NOT a scatter of disconnected
  features).
- Honest disclosure on every panel: where Mithras matches Microsoft, where
  it approximates, where it cannot replace.
- Marketing surface at `/m365-shield` with the per-seat savings calculator.

**Non-goals**
- Pre-delivery email pipeline insertion (Microsoft owns the SMTP path).
- Replacing SSPR (lives in the sign-in UI we don't control).
- AD-DS on-prem password protection (would need a DC agent — out of scope).
- Application Proxy.

## 3. Capability map — what we build vs the M365 SKU it substitutes

| Mithras capability | Replaces | Graph endpoint(s) | Parity |
|---|---|---|---|
| **PIM-lite** — time-boxed admin role elevation | Entra ID P2 PIM | `/roleManagement/directory/roleAssignments` | full |
| **Risky sign-in scoring** — per-user risk + auto-revoke | Entra ID P2 Identity Protection | `/auditLogs/signIns` | high (no cross-tenant ML) |
| **OAuth consent governance** — list + revoke risky grants | Defender for Cloud Apps (OAuth surface) | `/oauth2PermissionGrants` + delete | full |
| **Access reviews** — quarterly attestation of admins + guests + delegates | Entra ID P2 Access Reviews | `/directoryRoles`, `/users?$filter=userType eq 'Guest'`, `/users/{id}/mailboxSettings` | full |
| **MFA enforcement loop** — revoke until enrolled | Entra ID P1 (half of it) | `/users/{id}/authentication/methods` + Identity Defence rule | high |
| **Long-retention audit search** — 1yr searchable mirror | Purview Audit Premium | `/auditLogs/directoryAudits` + `/auditLogs/signIns` | full |
| **Post-delivery URL retraction** | DfO P1 Safe Links | `/users/{id}/messages` + delete | approximation (post-delivery only) |
| **Per-user risk dashboard** | DfO P2 Threat Explorer (identity slice) | aggregates of the above | full |

Already shipped before this module and pulled into the Shield dashboard:
- Conditional Access viewer + AI gap analysis (`m365-ca-poll`)
- Identity Defence rule engine (`identity-evaluate`)
- Cross-mailbox sweep + AI SOC (Threat Explorer / AIR equivalents on email)

## 4. Module shape — how a customer turns it on

Single boolean on `organizations`: `m365_shield_enabled`. Set via:

1. Super-admin toggles in `/admin/organizations/{id}` (operator-on-behalf).
2. Org admin toggles in their own settings (Phase 2 — start with operator-only).

When **off**, the `/m365/shield` page renders a marketing CTA, no polls run,
no risk scores compute. When **on**:

- `m365-pim-auto-revoke` cron starts auto-revoking expired elevations.
- `m365-risk-poll` cron starts computing per-user risk every 15 min.
- `m365-oauth-poll` cron starts inventorying + scoring OAuth grants daily.
- Audit-log forwarder retention extends from 90d → 365d (Phase 1A).
- Identity Defence gets two new templates (risky-signin, oauth-high-risk).

Module gate is checked inside each edge function before doing work, so we
don't need a separate cron-disable migration when turning a customer off.

## 5. Data model

### 5.1 `pim_elevations`

```sql
CREATE TABLE public.pim_elevations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id      UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    target_user_upn     TEXT NOT NULL,
    target_user_id      TEXT NOT NULL,  -- Graph user id
    role_template_id    TEXT NOT NULL,  -- e.g. 62e90394-69f5-4237-9190-012177145e10 (Global Admin)
    role_display_name   TEXT NOT NULL,
    reason              TEXT NOT NULL,
    requested_by        UUID REFERENCES auth.users(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_minutes    INT NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
    expires_at          TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'revoked', 'expired', 'failed')),
    graph_role_assignment_id TEXT,
    error_message       TEXT,
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID REFERENCES auth.users(id),
    revoke_reason       TEXT
);
```

### 5.2 `m365_signin_risk`

```sql
CREATE TABLE public.m365_signin_risk (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id      UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    user_upn            TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    risk_score          INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_level          TEXT NOT NULL CHECK (risk_level IN ('none','low','medium','high','critical')),
    risk_factors        JSONB NOT NULL DEFAULT '[]'::jsonb,
    signin_count_7d     INT NOT NULL DEFAULT 0,
    failed_signin_7d    INT NOT NULL DEFAULT 0,
    distinct_countries_7d INT NOT NULL DEFAULT 0,
    distinct_asns_7d    INT NOT NULL DEFAULT 0,
    last_signin_at      TIMESTAMPTZ,
    last_evaluated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (m365_tenant_id, user_id)
);
```

### 5.3 `m365_oauth_grants`

```sql
CREATE TABLE public.m365_oauth_grants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id      UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    grant_id            TEXT NOT NULL,   -- Graph oauth2PermissionGrants id
    client_app_id       TEXT NOT NULL,
    client_app_name     TEXT,
    publisher           TEXT,
    granted_to_user_id  TEXT,            -- null if admin-consent (all users)
    granted_to_user_upn TEXT,
    scopes              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    high_risk_scopes    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    risk_score          INT NOT NULL DEFAULT 0,
    risk_level          TEXT NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low','medium','high','critical')),
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID REFERENCES auth.users(id),
    deleted_at          TIMESTAMPTZ,
    UNIQUE (m365_tenant_id, grant_id)
);
```

### 5.4 `m365_access_reviews`

```sql
CREATE TABLE public.m365_access_reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id      UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    -- 'admin' | 'guest' | 'mailbox_delegate' | 'shared_mailbox'
    review_kind         TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID REFERENCES auth.users(id),
    due_at              TIMESTAMPTZ NOT NULL,
    completed_at        TIMESTAMPTZ,
    completed_by        UUID REFERENCES auth.users(id),
    item_count          INT NOT NULL DEFAULT 0,
    kept_count          INT NOT NULL DEFAULT 0,
    removed_count       INT NOT NULL DEFAULT 0
);

CREATE TABLE public.m365_access_review_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id           UUID NOT NULL REFERENCES public.m365_access_reviews(id) ON DELETE CASCADE,
    subject_id          TEXT NOT NULL,    -- user id / mailbox id
    subject_label       TEXT NOT NULL,    -- UPN or display name
    detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision            TEXT CHECK (decision IN ('keep','remove')),
    decided_at          TIMESTAMPTZ,
    decided_by          UUID REFERENCES auth.users(id),
    enforced_at         TIMESTAMPTZ,
    enforcement_error   TEXT
);
```

### 5.5 `m365_shield_enabled` on `organizations`

```sql
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS m365_shield_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS m365_shield_enabled_at TIMESTAMPTZ;
```

### 5.6 RPC `get_m365_shield_overview(p_org_id UUID)`

Returns a single JSON blob the dashboard renders:

```jsonc
{
  "enabled": true,
  "active_elevations": 1,
  "elevations_24h": 4,
  "high_risk_users": 3,
  "critical_risk_users": 0,
  "oauth_grants_total": 47,
  "oauth_grants_high_risk": 5,
  "open_reviews": 1,
  "audit_retention_days": 365
}
```

## 6. Edge functions

| Function | Trigger | Auth | What it does |
|---|---|---|---|
| `m365-pim-elevate` | UI (operator click) | user JWT (org admin) | Adds role assignment via Graph; writes pim_elevations row with status=active |
| `m365-pim-auto-revoke` | cron every 5 min | cron-secret | Finds pim_elevations where status=active AND expires_at<now(); calls Graph DELETE; status=expired |
| `m365-risk-poll` | cron every 15 min | cron-secret | For each shielded tenant: pull last 24h signIns, group by user, compute risk score, upsert m365_signin_risk |
| `m365-oauth-poll` | cron daily 04:13 | cron-secret | For each shielded tenant: pull oauth2PermissionGrants, score against HIGH_RISK_OAUTH_SCOPES, upsert m365_oauth_grants |
| `m365-oauth-revoke` | UI (operator click) | user JWT (org admin) | DELETE /oauth2PermissionGrants/{id}; mark revoked_at |
| `m365-access-review-create` | UI | user JWT (org admin) | Pull current admins/guests/delegates from Graph, create review + items |
| `m365-access-review-enforce` | UI | user JWT (org admin) | For each item with decision=remove: enforce via Graph (remove role / remove guest / remove delegate) |

Cron entries:
- `mithras-m365-pim-auto-revoke`: `*/5 * * * *`
- `mithras-m365-risk-poll`: `1,16,31,46 * * * *` (offset from other 15-min crons)
- `mithras-m365-oauth-poll`: `13 4 * * *` (daily, off-peak)

## 7. Risk scoring algorithm (m365-risk-poll)

For each user, pull last 24h of sign-ins from `/auditLogs/signIns`. Compute:

| Factor | Trigger | Points |
|---|---|---|
| Failed sign-in rate >50% in 24h | password spray candidate | 25 |
| Sign-in from new country (not seen in last 30d) | geo anomaly | 20 |
| Sign-in from TOR exit / known-bad ASN | infrastructure flag | 30 |
| Impossible travel (>500km in <1h between successful signins) | session theft | 35 |
| Sign-in from ASN never seen for this user | new infrastructure | 15 |
| Failed MFA prompt | possible MFA bombing | 15 |
| Sign-in outside 8am-8pm local 5+ times in 24h | off-hours pattern | 10 |
| User has no MFA registered (from authenticationMethods) | static factor | 20 |

Cap at 100. Map: 0-19 none, 20-39 low, 40-59 medium, 60-79 high, 80-100 critical.

Auto-action: if `risk_level='critical'` AND org has Identity Defence rule
`risky_signin_critical` in enforce mode → revokeSignInSessions.

(Identity Defence already enforces all the safety guardrails — break-glass,
rate limit, cooldown, kill switch — so we don't duplicate them here.)

## 8. Safety rails

- Module disabled by default. Operator must explicitly enable per-org.
- PIM elevations cap at 8 hours; 15-min minimum.
- PIM elevations require a written reason (free text, captured in audit).
- PIM elevations to "Global Administrator" or "Privileged Role Administrator"
  require a confirmation typed dialog ("type GLOBAL ADMIN to confirm").
- PIM auto-revoke runs every 5 min so a missed manual revoke caps exposure
  at 5 min past expiry.
- OAuth revoke takes a confirmation dialog naming the app.
- Risky sign-in critical auto-revoke gated on Identity Defence rule mode —
  no silent enforcement.
- Access review enforcement is opt-in per row (not bulk) in Phase 1.
- Audit log retention extends only after enable — no retroactive backfill
  of >90d data we don't have.

## 9. UI surfaces

### `/m365/shield` (operator console — gated on `m365_shield_enabled`)

Tabs:
1. **Overview** — KPI strip (active elevations, high-risk users, OAuth at-risk, open reviews); honest disclosure banner; recent activity.
2. **PIM** — table of elevations (active, recent), "Elevate user" button.
3. **Risky users** — risk-ranked table with expandable factors, "Revoke sessions" action.
4. **OAuth grants** — table with risk badges, "Revoke" action.
5. **Access reviews** — open reviews + history.
6. **Settings** — module toggle, audit retention setting, cron status.

### `/m365-shield` (public marketing)

- Hero: "M365 Shield — Conditional Access, PIM, Identity Protection. Without the Entra ID licence."
- Savings calculator: seats in → monthly delta out
- Capability ↔ Microsoft SKU table
- Honest disclosure section
- FAQ
- CTA → Contact sales

### Sidebar

Under "M365" section: add **Shield** entry visible when
`m365_shield_enabled=true` for the active org. Otherwise show "Enable
Shield" CTA.

## 10. Build sequence (this session)

1. ✅ Spec (this file)
2. Migration `20260618010000_m365_shield.sql` — all tables + RPC + flag
3. Migration `20260618020000_m365_shield_crons.sql` — pg_cron schedules
4. Edge fn `m365-pim-elevate` + `m365-pim-auto-revoke`
5. Edge fn `m365-risk-poll`
6. Edge fn `m365-oauth-poll` + `m365-oauth-revoke`
7. Hook `useM365Shield`
8. Page `/m365/shield`
9. Marketing page `/m365-shield`
10. Sidebar + sitemap + smoke-test additions
11. Deploy via extended deploy-cadence-batch.sh; smoke test
12. End-to-end manual test against a known-connected tenant

## 11. Phase 2 (NOT this session)

- Access reviews UI + enforcement
- MFA enforcement loop (Identity Defence template)
- Post-delivery URL retraction at scale
- Audit retention promotion to a real searchable UI (1yr)
- Attachment detonation via sandbox partner
- Customer-self-service enable toggle
- M365 Shield row on monthly customer report

## 12. Open questions (defer)

- Do we expose PIM-lite to home-user organisations? (probably no — they
  don't have admin role separation that matters)
- Should the savings calculator use AUD or USD by default? (AUD for our
  primary market; show toggle)
- Do we need to detect when the customer ALSO has real Entra ID P2 and
  refuse to run PIM-lite to avoid confusing them? (probably yes — add a
  warning, allow override)
