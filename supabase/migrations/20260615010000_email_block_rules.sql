-- =============================================================================
-- Email security: per-tenant block rules
--
-- Customer admins (and partner admins / super admins) can define rules that
-- short-circuit the AI classifier. When a rule matches an inbound message:
--
--   action = 'quarantine'  → move to Junk Email, record as 'quarantined'
--   action = 'warn'        → move to Junk + send recipient warning email
--   action = 'drop'        → record only (no Graph action; useful for
--                            high-volume known-spam where you want the
--                            dashboard count but no inbox noise)
--
-- Lookups happen in the sweep BEFORE the LLM call. Matches save tokens and
-- give predictable behaviour for known-bad senders / domains / subjects.
--
-- Multi-tenancy: every rule is scoped to one organization_id; RLS gates read
-- + write to org admins / partner admins / super admins. The sweep runs
-- service-key so it can read rules across all tenants.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_block_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('sender_email','sender_domain','subject_regex')),
    value           text NOT NULL,
    action          text NOT NULL CHECK (action IN ('quarantine','warn','drop')) DEFAULT 'quarantine',
    reason          text,
    enabled         boolean NOT NULL DEFAULT true,
    hit_count       integer NOT NULL DEFAULT 0,
    last_hit_at     timestamptz,
    created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, kind, value)
);

CREATE INDEX IF NOT EXISTS email_block_rules_org_lookup_idx
    ON public.email_block_rules (organization_id, enabled, kind);

-- Mark the threat row with the rule that matched, so SOC can audit.
ALTER TABLE public.email_threats
    ADD COLUMN IF NOT EXISTS matched_rule_id uuid REFERENCES public.email_block_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_threats_matched_rule_idx
    ON public.email_threats (matched_rule_id) WHERE matched_rule_id IS NOT NULL;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_email_block_rules_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_block_rules_updated_at ON public.email_block_rules;
CREATE TRIGGER trg_email_block_rules_updated_at
    BEFORE UPDATE ON public.email_block_rules
    FOR EACH ROW EXECUTE FUNCTION public.touch_email_block_rules_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_block_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_block_rules_select ON public.email_block_rules;
CREATE POLICY email_block_rules_select ON public.email_block_rules
FOR SELECT TO authenticated
USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS email_block_rules_insert ON public.email_block_rules;
CREATE POLICY email_block_rules_insert ON public.email_block_rules
FOR INSERT TO authenticated
WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS email_block_rules_update ON public.email_block_rules;
CREATE POLICY email_block_rules_update ON public.email_block_rules
FOR UPDATE TO authenticated
USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS email_block_rules_delete ON public.email_block_rules;
CREATE POLICY email_block_rules_delete ON public.email_block_rules
FOR DELETE TO authenticated
USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
);

-- ----------------------------------------------------------------------------
-- Helper: normalize value at insert / update time. Senders + domains are
-- lowercased and trimmed; subject_regex is left as-is.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_email_block_rule()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind IN ('sender_email','sender_domain') THEN
        NEW.value = lower(btrim(NEW.value));
    ELSE
        NEW.value = btrim(NEW.value);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_email_block_rule ON public.email_block_rules;
CREATE TRIGGER trg_normalize_email_block_rule
    BEFORE INSERT OR UPDATE ON public.email_block_rules
    FOR EACH ROW EXECUTE FUNCTION public.normalize_email_block_rule();

-- ----------------------------------------------------------------------------
-- RPC: atomically bump hit counter from the sweep. SECURITY DEFINER so the
-- service-role call doesn't need to know RLS internals; we still gate the
-- update by id only (rules are never re-keyed).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_email_block_rule_hit(_rule_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.email_block_rules
       SET hit_count   = hit_count + 1,
           last_hit_at = now()
     WHERE id = _rule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_email_block_rule_hit(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_email_block_rule_hit(uuid) TO service_role;

COMMENT ON TABLE public.email_block_rules IS
'Per-tenant block rules consulted by m365-email-sweep before AI classification. Matches short-circuit the LLM and trigger the configured action.';
