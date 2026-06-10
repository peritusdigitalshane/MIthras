-- Wave 8 deeper-review fixes:
--
--   1. generate_peritus_invoice() was SECURITY DEFINER granted to authenticated
--      with no caller-identity check. Any authenticated user who knew a
--      distributor/partner org UUID could mint a real invoice from Peritus.
--      Add a super-admin gate at the top of the function body.
--
--   2. get_reseller_billing_snapshot() was SECURITY DEFINER granted to
--      authenticated with no caller-identity check. Same shape as (1) — a
--      cross-org data leak (customer names, endpoint counts, pricing) if
--      anyone guessed a reseller org UUID. Add a member-or-super-admin gate.
--
--   3. The ai-cost-monitor cron schedule (20260608100200) used a plain
--      `cron.schedule()` call that is not idempotent. Re-running the
--      migration on a fresh replica raises unique_violation on the job
--      name. Guard with cron.unschedule first.
--
-- Wave 8 deeper-review fixes — paired one migration so the deploy script
-- doesn't have to add three more entries.

-- 1. generate_peritus_invoice: super-admin gate -----------------------------

CREATE OR REPLACE FUNCTION public.generate_peritus_invoice(
    _bill_to_org_id uuid,
    _period_start   date,
    _period_end     date,
    _due_offset_days int DEFAULT 14
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    issuer_id   uuid;
    new_id      uuid;
    existing_id uuid;
    org_type    text;
    org_currency text;
    sub_total   bigint := 0;
BEGIN
    -- Wave 8 fix: callers must be super-admins. Without this any authenticated
    -- user could mint invoices on behalf of the Peritus issuer org.
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'forbidden_not_super_admin'
            USING DETAIL = 'Only Peritus super-admins can generate invoices.';
    END IF;

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
        SELECT new_id,
               s.reseller_org_id,
               'Reseller: ' || s.reseller_name || ' (' || s.endpoint_count || ' endpoints)',
               s.endpoint_count::int,
               s.wholesale_price_cents,
               s.line_total_cents::int,
               row_number() OVER (ORDER BY s.reseller_name)
          FROM public.get_distributor_billing_snapshot(_bill_to_org_id) s
         WHERE s.endpoint_count > 0;
    ELSE
        INSERT INTO public.invoice_line_items
            (invoice_id, org_id, description, quantity, unit_price_cents, line_total_cents, position)
        SELECT new_id,
               s.customer_org_id,
               'Customer: ' || s.customer_name || ' (' || s.endpoint_count || ' endpoints)',
               s.endpoint_count::int,
               s.wholesale_price_cents,
               s.line_total_cents::int,
               row_number() OVER (ORDER BY s.customer_name)
          FROM public.get_reseller_billing_snapshot(_bill_to_org_id) s
         WHERE s.endpoint_count > 0;
    END IF;

    SELECT COALESCE(SUM(line_total_cents), 0) INTO sub_total
      FROM public.invoice_line_items
     WHERE invoice_id = new_id;

    UPDATE public.invoices
       SET subtotal_cents = sub_total::int,
           total_cents    = sub_total::int,
           updated_at     = now()
     WHERE id = new_id;

    RETURN new_id;
END;
$$;

-- 2. get_reseller_billing_snapshot: member-or-super-admin gate -------------

CREATE OR REPLACE FUNCTION public.get_reseller_billing_snapshot(_reseller_org_id uuid)
RETURNS TABLE (
    customer_org_id     uuid,
    customer_name       text,
    endpoint_count      bigint,
    wholesale_price_cents integer,
    line_total_cents    bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Wave 8 fix: caller must be a super-admin or admin of the reseller org.
    -- Was previously open to any authenticated user with knowledge of the
    -- reseller UUID — a cross-org data leak.
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_member_of_org(auth.uid(), _reseller_org_id)) THEN
        RAISE EXCEPTION 'forbidden_not_member'
            USING DETAIL = 'You must be a member of the reseller organisation or a Peritus super-admin to view billing.';
    END IF;

    RETURN QUERY
        SELECT
            c.id                                                                       AS customer_org_id,
            c.name                                                                     AS customer_name,
            COALESCE(ep.endpoint_count, 0)                                             AS endpoint_count,
            COALESCE(c.wholesale_price_cents, r.wholesale_price_cents, 0)              AS wholesale_price_cents,
            COALESCE(ep.endpoint_count, 0)
              * COALESCE(c.wholesale_price_cents, r.wholesale_price_cents, 0)::bigint  AS line_total_cents
          FROM public.organizations c
          JOIN public.organizations r ON r.id = c.parent_partner_id
          LEFT JOIN (
              SELECT organization_id, count(*)::bigint AS endpoint_count
                FROM public.endpoints
               WHERE deleted_at IS NULL
                 AND is_active IS DISTINCT FROM false
               GROUP BY organization_id
          ) ep ON ep.organization_id = c.id
         WHERE c.parent_partner_id = _reseller_org_id
           AND c.organization_type = 'customer'
         ORDER BY c.name;
END;
$$;

-- 3. ai-cost-monitor cron: idempotent re-schedule -------------------------

-- Drop the job if it exists (idempotent — surface NULL row if not present)
-- then re-schedule. Re-running this migration is now safe.
DO $$
BEGIN
    PERFORM cron.unschedule('mithras-ai-cost-monitor');
EXCEPTION WHEN OTHERS THEN
    -- cron.unschedule raises if the job doesn't exist; swallow silently.
    NULL;
END $$;

-- Re-create the schedule with the same kong+private.cron_settings pattern as
-- 20260608100200. Keep this body in sync with that migration — when the
-- original changes, copy it here verbatim.
SELECT cron.schedule(
    'mithras-ai-cost-monitor',
    '0 * * * *',
    $cron$
        SELECT net.http_post(
            url     := 'http://supabase-kong:8000/functions/v1/ai-cost-monitor',
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || (SELECT value FROM private.cron_settings WHERE key = 'service_role_key'),
                'apikey'       , (SELECT value FROM private.cron_settings WHERE key = 'service_role_key')
            ),
            body    := jsonb_build_object()
        );
    $cron$
);
