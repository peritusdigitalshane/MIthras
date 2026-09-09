-- 20260614010000_partner_templates_and_rings.sql
--
-- Two MSP features:
--
--   1. partner_policy_templates  — a partner-org-owned snapshot of a
--      defender_policy + windows_update_policy (+ optional update_ring).
--      Partners build a template once and clone it to many of their
--      customer orgs with one click. The snapshot is stored as JSONB so
--      additive columns on the source policy tables don't require a
--      schema bump here.
--
--   2. update_rings  — named patch-deployment tiers (Pilot / Production /
--      Critical-only). Each ring carries quality + feature defer-days,
--      an install window in local time, and a concurrency cap. Linked
--      from endpoint_groups via update_ring_id so the existing
--      install_updates command path can consult the ring when scheduling
--      patches.
--
-- Both are additive. No existing table or policy is changed.

BEGIN;

-- ============================================================
-- update_rings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.update_rings (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                        text NOT NULL,
    description                 text,
    quality_update_defer_days   int  NOT NULL DEFAULT 0   CHECK (quality_update_defer_days BETWEEN 0 AND 30),
    feature_update_defer_days   int  NOT NULL DEFAULT 0   CHECK (feature_update_defer_days BETWEEN 0 AND 365),
    -- Install window in endpoint-local hours (24h). Wraparound allowed:
    -- start > end means "from start through midnight to end".
    install_window_start_local  int  NOT NULL DEFAULT 2   CHECK (install_window_start_local BETWEEN 0 AND 23),
    install_window_end_local    int  NOT NULL DEFAULT 5   CHECK (install_window_end_local BETWEEN 0 AND 23),
    -- When true the ring will only push patches Microsoft has flagged
    -- "Critical" severity. Useful for servers that should never get the
    -- chatty monthly cumulative but still need 0-day fixes.
    critical_only               boolean NOT NULL DEFAULT false,
    max_concurrent_installs     int  NOT NULL DEFAULT 5   CHECK (max_concurrent_installs BETWEEN 1 AND 1000),
    is_default                  boolean NOT NULL DEFAULT false,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_update_rings_org ON public.update_rings(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_update_rings_one_default_per_org
    ON public.update_rings(organization_id) WHERE is_default;

DROP TRIGGER IF EXISTS update_update_rings_updated_at ON public.update_rings;
CREATE TRIGGER update_update_rings_updated_at
    BEFORE UPDATE ON public.update_rings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.update_rings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS update_rings_read ON public.update_rings;
CREATE POLICY update_rings_read ON public.update_rings FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS update_rings_write ON public.update_rings;
CREATE POLICY update_rings_write ON public.update_rings FOR ALL
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

-- Link rings to endpoint groups. ON DELETE SET NULL so dropping a ring
-- doesn't cascade-delete groups.
ALTER TABLE public.endpoint_groups
    ADD COLUMN IF NOT EXISTS update_ring_id uuid REFERENCES public.update_rings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_endpoint_groups_update_ring ON public.endpoint_groups(update_ring_id);


-- ============================================================
-- partner_policy_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.partner_policy_templates (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                     text NOT NULL,
    description              text,
    -- JSONB snapshots so additive columns on the source policy tables
    -- don't need a migration here. Validated at apply-time by the RPC.
    defender_policy          jsonb,
    windows_update_policy    jsonb,
    -- Optional: pre-bind a ring config so applying the template also
    -- creates the ring in the target customer.
    update_ring              jsonb,
    is_archived              boolean NOT NULL DEFAULT false,
    created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_partner_policy_templates_owner ON public.partner_policy_templates(owner_org_id);

DROP TRIGGER IF EXISTS update_partner_policy_templates_updated_at ON public.partner_policy_templates;
CREATE TRIGGER update_partner_policy_templates_updated_at
    BEFORE UPDATE ON public.partner_policy_templates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.partner_policy_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_policy_templates_read ON public.partner_policy_templates;
CREATE POLICY partner_policy_templates_read ON public.partner_policy_templates FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), owner_org_id)
        OR public.is_partner_admin_of_org(auth.uid(), owner_org_id)
        -- Customers under this partner can read template names so the UI
        -- can say "this policy came from your reseller's 'Tight retail' template".
        OR EXISTS (
            SELECT 1 FROM public.organizations c
            WHERE c.id = (SELECT user_org.organization_id FROM public.organization_memberships user_org WHERE user_org.user_id = auth.uid() LIMIT 1)
              AND c.parent_partner_id = owner_org_id
        )
    );

