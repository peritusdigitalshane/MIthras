-- 20260617060000_identity_defence.sql
--
-- Mithras Identity Defence Phase A. Declarative access rules over signals
-- the platform already collects. Detect-then-revoke on a poll cadence
-- (the rule loop runs on its own cron). NOT a preventive control at
-- Microsoft's identity stack — Mithras' enforcement primitive is
-- revokeSignInSessions, which forces re-auth via the customer's existing
-- MFA (Security Defaults / per-user MFA / their own CA if they have one).
--
-- Phase A includes three templates that work WITHOUT an Entra ID P1
-- licence: suspicious-mailbox-rule, oauth-grant-by-non-admin, and
-- endpoint-defender-critical. Each is opt-in and ships in report-only
-- mode by default; operator must promote to enforce.

-- ---------------------------------------------------------------------------
-- 0. Add endpoints.primary_user_upn — Identity Defence needs to map an
--    endpoint detection to an M365 user for revokeSignInSessions. The
--    column is populated by the agent (Phase A.5 work) or by an org-level
--    fallback when the agent hasn't reported one yet (see helper below).
-- ---------------------------------------------------------------------------
ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS primary_user_upn TEXT;

CREATE INDEX IF NOT EXISTS idx_endpoints_primary_user_upn
    ON public.endpoints (primary_user_upn) WHERE primary_user_upn IS NOT NULL;

COMMENT ON COLUMN public.endpoints.primary_user_upn IS
'M365 user principal name of the primary user of this endpoint. Populated by the agent on heartbeat (the logged-on user). For home-user organisations a fallback is provided by resolving organizations.home_user_email.';

-- Helper: resolve the primary user for an endpoint. Returns the agent-
-- reported UPN when known, else falls back to organizations.home_user_email
-- when the parent org is a home-user single-tenant. Returns NULL otherwise
-- (business-org endpoints without agent-reported UPN simply don't get
-- acted on by Identity Defence rules until the agent reports).
CREATE OR REPLACE FUNCTION public.endpoint_primary_user_upn(p_endpoint_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        e.primary_user_upn,
        CASE
            WHEN o.organization_type = 'home_user' THEN o.home_user_email
            ELSE NULL
        END
    )
    FROM public.endpoints e
    JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.id = p_endpoint_id;
$$;

