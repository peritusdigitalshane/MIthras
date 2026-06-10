-- 20260530002000_org_feature_gates.sql
--
-- B1 fix (paid functions side): add a helper to check whether an org's plan
-- entitles them to a named feature. Used by edge functions to return HTTP 402
-- before doing any billable work (LLM call, report render, threat-intel API).
--
-- Partner-child orgs inherit business-plan features (matches can_add_device).

CREATE OR REPLACE FUNCTION public.org_has_feature(_org_id uuid, _feature text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_plan public.subscription_plan;
    v_parent uuid;
    v_allowed boolean;
BEGIN
    IF _org_id IS NULL OR _feature IS NULL THEN
        RETURN false;
    END IF;

    SELECT o.subscription_plan, o.parent_partner_id
      INTO v_plan, v_parent
      FROM public.organizations o
     WHERE o.id = _org_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Partner-child orgs inherit business-tier features.
    IF v_parent IS NOT NULL THEN
        v_plan := 'business'::public.subscription_plan;
    END IF;

    EXECUTE format(
        'SELECT %I FROM public.plan_features WHERE plan = $1 LIMIT 1',
        _feature
    )
    INTO v_allowed
    USING v_plan;

    RETURN COALESCE(v_allowed, false);
EXCEPTION
    -- Unknown feature column → fail closed but log.
    WHEN undefined_column THEN
        RAISE NOTICE 'org_has_feature: feature column % does not exist on plan_features', _feature;
        RETURN false;
END
$$;

REVOKE ALL ON FUNCTION public.org_has_feature(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.org_has_feature(uuid, text) TO anon, authenticated, service_role;
