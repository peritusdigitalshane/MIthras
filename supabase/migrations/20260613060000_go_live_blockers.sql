-- Pre-go-live blocker sweep. Each block addresses one audit finding.
-- File can be re-run safely; every alter/create uses IF NOT EXISTS / CREATE OR REPLACE.

------------------------------------------------------------------------
-- A4 — Deal margin lock-in: stop overwriting wholesale_price_cents with
-- locked_retail_cents. Add suggested_retail_price_cents so the customer
-- org retains the deal-time retail recommendation without trashing the
-- reseller's actual wholesale cost.
------------------------------------------------------------------------
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS suggested_retail_price_cents integer;

COMMENT ON COLUMN public.organizations.suggested_retail_price_cents IS
  'Snapshot of the suggested retail per endpoint at deal-conversion time. NOT the price the reseller is invoiced at — that is wholesale_price_cents.';

CREATE OR REPLACE FUNCTION public.convert_deal_to_customer(
    _deal_id           uuid,
    _customer_org_id   uuid DEFAULT NULL,
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
        IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = new_slug) THEN
            new_slug := new_slug || '-' || substring(gen_random_uuid()::text, 1, 6);
        END IF;

        -- A4 fix: wholesale_price_cents = the reseller's cost (locked_unit_cost_cents).
        -- locked_retail_cents only informs the customer-facing suggested retail.
        INSERT INTO public.organizations
            (name, slug, organization_type, parent_partner_id,
             wholesale_price_cents, suggested_retail_price_cents,
             currency_code, is_active)
        VALUES
            (BTRIM(_new_customer_name), new_slug, 'customer', deal.reseller_org_id,
             deal.locked_unit_cost_cents,
             deal.locked_retail_cents,
             COALESCE(deal.locked_currency_code, 'AUD'), true)
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


