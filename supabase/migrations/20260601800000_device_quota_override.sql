-- Per-org device-quota override.
--
-- The current quota gate uses subscription_plan → plan_features.max_devices
-- to compute how many endpoints an org can enrol. That's fine for clean
-- tiering but the MSP reality is messier: trial customers, contractually
-- capped accounts, pilot rollouts, customers that paid for "up to 50"
-- when the plan default is 25 or unlimited. SQL-editing the plan to
-- accommodate one customer is wrong.
--
-- Adds a per-org override column. When set:
--   - It wins over the plan's default for the device-quota check.
--   - NULL on a column means "no override; fall back to plan default".
-- Partner-child orgs still bypass the gate entirely (they inherit
-- business-tier behaviour through their MSP).

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS device_quota_override INTEGER
        CHECK (device_quota_override IS NULL OR device_quota_override >= 0);

COMMENT ON COLUMN public.organizations.device_quota_override IS
    'Per-org device cap that wins over subscription_plan when set. NULL = use plan default. 0 = block all enrolments (lock-out). Partner-child orgs bypass this gate.';

-- =============================================================================
-- can_add_device: rewrite to honour the override.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.can_add_device(_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _current_count INTEGER;
    _max_allowed   INTEGER;
    _org_plan      public.subscription_plan;
    _parent_id     UUID;
    _override      INTEGER;
BEGIN
    SELECT o.subscription_plan, o.parent_partner_id, o.device_quota_override
      INTO _org_plan, _parent_id, _override
      FROM public.organizations o
     WHERE o.id = _org_id;

    -- Partner-child orgs bypass entirely (inherits MSP-level licence).
    IF _parent_id IS NOT NULL THEN
        RETURN true;
    END IF;

    -- Per-org override wins. 0 deliberately means "no new enrolments".
    IF _override IS NOT NULL THEN
        _max_allowed := _override;
    ELSE
        SELECT pf.max_devices INTO _max_allowed
          FROM public.plan_features pf
         WHERE pf.plan = _org_plan;
    END IF;

    -- NULL still means unlimited.
    IF _max_allowed IS NULL THEN
        RETURN true;
    END IF;

    -- Count live endpoints (soft-deleted ones don't take a slot).
    SELECT COUNT(*) INTO _current_count
      FROM public.endpoints
     WHERE organization_id = _org_id
       AND deleted_at IS NULL;

    RETURN _current_count < _max_allowed;
END;
$fn$;

-- Convenience view for the admin UI: effective quota + current usage
-- in one cheap query.
CREATE OR REPLACE VIEW public.organization_device_quota
    WITH (security_invoker = true) AS
    SELECT
        o.id                                                              AS organization_id,
        o.name                                                            AS organization_name,
        o.subscription_plan                                               AS plan,
        o.device_quota_override                                           AS override,
        (SELECT pf.max_devices FROM public.plan_features pf
          WHERE pf.plan = o.subscription_plan)                            AS plan_default,
        COALESCE(o.device_quota_override,
                 (SELECT pf.max_devices FROM public.plan_features pf
                   WHERE pf.plan = o.subscription_plan))                  AS effective_cap,
        (SELECT COUNT(*) FROM public.endpoints e
          WHERE e.organization_id = o.id AND e.deleted_at IS NULL)::int   AS used,
        o.parent_partner_id IS NOT NULL                                   AS partner_child
    FROM public.organizations o;

GRANT SELECT ON public.organization_device_quota TO authenticated;
