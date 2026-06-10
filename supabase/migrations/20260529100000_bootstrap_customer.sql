-- Cut 1 — "Customer in 60 seconds".
--
-- Single SECURITY DEFINER RPC that an operator calls to provision a new
-- customer end-to-end:
--   1. Insert org (which fires the existing create_default_policies_trigger
--      → "Secure Policy" Defender policy auto-created)
--   2. Add caller as org admin so they can mint tokens, manage policies, etc.
--   3. Create baseline UAC policy "Standard"
--   4. Create baseline Windows Update policy "Standard"
--   5. Create default endpoint group "Standard" with all baseline policies attached
--   6. Mint a 50-use enrollment token, valid 30 days
--   7. Return everything the operator needs to hand to the customer's tech.

CREATE OR REPLACE FUNCTION public.bootstrap_customer(
    p_name text,
    p_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller     uuid := auth.uid();
    v_org_id     uuid;
    v_def_pol    uuid;
    v_uac_pol    uuid;
    v_wu_pol     uuid;
    v_group_id   uuid;
    v_token      text;
    v_expires_at timestamptz;
BEGIN
    -- Auth + super-admin gate. Only Peritus operators provision new customers.
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_super_admin(v_caller) THEN
        RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
    END IF;

    -- Trim + validate inputs.
    p_name := NULLIF(BTRIM(p_name), '');
    p_slug := NULLIF(BTRIM(p_slug), '');
    IF p_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='22023'; END IF;
    IF p_slug IS NULL THEN RAISE EXCEPTION 'slug_required' USING ERRCODE='22023'; END IF;
    IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
        RAISE EXCEPTION 'invalid_slug_format' USING ERRCODE='22023';
    END IF;

    -- 1. Org. Fires create_default_policies_trigger → "Secure Policy" Defender row created.
    INSERT INTO public.organizations(name, slug)
    VALUES (p_name, p_slug)
    RETURNING id INTO v_org_id;

    -- 2. Caller becomes admin of the new org so all tenant-scoped helpers work.
    INSERT INTO public.organization_memberships(organization_id, user_id, role)
    VALUES (v_org_id, v_caller, 'owner');

    -- 3. Pick up the auto-created Defender policy.
    SELECT id INTO v_def_pol
      FROM public.defender_policies
     WHERE organization_id = v_org_id
       AND is_default = true
     ORDER BY created_at DESC
     LIMIT 1;

    -- 4. Baseline UAC policy (Standard).
    BEGIN
        INSERT INTO public.uac_policies(
            organization_id, name, description,
            uac_enabled, consent_prompt_admin, consent_prompt_user,
            prompt_on_secure_desktop, detect_installations,
            validate_admin_signatures, filter_administrator_token,
            is_default
        )
        VALUES (
            v_org_id, 'Standard', 'Mithras baseline: secure-desktop prompts for admins, virtualised installer detection.',
            true, 5, 3,
            true, true,
            false, true,
            true
        )
        RETURNING id INTO v_uac_pol;
    EXCEPTION WHEN undefined_column THEN
        -- Schema variant: fall through with v_uac_pol = NULL
        v_uac_pol := NULL;
    END;

    -- 5. Baseline Windows Update policy (Standard).
    BEGIN
        INSERT INTO public.windows_update_policies(
            organization_id, name, description,
            auto_update_mode, active_hours_start, active_hours_end,
            feature_update_deferral_days, quality_update_deferral_days,
            pause_feature_updates, pause_quality_updates,
            is_default
        )
        VALUES (
            v_org_id, 'Standard', 'Mithras baseline: quality updates 7-day deferral, feature updates 30-day deferral.',
            4, 8, 18,
            30, 7,
            false, false,
            true
        )
        RETURNING id INTO v_wu_pol;
    EXCEPTION WHEN undefined_column THEN
        v_wu_pol := NULL;
    END;

    -- 6. Default endpoint group "Standard" with baseline policies attached.
    INSERT INTO public.endpoint_groups(
        organization_id, name, description,
        defender_policy_id, uac_policy_id, windows_update_policy_id
    )
    VALUES (
        v_org_id, 'Standard', 'Baseline group for all endpoints. Endpoints not in another group inherit from here.',
        v_def_pol, v_uac_pol, v_wu_pol
    )
    RETURNING id INTO v_group_id;

    -- 7. Mint a 50-use enrolment token valid 30 days. Inlined rather than
    --    calling create_enrollment_token because that RPC pins expiry to 7 days
    --    and we want a longer window for customer onboarding rollouts.
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires_at := now() + interval '30 days';

    INSERT INTO public.enrollment_tokens(
        token, organization_id, created_by, runtime_hint, channel, max_uses, expires_at
    )
    VALUES (
        v_token, v_org_id, v_caller, 'powershell', 'stable', 50, v_expires_at
    );

    -- Audit trail.
    BEGIN
        PERFORM public.log_activity(
            v_org_id, 'bootstrap', 'organization', v_org_id::text,
            jsonb_build_object(
                'name', p_name, 'slug', p_slug,
                'group_id', v_group_id,
                'token_max_uses', 50, 'token_expires_at', v_expires_at
            ),
            NULL
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;   -- log_activity signature drift shouldn't block bootstrap
    END;

    RETURN jsonb_build_object(
        'organization_id',         v_org_id,
        'slug',                    p_slug,
        'default_group_id',        v_group_id,
        'defender_policy_id',      v_def_pol,
        'uac_policy_id',           v_uac_pol,
        'windows_update_policy_id', v_wu_pol,
        'enrollment_token',        v_token,
        'token_max_uses',          50,
        'token_expires_at',        v_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_customer(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_customer(text, text) TO authenticated;