------------------------------------------------------------------------
-- A1 — Invoice GST: every B2B invoice in Australia must include 10% GST.
-- Patch generate_peritus_invoice to compute tax + total correctly.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_peritus_invoice(
    _bill_to_org_id  uuid,
    _period_start    date,
    _period_end      date,
    _due_offset_days int DEFAULT 14
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    issuer_id     uuid;
    new_id        uuid;
    existing_id   uuid;
    org_type      text;
    org_currency  text;
    sub_total     bigint := 0;
    gst_amount    bigint := 0;
    grand_total   bigint := 0;
BEGIN
    SELECT id INTO issuer_id FROM public.organizations
     WHERE slug = 'peritus' LIMIT 1;
    IF issuer_id IS NULL THEN
        SELECT id INTO issuer_id FROM public.organizations
         WHERE organization_type IN ('distributor','partner')
         ORDER BY created_at LIMIT 1;
    END IF;
    IF issuer_id IS NULL THEN
        RAISE EXCEPTION 'No issuer organisation found — create the Peritus org first.';
    END IF;

    SELECT organization_type, currency_code
      INTO org_type, org_currency
      FROM public.organizations
     WHERE id = _bill_to_org_id;
    IF org_type NOT IN ('distributor','partner') THEN
        RAISE EXCEPTION 'Can only invoice distributor/partner orgs (got %)', org_type;
    END IF;

    SELECT id INTO existing_id
      FROM public.invoices
     WHERE bill_to_org_id = _bill_to_org_id
       AND period_start  = _period_start
       AND period_end    = _period_end
       AND status        = 'draft';

    IF existing_id IS NOT NULL THEN
        DELETE FROM public.invoice_line_items WHERE invoice_id = existing_id;
        new_id := existing_id;
    ELSE
        INSERT INTO public.invoices (
            invoice_number, issuer_org_id, bill_to_org_id,
            period_start, period_end, due_date, currency_code, status,
            created_by
        ) VALUES (
            public.next_invoice_number(issuer_id, _period_end),
            issuer_id, _bill_to_org_id,
            _period_start, _period_end,
            _period_end + (_due_offset_days || ' days')::interval,
            coalesce(org_currency, 'AUD'),
            'draft',
            auth.uid()
        ) RETURNING id INTO new_id;
    END IF;

    IF org_type = 'distributor' THEN
        INSERT INTO public.invoice_line_items
            (invoice_id, org_id, description, quantity, unit_price_cents, line_total_cents, position)
        SELECT new_id, s.reseller_org_id,
               'Reseller: ' || s.reseller_name || ' (' || s.endpoint_count || ' endpoints)',
               s.endpoint_count::int, s.wholesale_price_cents, s.line_total_cents::int,
               row_number() OVER (ORDER BY s.reseller_name)
          FROM public.get_distributor_billing_snapshot(_bill_to_org_id) s
         WHERE s.endpoint_count > 0;
    ELSE
        INSERT INTO public.invoice_line_items
            (invoice_id, org_id, description, quantity, unit_price_cents, line_total_cents, position)
        SELECT new_id, s.customer_org_id,
               'Customer: ' || s.customer_name || ' (' || s.endpoint_count || ' endpoints)',
               s.endpoint_count::int, s.wholesale_price_cents, s.line_total_cents::int,
               row_number() OVER (ORDER BY s.customer_name)
          FROM public.get_reseller_billing_snapshot(_bill_to_org_id) s
         WHERE s.endpoint_count > 0;
    END IF;

    SELECT COALESCE(SUM(line_total_cents), 0) INTO sub_total
      FROM public.invoice_line_items
     WHERE invoice_id = new_id;

    -- A1 fix: 10% GST on AUD invoices. Round to nearest cent.
    -- If org_currency is not AUD we leave tax at 0 (we don't issue non-AUD invoices today
    -- but the safety check keeps it correct if we ever do).
    IF coalesce(org_currency, 'AUD') = 'AUD' THEN
        gst_amount := ROUND(sub_total::numeric * 0.10);
    ELSE
        gst_amount := 0;
    END IF;
    grand_total := sub_total + gst_amount;

    UPDATE public.invoices
       SET subtotal_cents = sub_total::int,
           tax_cents      = gst_amount::int,
           total_cents    = grand_total::int,
           updated_at     = now()
     WHERE id = new_id;

    RETURN new_id;
END;
$$;


------------------------------------------------------------------------
-- A2 — License pool race condition. Add SELECT FOR UPDATE so concurrent
-- consume/cut calls serialise instead of both reading the same balance
-- and both passing the guard check.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cut_licences_to_reseller(
    _reseller_org_id uuid,
    _quantity        integer,
    _notes           text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    txn_id            uuid;
    distributor_id    uuid;
    reseller_row      public.organizations%ROWTYPE;
    distributor_bal   integer;
BEGIN
    IF _quantity IS NULL OR _quantity <= 0 THEN
        RAISE EXCEPTION 'quantity_must_be_positive';
    END IF;

    SELECT * INTO reseller_row FROM public.organizations WHERE id = _reseller_org_id;
    IF reseller_row IS NULL THEN
        RAISE EXCEPTION 'reseller_not_found';
    END IF;
    IF reseller_row.organization_type <> 'partner' THEN
        RAISE EXCEPTION 'target_must_be_reseller';
    END IF;
    IF reseller_row.parent_partner_id IS NULL THEN
        RAISE EXCEPTION 'reseller_has_no_distributor';
    END IF;

    distributor_id := reseller_row.parent_partner_id;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), distributor_id)) THEN
        RAISE EXCEPTION 'caller_not_distributor_admin';
    END IF;

    -- A2 fix: lock both orgs' rows for the duration of this transaction so a
    -- concurrent call sees the post-update balance.
    SELECT licence_balance INTO distributor_bal
      FROM public.organizations WHERE id = distributor_id FOR UPDATE;
    PERFORM 1 FROM public.organizations WHERE id = _reseller_org_id FOR UPDATE;

    IF distributor_bal < _quantity THEN
        RAISE EXCEPTION 'insufficient_distributor_balance'
            USING DETAIL = 'You have ' || distributor_bal || ' licences available; tried to cut ' || _quantity || '.';
    END IF;

    INSERT INTO public.licence_transactions
        (from_org_id, to_org_id, quantity, reason, notes, created_by)
    VALUES (distributor_id, _reseller_org_id, _quantity, 'distributor_cut', _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations SET licence_balance = licence_balance - _quantity WHERE id = distributor_id;
    UPDATE public.organizations SET licence_balance = licence_balance + _quantity WHERE id = _reseller_org_id;

    RETURN txn_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.consume_licence(
    _customer_org_id uuid,
    _endpoint_id     uuid DEFAULT NULL,
    _notes           text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    txn_id        uuid;
    customer_row  public.organizations%ROWTYPE;
    reseller_id   uuid;
    reseller_bal  integer;
BEGIN
    SELECT * INTO customer_row FROM public.organizations WHERE id = _customer_org_id;
    IF customer_row IS NULL THEN
        RAISE EXCEPTION 'customer_not_found';
    END IF;
    IF customer_row.organization_type <> 'customer' THEN
        RAISE EXCEPTION 'target_must_be_customer';
    END IF;
    reseller_id := customer_row.parent_partner_id;
    IF reseller_id IS NULL THEN
        RAISE EXCEPTION 'customer_has_no_reseller';
    END IF;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), reseller_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    -- A2 fix: lock the reseller row so two parallel consumes can't both pass the >= 1 check.
    SELECT licence_balance INTO reseller_bal
      FROM public.organizations WHERE id = reseller_id FOR UPDATE;
    IF reseller_bal < 1 THEN
        RAISE EXCEPTION 'insufficient_reseller_balance'
            USING DETAIL = 'Your distributor needs to allocate more licences before you can add this customer.',
                  HINT   = 'Contact your distributor to top up your licence pool.';
    END IF;

    INSERT INTO public.licence_transactions
        (from_org_id, to_org_id, quantity, reason, customer_org_id, endpoint_id, notes, created_by)
    VALUES (reseller_id, _customer_org_id, 1, 'consumed', _customer_org_id, _endpoint_id, _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations SET licence_balance = licence_balance - 1 WHERE id = reseller_id;

    RETURN txn_id;
END;
$$;


------------------------------------------------------------------------
-- B1 — sysmon_events INSERT policy. The existing policy was TO public,
-- meaning any authenticated user could inject forged process telemetry
-- against another org's endpoints. Restrict to service_role only.
------------------------------------------------------------------------
DROP POLICY IF EXISTS sysmon_events_insert_valid_endpoint ON public.sysmon_events;
DROP POLICY IF EXISTS sysmon_events_service_insert ON public.sysmon_events;
CREATE POLICY sysmon_events_service_insert
    ON public.sysmon_events
    FOR INSERT
    TO service_role
    WITH CHECK (true);


------------------------------------------------------------------------
-- B2 — build_org_period_summary auth gate. SECURITY DEFINER + no caller
-- check meant any auth user could pull a metric summary for any org.
-- Convert to plpgsql wrapper that enforces super-admin or org membership.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_org_period_summary(
    p_org           uuid,
    p_period_start  timestamptz,
    p_period_end    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    out jsonb;
BEGIN
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_member_of_org(auth.uid(), p_org)
            OR public.is_partner_admin_of_org(auth.uid(), p_org)) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT jsonb_build_object(
      'threats', jsonb_build_object(
        'total',  (SELECT count(*) FROM public.endpoint_threats et
                    JOIN public.endpoints e ON e.id=et.endpoint_id
                    WHERE e.organization_id = p_org
                      AND COALESCE(et.initial_detection_time, et.created_at) >= p_period_start
                      AND COALESCE(et.initial_detection_time, et.created_at) <  p_period_end),
        'by_severity', (
            SELECT COALESCE(jsonb_object_agg(severity, hits), '{}'::jsonb)
              FROM (SELECT severity, count(*) AS hits
                      FROM public.endpoint_threats et
                      JOIN public.endpoints e ON e.id=et.endpoint_id
                     WHERE e.organization_id = p_org
                       AND COALESCE(et.initial_detection_time, et.created_at) >= p_period_start
                       AND COALESCE(et.initial_detection_time, et.created_at) <  p_period_end
                  GROUP BY severity) s)
      ),
      'vulnerabilities', (
        SELECT count(*) FROM public.vulnerability_findings vf
         WHERE vf.organization_id = p_org
           AND vf.status='open'
      ),
      'incidents', (
        SELECT count(*) FROM public.incidents i
         WHERE i.organization_id = p_org
           AND i.created_at >= p_period_start
           AND i.created_at <  p_period_end
      ),
      'endpoints', jsonb_build_object(
        'total',  (SELECT count(*) FROM public.endpoints WHERE organization_id = p_org AND is_active = true),
        'online', (SELECT count(*) FROM public.endpoints WHERE organization_id = p_org AND is_active = true AND last_seen_at > now() - interval '24 hours')
      )
    ) INTO out;
    RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.build_org_period_summary(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_org_period_summary(uuid, timestamptz, timestamptz) TO service_role, authenticated;


------------------------------------------------------------------------
-- B3 — get_distributor_billing_snapshot auth gate. Wave 8 patched the
-- reseller version, missed this one. Convert to plpgsql + caller check.
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_distributor_billing_snapshot(uuid);
CREATE OR REPLACE FUNCTION public.get_distributor_billing_snapshot(_distributor_org_id uuid)
RETURNS TABLE(
    reseller_org_id        uuid,
    reseller_name          text,
    endpoint_count         bigint,
    wholesale_price_cents  integer,
    line_total_cents       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _distributor_org_id)) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    RETURN QUERY
    WITH defaults AS (
        SELECT
          (SELECT wholesale_price_cents FROM public.platform_pricing_defaults WHERE tier='reseller') AS reseller_default
    ),
    resellers AS (
        SELECT id, name, wholesale_price_cents FROM public.organizations
         WHERE organization_type='partner' AND parent_partner_id = _distributor_org_id AND is_active = true
    ),
    counts AS (
        SELECT c.parent_partner_id AS reseller_id, count(e.id) AS ep_count
          FROM public.organizations c
          JOIN public.endpoints e ON e.organization_id = c.id
                                 AND e.deleted_at IS NULL AND e.is_active = true
         WHERE c.parent_partner_id IN (SELECT id FROM resellers)
         GROUP BY c.parent_partner_id
    )
    SELECT
      r.id,
      r.name,
      COALESCE(c.ep_count, 0) AS endpoint_count,
      COALESCE(r.wholesale_price_cents, d.reseller_default, 800)::int AS wholesale_price_cents,
      (COALESCE(c.ep_count, 0) *
        COALESCE(r.wholesale_price_cents, d.reseller_default, 800))::bigint AS line_total_cents
      FROM resellers r
 LEFT JOIN counts c ON c.reseller_id = r.id
 CROSS JOIN defaults d
  ORDER BY r.name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_distributor_billing_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distributor_billing_snapshot(uuid) TO authenticated, service_role;


------------------------------------------------------------------------
-- F4 (major) — get_reseller_billing_snapshot: restore the
-- platform_pricing_defaults fallback that the Wave-8 rewrite dropped.
-- Without this every reseller on default pricing invoices at $0.
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_reseller_billing_snapshot(uuid);
CREATE OR REPLACE FUNCTION public.get_reseller_billing_snapshot(_reseller_org_id uuid)
RETURNS TABLE(
    customer_org_id        uuid,
    customer_name          text,
    endpoint_count         bigint,
    wholesale_price_cents  integer,
    line_total_cents       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _reseller_org_id)) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    RETURN QUERY
    WITH defaults AS (
        SELECT
          (SELECT wholesale_price_cents FROM public.platform_pricing_defaults WHERE tier='customer') AS customer_default
    ),
    customers AS (
        SELECT id, name, wholesale_price_cents FROM public.organizations
         WHERE organization_type='customer' AND parent_partner_id = _reseller_org_id AND is_active = true
    ),
    counts AS (
        SELECT c.id AS customer_id, count(e.id) AS ep_count
          FROM customers c
          LEFT JOIN public.endpoints e ON e.organization_id = c.id
                                      AND e.deleted_at IS NULL AND e.is_active = true
         GROUP BY c.id
    )
    SELECT
      c.id,
      c.name,
      COALESCE(cc.ep_count, 0) AS endpoint_count,
      COALESCE(c.wholesale_price_cents, d.customer_default, 1100)::int AS wholesale_price_cents,
      (COALESCE(cc.ep_count, 0) *
        COALESCE(c.wholesale_price_cents, d.customer_default, 1100))::bigint AS line_total_cents
      FROM customers c
 LEFT JOIN counts cc ON cc.customer_id = c.id
 CROSS JOIN defaults d
  ORDER BY c.name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_reseller_billing_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reseller_billing_snapshot(uuid) TO authenticated, service_role;


------------------------------------------------------------------------
-- F5 (major) — home-user MRR overview was using the customer-tier
-- default (1500 cents = $15) instead of the home-user price (600 cents = $6),
-- inflating reported MRR by 2.5x.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_home_users_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    home_user_price_cents int := 600;  -- public Mithras Personal price ex-GST
    active_count          int;
    estimated_mrr_cents   bigint;
    new_30d               int;
    cancelled_30d         int;
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT count(*) INTO active_count
      FROM public.organizations
     WHERE organization_type='home_user' AND is_active=true
       AND coalesce(stripe_status, 'active') IN ('active','trialing');

    estimated_mrr_cents := active_count::bigint * home_user_price_cents;

    SELECT count(*) INTO new_30d
      FROM public.organizations
     WHERE organization_type='home_user'
       AND created_at >= now() - interval '30 days';

    SELECT count(*) INTO cancelled_30d
      FROM public.organizations
     WHERE organization_type='home_user'
       AND stripe_status IN ('canceled','past_due','unpaid')
       AND coalesce(updated_at, created_at) >= now() - interval '30 days';

    RETURN jsonb_build_object(
        'active_count',          active_count,
        'estimated_mrr_cents',   estimated_mrr_cents,
        'new_30d',               new_30d,
        'cancelled_30d',         cancelled_30d,
        'home_user_price_cents', home_user_price_cents
    );
END;
$$;


------------------------------------------------------------------------
-- E5 — Home-user welcome path: seed an org_report_recipients row at
-- subscription time so the promised monthly report actually goes out.
-- This is a trigger on the home-user org create path so the webhook
-- doesn't have to remember to do it.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_home_user_seed_report_recipient()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    primary_email text;
BEGIN
    IF NEW.organization_type <> 'home_user' THEN
        RETURN NEW;
    END IF;
    -- billing email lives on a dedicated column for home_user orgs (added in
    -- 20260606040000_home_user_channel.sql); fall back to slug if missing.
    primary_email := NULLIF(NEW.billing_email, '');
    IF primary_email IS NULL THEN
        RETURN NEW;
    END IF;
    INSERT INTO public.org_report_recipients (organization_id, email, monthly)
    VALUES (NEW.id, primary_email, true)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_home_user_seed_recipient ON public.organizations;
CREATE TRIGGER trg_home_user_seed_recipient
    AFTER INSERT ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_home_user_seed_report_recipient();