DROP POLICY IF EXISTS partner_policy_templates_write ON public.partner_policy_templates;
CREATE POLICY partner_policy_templates_write ON public.partner_policy_templates FOR ALL
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), owner_org_id)
        OR public.is_partner_admin_of_org(auth.uid(), owner_org_id)
    )
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), owner_org_id)
        OR public.is_partner_admin_of_org(auth.uid(), owner_org_id)
    );


-- ============================================================
-- RPC: create a template by snapshotting an existing endpoint group
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_partner_template_from_group(
    p_group_id      uuid,
    p_template_name text,
    p_description   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group       public.endpoint_groups%ROWTYPE;
    v_owner       uuid;
    v_def         jsonb;
    v_wuf         jsonb;
    v_ring        jsonb;
    v_template_id uuid;
BEGIN
    SELECT * INTO v_group FROM public.endpoint_groups WHERE id = p_group_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'group_not_found'; END IF;

    -- Caller must be partner-admin over the group's org, super-admin, or
    -- an admin of the org itself.
    IF NOT (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), v_group.organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), v_group.organization_id)
    ) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- Templates are owned by the partner above the org, or by the org
    -- itself if it has no partner (self-distributed direct customer or a
    -- partner org configuring its own templates).
    SELECT COALESCE(parent_partner_id, id) INTO v_owner
        FROM public.organizations WHERE id = v_group.organization_id;

    -- Snapshot defender policy
    IF v_group.defender_policy_id IS NOT NULL THEN
        SELECT to_jsonb(d) INTO v_def FROM public.defender_policies d WHERE d.id = v_group.defender_policy_id;
        -- Strip identity / org-specific fields so the snapshot is portable.
        v_def := v_def - 'id' - 'organization_id' - 'is_default' - 'created_at' - 'updated_at';
    END IF;

    -- Snapshot Windows Update policy
    IF v_group.windows_update_policy_id IS NOT NULL THEN
        SELECT to_jsonb(w) INTO v_wuf FROM public.windows_update_policies w WHERE w.id = v_group.windows_update_policy_id;
        v_wuf := v_wuf - 'id' - 'organization_id' - 'created_at' - 'updated_at';
    END IF;

    -- Snapshot update ring if attached
    IF v_group.update_ring_id IS NOT NULL THEN
        SELECT to_jsonb(r) INTO v_ring FROM public.update_rings r WHERE r.id = v_group.update_ring_id;
        v_ring := v_ring - 'id' - 'organization_id' - 'is_default' - 'created_at' - 'updated_at';
    END IF;

    INSERT INTO public.partner_policy_templates
        (owner_org_id, name, description, defender_policy, windows_update_policy, update_ring, created_by)
    VALUES
        (v_owner, p_template_name, p_description, v_def, v_wuf, v_ring, auth.uid())
    RETURNING id INTO v_template_id;

    RETURN v_template_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_partner_template_from_group(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_partner_template_from_group(uuid, text, text) TO authenticated;


-- ============================================================
-- RPC: apply a template to one customer org
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_partner_template_to_customer(
    p_template_id     uuid,
    p_customer_org_id uuid,
    p_make_default    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tpl        public.partner_policy_templates%ROWTYPE;
    v_customer   public.organizations%ROWTYPE;
    v_def_id     uuid;
    v_wuf_id     uuid;
    v_ring_id    uuid;
    v_def_name   text;
    v_wuf_name   text;
    v_ring_name  text;
BEGIN
    SELECT * INTO v_tpl FROM public.partner_policy_templates WHERE id = p_template_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

    SELECT * INTO v_customer FROM public.organizations WHERE id = p_customer_org_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found'; END IF;

    -- Caller must own the template AND be authorised against the customer.
    IF NOT (
        public.is_super_admin(auth.uid())
        OR public.is_partner_admin_of_org(auth.uid(), v_tpl.owner_org_id)
        OR public.is_admin_of_org(auth.uid(), v_tpl.owner_org_id)
    ) THEN
        RAISE EXCEPTION 'forbidden_template';
    END IF;

    -- The customer must actually belong to this partner (or be the partner
    -- itself, or caller is super-admin).
    IF NOT (
        public.is_super_admin(auth.uid())
        OR v_customer.parent_partner_id = v_tpl.owner_org_id
        OR v_customer.id = v_tpl.owner_org_id
    ) THEN
        RAISE EXCEPTION 'customer_not_under_partner';
    END IF;

    v_def_name  := v_tpl.name || ' — Defender';
    v_wuf_name  := v_tpl.name || ' — Updates';
    v_ring_name := v_tpl.name || ' — Ring';

    -- Defender policy: clone from JSONB snapshot.
    IF v_tpl.defender_policy IS NOT NULL THEN
        -- If we set is_default true, unset any existing default first.
        IF p_make_default THEN
            UPDATE public.defender_policies SET is_default=false
                WHERE organization_id = p_customer_org_id AND is_default;
        END IF;

        INSERT INTO public.defender_policies (
            organization_id, name, description, is_default,
            realtime_monitoring, cloud_delivered_protection, maps_reporting, sample_submission,
            check_signatures_before_scan, behavior_monitoring, ioav_protection, script_scanning,
            removable_drive_scanning, block_at_first_seen, pua_protection, signature_update_interval,
            archive_scanning, email_scanning, cloud_block_level, cloud_extended_timeout,
            controlled_folder_access, network_protection,
            asr_block_vulnerable_drivers, asr_block_email_executable, asr_block_office_child_process,
            asr_block_office_executable_content, asr_block_office_code_injection, asr_block_js_vbs_executable,
            asr_block_obfuscated_scripts, asr_block_office_macro_win32, asr_block_untrusted_executables,
            asr_advanced_ransomware_protection, asr_block_credential_stealing, asr_block_psexec_wmi,
            asr_block_usb_untrusted, asr_block_office_comms_child_process, asr_block_adobe_child_process,
            asr_block_wmi_persistence, exploit_protection_enabled
        )
        SELECT
            p_customer_org_id,
            v_def_name,
            COALESCE(v_tpl.description, 'Applied from template: ' || v_tpl.name),
            p_make_default,
            COALESCE((v_tpl.defender_policy->>'realtime_monitoring')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'cloud_delivered_protection')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'maps_reporting')::int, 2),
            COALESCE((v_tpl.defender_policy->>'sample_submission')::int, 1),
            COALESCE((v_tpl.defender_policy->>'check_signatures_before_scan')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'behavior_monitoring')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'ioav_protection')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'script_scanning')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'removable_drive_scanning')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'block_at_first_seen')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'pua_protection')::int, 1),
            COALESCE((v_tpl.defender_policy->>'signature_update_interval')::int, 4),
            COALESCE((v_tpl.defender_policy->>'archive_scanning')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'email_scanning')::boolean, true),
            COALESCE(v_tpl.defender_policy->>'cloud_block_level', 'High'),
            COALESCE((v_tpl.defender_policy->>'cloud_extended_timeout')::int, 50),
            COALESCE((v_tpl.defender_policy->>'controlled_folder_access')::boolean, true),
            COALESCE((v_tpl.defender_policy->>'network_protection')::boolean, true),
            COALESCE(v_tpl.defender_policy->>'asr_block_vulnerable_drivers', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_email_executable', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_office_child_process', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_office_executable_content', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_office_code_injection', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_js_vbs_executable', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_obfuscated_scripts', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_office_macro_win32', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_untrusted_executables', 'enabled')::public.asr_action,
            COALESCE((v_tpl.defender_policy->>'asr_advanced_ransomware_protection')::boolean, true),
            COALESCE(v_tpl.defender_policy->>'asr_block_credential_stealing', 'audit')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_psexec_wmi', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_usb_untrusted', 'enabled')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_office_comms_child_process', 'audit')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_adobe_child_process', 'audit')::public.asr_action,
            COALESCE(v_tpl.defender_policy->>'asr_block_wmi_persistence', 'enabled')::public.asr_action,
            COALESCE((v_tpl.defender_policy->>'exploit_protection_enabled')::boolean, true)
        RETURNING id INTO v_def_id;
    END IF;

    -- Windows Update policy
    IF v_tpl.windows_update_policy IS NOT NULL THEN
        INSERT INTO public.windows_update_policies (
            organization_id, name, description,
            auto_update_mode, active_hours_start, active_hours_end,
            feature_update_deferral, quality_update_deferral,
            pause_feature_updates, pause_quality_updates
        )
        SELECT
            p_customer_org_id,
            v_wuf_name,
            COALESCE(v_tpl.description, 'Applied from template: ' || v_tpl.name),
            COALESCE((v_tpl.windows_update_policy->>'auto_update_mode')::int, 4),
            COALESCE((v_tpl.windows_update_policy->>'active_hours_start')::int, 8),
            COALESCE((v_tpl.windows_update_policy->>'active_hours_end')::int, 18),
            COALESCE((v_tpl.windows_update_policy->>'feature_update_deferral')::int, 0),
            COALESCE((v_tpl.windows_update_policy->>'quality_update_deferral')::int, 0),
            COALESCE((v_tpl.windows_update_policy->>'pause_feature_updates')::boolean, false),
            COALESCE((v_tpl.windows_update_policy->>'pause_quality_updates')::boolean, false)
        RETURNING id INTO v_wuf_id;
    END IF;

    -- Update ring (if template included one)
    IF v_tpl.update_ring IS NOT NULL THEN
        INSERT INTO public.update_rings (
            organization_id, name, description,
            quality_update_defer_days, feature_update_defer_days,
            install_window_start_local, install_window_end_local,
            critical_only, max_concurrent_installs, is_default
        )
        SELECT
            p_customer_org_id,
            v_ring_name,
            COALESCE(v_tpl.description, 'Applied from template: ' || v_tpl.name),
            COALESCE((v_tpl.update_ring->>'quality_update_defer_days')::int, 0),
            COALESCE((v_tpl.update_ring->>'feature_update_defer_days')::int, 0),
            COALESCE((v_tpl.update_ring->>'install_window_start_local')::int, 2),
            COALESCE((v_tpl.update_ring->>'install_window_end_local')::int, 5),
            COALESCE((v_tpl.update_ring->>'critical_only')::boolean, false),
            COALESCE((v_tpl.update_ring->>'max_concurrent_installs')::int, 5),
            false
        RETURNING id INTO v_ring_id;
    END IF;

    RETURN jsonb_build_object(
        'template_id',              p_template_id,
        'customer_org_id',          p_customer_org_id,
        'defender_policy_id',       v_def_id,
        'windows_update_policy_id', v_wuf_id,
        'update_ring_id',           v_ring_id,
        'made_default',             p_make_default
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_partner_template_to_customer(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_partner_template_to_customer(uuid, uuid, boolean) TO authenticated;


-- ============================================================
-- RPC: apply a template to many customers at once
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_partner_template_to_customers(
    p_template_id  uuid,
    p_customer_ids uuid[],
    p_make_default boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cust    uuid;
    v_results jsonb := '[]'::jsonb;
    v_one     jsonb;
    v_failed  jsonb := '[]'::jsonb;
BEGIN
    FOREACH v_cust IN ARRAY p_customer_ids LOOP
        BEGIN
            v_one := public.apply_partner_template_to_customer(p_template_id, v_cust, p_make_default);
            v_results := v_results || v_one;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed || jsonb_build_object(
                'customer_org_id', v_cust,
                'error',           SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'applied',  jsonb_array_length(v_results),
        'failed',   jsonb_array_length(v_failed),
        'results',  v_results,
        'failures', v_failed
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_partner_template_to_customers(uuid, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_partner_template_to_customers(uuid, uuid[], boolean) TO authenticated;


-- ============================================================
-- RPC: seed the standard 3 rings for an org. Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_default_update_rings(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pilot    uuid;
    v_prod     uuid;
    v_crit     uuid;
BEGIN
    IF NOT (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), p_org_id)
        OR public.is_partner_admin_of_org(auth.uid(), p_org_id)
    ) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    INSERT INTO public.update_rings (
        organization_id, name, description,
        quality_update_defer_days, feature_update_defer_days,
        install_window_start_local, install_window_end_local,
        critical_only, max_concurrent_installs, is_default
    )
    VALUES
        (p_org_id, 'Pilot',
         'Patches arrive on Patch Tuesday with no defer. Install window 09:00–17:00 local. Up to 100 concurrent installs. Use this for your test fleet.',
         0, 0, 9, 17, false, 100, false)
    ON CONFLICT (organization_id, name) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_pilot;

    INSERT INTO public.update_rings (
        organization_id, name, description,
        quality_update_defer_days, feature_update_defer_days,
        install_window_start_local, install_window_end_local,
        critical_only, max_concurrent_installs, is_default
    )
    VALUES
        (p_org_id, 'Production',
         'Quality updates deferred 7 days, feature updates deferred 30 days. Install window 02:00–05:00 local. Up to 25 concurrent. Default for the fleet.',
         7, 30, 2, 5, false, 25, true)
    ON CONFLICT (organization_id, name) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_prod;

    INSERT INTO public.update_rings (
        organization_id, name, description,
        quality_update_defer_days, feature_update_defer_days,
        install_window_start_local, install_window_end_local,
        critical_only, max_concurrent_installs, is_default
    )
    VALUES
        (p_org_id, 'Critical-only',
         'Only Microsoft-flagged critical security updates. No feature updates. Install window 00:00–23:00. Use for servers and machines that must not get the monthly cumulative.',
         0, 365, 0, 23, true, 10, false)
    ON CONFLICT (organization_id, name) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_crit;

    RETURN jsonb_build_object(
        'pilot_id',         v_pilot,
        'production_id',    v_prod,
        'critical_only_id', v_crit
    );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_update_rings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_update_rings(uuid) TO authenticated;

COMMIT;
