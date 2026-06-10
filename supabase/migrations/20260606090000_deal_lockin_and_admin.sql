-- 20260606090000_deal_lockin_and_admin.sql
--
-- Deal-registration follow-ups:
--   1. Margin lock-in — snapshot the reseller's wholesale credit cost and
--      the customer-tier suggested retail at registration time. Lets the
--      reseller see "if I win this deal, my margin will be $X" without
--      worrying about mid-flight pricing changes.
--   2. convert_deal_to_customer now atomically (a) creates the customer
--      org under the reseller, (b) marks the deal won, (c) carries the
--      locked retail through to the customer's wholesale_price_cents.
--   3. get_admin_deal_overview() — super-admin platform-wide pipeline
--      rollup with per-distributor totals and conflict detection.

-- 1. Pricing snapshot columns ---------------------------------------------
ALTER TABLE public.deal_registrations
    ADD COLUMN IF NOT EXISTS locked_unit_cost_cents integer,
    ADD COLUMN IF NOT EXISTS locked_retail_cents    integer,
    ADD COLUMN IF NOT EXISTS locked_currency_code   text NOT NULL DEFAULT 'AUD';

COMMENT ON COLUMN public.deal_registrations.locked_unit_cost_cents IS
'Snapshot of the reseller''s most-recent credit cost per credit (from credit_transactions) at registration time. Informational — used by the reseller to forecast margin before winning the deal.';

COMMENT ON COLUMN public.deal_registrations.locked_retail_cents IS
'Snapshot of the customer-tier suggested retail price per endpoint per month at registration time. Carried through to the customer org''s wholesale_price_cents on convert_deal_to_customer.';

-- 2. Replace register_deal to capture pricing snapshot --------------------
CREATE OR REPLACE FUNCTION public.register_deal(
    _reseller_org_id      uuid,
    _prospect_name        text,
    _estimated_endpoints  integer DEFAULT 0,
    _estimated_close_date date    DEFAULT NULL,
    _prospect_email       text    DEFAULT NULL,
    _prospect_industry    text    DEFAULT NULL,
    _prospect_region      text    DEFAULT NULL,
    _notes                text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_id          uuid;
    dist_id         uuid;
    conflict_id     uuid;
    snap_unit_cost  integer;
    snap_retail     integer;
BEGIN
    IF _prospect_name IS NULL OR length(BTRIM(_prospect_name)) = 0 THEN
        RAISE EXCEPTION 'prospect_name_required';
    END IF;
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    SELECT parent_partner_id INTO dist_id
      FROM public.organizations
     WHERE id = _reseller_org_id AND organization_type = 'partner';

    SELECT id INTO conflict_id
      FROM public.deal_registrations
     WHERE status = 'active'
       AND lower(prospect_name) = lower(BTRIM(_prospect_name))
       AND (
              (dist_id IS NOT NULL  AND distributor_org_id = dist_id)
           OR (dist_id IS NULL      AND distributor_org_id IS NULL)
           )
     LIMIT 1;

    IF conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'deal_already_registered'
            USING DETAIL = 'Another reseller in your distribution chain has already registered this prospect.',
                  HINT   = 'Contact your distributor to coordinate or pick a different prospect.';
    END IF;

    -- Snapshot the reseller's most-recent inbound credit price (what their
    -- distributor charged on the last distributor_cut). NULL is fine — just
    -- means they haven't been priced yet.
    SELECT unit_price_cents INTO snap_unit_cost
      FROM public.credit_transactions
     WHERE to_org_id = _reseller_org_id
       AND reason   = 'distributor_cut'
       AND unit_price_cents IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1;

    -- Snapshot the customer-tier default retail.
    SELECT wholesale_price_cents INTO snap_retail
      FROM public.platform_pricing_defaults WHERE tier = 'customer';

    INSERT INTO public.deal_registrations
        (reseller_org_id, distributor_org_id, registered_by,
         prospect_name, prospect_email, prospect_industry, prospect_region,
         estimated_endpoints, estimated_close_date, notes,
         stage, protection_starts_at, protection_expires_at, status,
         locked_unit_cost_cents, locked_retail_cents)
    VALUES
        (_reseller_org_id, dist_id, auth.uid(),
         BTRIM(_prospect_name), _prospect_email, _prospect_industry, _prospect_region,
         _estimated_endpoints, _estimated_close_date, _notes,
         'qualified', now(), now() + public.deal_stage_window('qualified'), 'active',
         snap_unit_cost, snap_retail)
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;

-- 3. convert_deal_to_customer — also create or update the customer org ----
--
-- New behaviour: if the caller doesn't pass _customer_org_id we CREATE the
-- customer ourselves, applying the locked retail price. If they pass one,
-- we just link.
CREATE OR REPLACE FUNCTION public.convert_deal_to_customer(
    _deal_id          uuid,
    _customer_org_id  uuid DEFAULT NULL,
    _new_customer_name text DEFAULT NULL
)
RETURNS public.deal_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deal     public.deal_registrations%ROWTYPE;
    new_id   uuid;
    new_slug text;