GRANT EXECUTE ON FUNCTION public.endpoint_primary_user_upn(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Rules table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_access_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    -- Stable key for the kind of signal that triggers this rule. Maps to a
    -- corresponding evaluator branch in the identity-evaluate edge fn.
    -- Phase A: 'mailbox_rule_added' | 'oauth_grant_by_non_admin' | 'endpoint_defender_critical'.
    trigger_kind        TEXT NOT NULL,
    -- Per-kind configuration (e.g. for mailbox_rule_added: which destination
    -- types count as "suspicious" — external forwarders, delete-on-receive, etc.).
    trigger_config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Who the rule applies to. Either "all" or an object with include/exclude
    -- arrays of user-principal-name strings.
    applies_to          JSONB NOT NULL DEFAULT '"all"'::jsonb,
    -- Ordered list of actions to take on a fire. Phase A supports:
    --   { kind: 'revoke_sessions' }
    --   { kind: 'notify_soc', severity: 'critical'|'high'|'medium' }
    --   { kind: 'isolate_endpoint' }   (only meaningful for endpoint-driven rules)
    --   { kind: 'disable_account' }    (heavy hammer, requires extra confirm)
    actions             JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- 'off' | 'report_only' | 'enforce'. New rules MUST start as report_only;
    -- operator promotes after observing dry-run output.
    mode                TEXT NOT NULL DEFAULT 'report_only'
        CHECK (mode IN ('off', 'report_only', 'enforce')),
    -- Per-user-per-day cap on actions taken by this rule. Default 1 — a rule
    -- shouldn't kick the same user 30 times in an hour.
    rate_limit_per_user_per_day INT NOT NULL DEFAULT 1
        CHECK (rate_limit_per_user_per_day BETWEEN 1 AND 100),
    -- Explicit break-glass list. Users on this list are NEVER acted on, no
    -- matter what the rule sees. Enforced at the evaluator level — operator
    -- cannot bypass.
    break_glass_users   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Audit metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Tracks when the rule was promoted out of report_only — used for the
    -- first-24h cooldown enforcement.
    enforce_started_at  TIMESTAMPTZ,
    -- When was this rule's evaluator last invoked? Used by the evaluator to
    -- look at "signals since this timestamp".
    last_evaluated_at   TIMESTAMPTZ,
    -- Operator-tunable per-rule notes.
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_identity_rules_org
    ON public.identity_access_rules (organization_id, mode);

COMMENT ON TABLE public.identity_access_rules IS
'Mithras Identity Defence — declarative access rules. Detect-and-respond loop, not a preventive identity gate.';
COMMENT ON COLUMN public.identity_access_rules.mode IS
'off | report_only | enforce. New rules start report_only; operator promotes after dry-run observation.';
COMMENT ON COLUMN public.identity_access_rules.break_glass_users IS
'Hard exclusion. These users are never acted on. Evaluator-level enforcement; cannot be bypassed by rule config.';

-- ---------------------------------------------------------------------------
-- 2. Actions ledger — append-only record of every enforcement decision
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_actions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    rule_id             UUID REFERENCES public.identity_access_rules(id) ON DELETE SET NULL,
    -- Who the action was about — the M365 user principal name, or for
    -- endpoint-driven actions the primary user of the endpoint.
    target_user         TEXT NOT NULL,
    -- 'enforced' | 'would_have_fired' (report_only) | 'skipped_break_glass'
    -- | 'skipped_rate_limit' | 'skipped_cooldown' | 'skipped_org_cap' | 'failed'.
    outcome             TEXT NOT NULL,
    -- What we did (or would have done).
    actions_taken       JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- The evidence that triggered the rule. Always populated — without
    -- evidence the operator can't audit why we acted.
    evidence            JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Raw Graph response (or error) per action, useful for debugging.
    graph_response      JSONB,
    error_message       TEXT,
    -- Operator review fields — for after-the-fact triage.
    reviewed_at         TIMESTAMPTZ,
    reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    review_verdict      TEXT,    -- 'correct' | 'false_positive' | 'inconclusive'
    review_note         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_actions_org_time
    ON public.identity_actions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_actions_rule
    ON public.identity_actions (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_actions_user
    ON public.identity_actions (organization_id, target_user, created_at DESC);

COMMENT ON TABLE public.identity_actions IS
'Append-only ledger of every Identity Defence action (enforced or report_only). Operator-reviewable. Retained 12 months.';

-- ---------------------------------------------------------------------------
-- 3. RLS — read for org members, write for service-role only
-- ---------------------------------------------------------------------------
ALTER TABLE public.identity_access_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_actions       ENABLE ROW LEVEL SECURITY;

-- READ for the rules table — org members + partner admins + super-admins
DROP POLICY IF EXISTS identity_rules_select ON public.identity_access_rules;
CREATE POLICY identity_rules_select ON public.identity_access_rules FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- INSERT / UPDATE / DELETE — org admins + super-admins. Rule changes are
-- material; we restrict to admins.
DROP POLICY IF EXISTS identity_rules_insert ON public.identity_access_rules;
CREATE POLICY identity_rules_insert ON public.identity_access_rules FOR INSERT
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS identity_rules_update ON public.identity_access_rules;
CREATE POLICY identity_rules_update ON public.identity_access_rules FOR UPDATE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    )
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS identity_rules_delete ON public.identity_access_rules;
CREATE POLICY identity_rules_delete ON public.identity_access_rules FOR DELETE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- READ for actions ledger — same as rules.
DROP POLICY IF EXISTS identity_actions_select ON public.identity_actions;
CREATE POLICY identity_actions_select ON public.identity_actions FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- UPDATE (review fields only) — org admins.
DROP POLICY IF EXISTS identity_actions_review ON public.identity_actions;
CREATE POLICY identity_actions_review ON public.identity_actions FOR UPDATE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- ---------------------------------------------------------------------------
-- 4. Touch updated_at on rule changes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_identity_rules_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    -- Track when a rule first becomes 'enforce' so the first-24h cooldown
    -- can be computed without storing a separate enforcement-history row.
    IF NEW.mode = 'enforce' AND (OLD.mode IS NULL OR OLD.mode <> 'enforce') THEN
        NEW.enforce_started_at = now();
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_identity_rules_touch ON public.identity_access_rules;
CREATE TRIGGER trg_identity_rules_touch BEFORE UPDATE ON public.identity_access_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_identity_rules_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Overview RPC — dashboard tile + page header
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_identity_defence_overview(p_org_id UUID)
RETURNS TABLE (
    rules_total           INT,
    rules_enforced        INT,
    rules_report_only     INT,
    actions_last_24h      INT,
    actions_enforced_24h  INT,
    actions_report_only_24h INT,
    last_action_at        TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT
        (SELECT count(*)::int FROM public.identity_access_rules WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.identity_access_rules WHERE organization_id = p_org_id AND mode = 'enforce'),
        (SELECT count(*)::int FROM public.identity_access_rules WHERE organization_id = p_org_id AND mode = 'report_only'),
        (SELECT count(*)::int FROM public.identity_actions WHERE organization_id = p_org_id AND created_at >= now() - interval '24 hours'),
        (SELECT count(*)::int FROM public.identity_actions WHERE organization_id = p_org_id AND created_at >= now() - interval '24 hours' AND outcome = 'enforced'),
        (SELECT count(*)::int FROM public.identity_actions WHERE organization_id = p_org_id AND created_at >= now() - interval '24 hours' AND outcome = 'would_have_fired'),
        (SELECT max(created_at) FROM public.identity_actions WHERE organization_id = p_org_id)
    ;
$$;

GRANT EXECUTE ON FUNCTION public.get_identity_defence_overview(UUID) TO authenticated;