BEGIN
    SELECT * INTO deal FROM public.deal_registrations WHERE id = _deal_id;
    IF deal.id IS NULL THEN RAISE EXCEPTION 'deal_not_found'; END IF;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), deal.reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    IF _customer_org_id IS NULL THEN
        IF _new_customer_name IS NULL OR length(BTRIM(_new_customer_name)) = 0 THEN
            _new_customer_name := deal.prospect_name;
        END IF;
        new_slug := lower(regexp_replace(BTRIM(_new_customer_name), '[^a-z0-9]+', '-', 'gi'));
        new_slug := substring(trim(both '-' from new_slug), 1, 60);
        -- Ensure uniqueness with a short suffix on collision.
        IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = new_slug) THEN
            new_slug := new_slug || '-' || substring(gen_random_uuid()::text, 1, 6);
        END IF;

        INSERT INTO public.organizations
            (name, slug, organization_type, parent_partner_id,
             wholesale_price_cents, currency_code, is_active)
        VALUES
            (BTRIM(_new_customer_name), new_slug, 'customer', deal.reseller_org_id,
             deal.locked_retail_cents, COALESCE(deal.locked_currency_code, 'AUD'), true)
        RETURNING id INTO new_id;

        _customer_org_id := new_id;
    END IF;

    UPDATE public.deal_registrations
       SET status              = 'won',
           stage               = 'won',
           won_customer_org_id = _customer_org_id,
           won_at              = now(),
           updated_at          = now()
     WHERE id = _deal_id
    RETURNING * INTO deal;

    RETURN deal;
END;
$$;
REVOKE ALL ON FUNCTION public.convert_deal_to_customer(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_deal_to_customer(uuid, uuid, text) TO authenticated, service_role;

-- 4. Admin pipeline overview ----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_deal_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    out          jsonb;
    totals       jsonb;
    by_dist      jsonb;
    conflicts    jsonb;
    recent       jsonb;
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;

    SELECT jsonb_build_object(
        'active',
            (SELECT count(*) FROM public.deal_registrations WHERE status = 'active'),
        'pipeline_endpoints',
            (SELECT COALESCE(SUM(estimated_endpoints),0)::int
               FROM public.deal_registrations WHERE status = 'active'),
        'won_total',
            (SELECT count(*) FROM public.deal_registrations WHERE status = 'won'),
        'lost_total',
            (SELECT count(*) FROM public.deal_registrations WHERE status = 'lost'),
        'expired_total',
            (SELECT count(*) FROM public.deal_registrations WHERE status = 'expired'),
        'conflicts_count',
            (SELECT count(*) FROM (
                SELECT lower(prospect_name), COALESCE(distributor_org_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  FROM public.deal_registrations
                 WHERE status = 'active'
                 GROUP BY 1, 2 HAVING count(*) > 1
            ) c)
    ) INTO totals;

    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.active_pipeline DESC NULLS LAST)
      INTO by_dist
      FROM (
        SELECT
            d.id AS distributor_id,
            d.name AS distributor_name,
            (SELECT count(*)
               FROM public.deal_registrations dr
              WHERE dr.distributor_org_id = d.id AND dr.status='active')             AS active_count,
            (SELECT COALESCE(SUM(estimated_endpoints),0)::int
               FROM public.deal_registrations dr
              WHERE dr.distributor_org_id = d.id AND dr.status='active')             AS active_pipeline,
            (SELECT count(*)
               FROM public.deal_registrations dr
              WHERE dr.distributor_org_id = d.id AND dr.status='won')                AS won_count,
            (SELECT count(*) FROM public.organizations r
              WHERE r.parent_partner_id = d.id AND r.organization_type='partner')    AS reseller_count
          FROM public.organizations d
         WHERE d.organization_type = 'distributor'
         ORDER BY d.name
      ) t;

    SELECT jsonb_agg(row_to_json(c)::jsonb ORDER BY c.deal_count DESC)
      INTO conflicts
      FROM (
        SELECT
            lower(prospect_name)            AS prospect_key,
            MIN(prospect_name)              AS prospect_name,
            COALESCE(distributor_org_id, '00000000-0000-0000-0000-000000000000'::uuid) AS distributor_org_id,
            count(*)                        AS deal_count,
            array_agg(DISTINCT reseller_org_id) AS reseller_ids
          FROM public.deal_registrations
         WHERE status = 'active'
         GROUP BY 1, 3
        HAVING count(*) > 1
         LIMIT 25
      ) c;

    SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.created_at DESC)
      INTO recent
      FROM (
        SELECT dr.id, dr.prospect_name, dr.stage, dr.status, dr.created_at,
               dr.estimated_endpoints, dr.estimated_close_date,
               (SELECT name FROM public.organizations WHERE id = dr.reseller_org_id)    AS reseller_name,
               (SELECT name FROM public.organizations WHERE id = dr.distributor_org_id) AS distributor_name
          FROM public.deal_registrations dr
         WHERE dr.created_at > now() - interval '30 days'
         ORDER BY dr.created_at DESC
         LIMIT 50
      ) r;

    out := jsonb_build_object(
        'generated_at', now(),
        'totals',       totals,
        'by_distributor', COALESCE(by_dist, '[]'::jsonb),
        'conflicts',    COALESCE(conflicts, '[]'::jsonb),
        'recent',       COALESCE(recent, '[]'::jsonb)
    );
    RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_deal_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_deal_overview() TO authenticated, service_role;
