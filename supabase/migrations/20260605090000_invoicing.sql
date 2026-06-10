-- 20260605090000_invoicing.sql
--
-- Channel-tier invoicing. Peritus invoices distributors and direct resellers
-- monthly based on each party's endpoint count × wholesale rate at the
-- time of issue. Distributors in turn invoice their resellers (this table
-- holds those too — the issuing org is implicit in invoice.org_id).
--
-- Status lifecycle (string text instead of enum so we can extend without
-- migration pain):
--   draft     — generated but not sent. Editable.
--   sent      — emailed; sent_at set.
--   paid      — payment reconciled; paid_at + paid_via set.
--   overdue   — past due_date with no paid_at (set by a daily cron, not by user).
--   void      — cancelled, never to be paid.

CREATE TABLE IF NOT EXISTS public.invoices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number      text NOT NULL UNIQUE,        -- human-readable e.g. MTH-202606-0001
    issuer_org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    bill_to_org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    period_start        date NOT NULL,
    period_end          date NOT NULL,
    issued_at           timestamptz NOT NULL DEFAULT now(),
    due_date            date NOT NULL,
    subtotal_cents      integer NOT NULL DEFAULT 0,
    tax_cents           integer NOT NULL DEFAULT 0,
    total_cents         integer NOT NULL DEFAULT 0,
    currency_code       text    NOT NULL DEFAULT 'AUD',
    status              text    NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','paid','overdue','void')),
    sent_at             timestamptz,
    paid_at             timestamptz,
    paid_via            text,                        -- 'bank_transfer'/'stripe'/'cash'/etc
    notes               text,
    created_by          uuid REFERENCES auth.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_bill_to_org  ON public.invoices(bill_to_org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issuer_org   ON public.invoices(issuer_org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due   ON public.invoices(status, due_date);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    org_id              uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    description         text NOT NULL,
    quantity            integer NOT NULL DEFAULT 1,
    unit_price_cents    integer NOT NULL DEFAULT 0,
    line_total_cents    integer NOT NULL DEFAULT 0,
    position            integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON public.invoice_line_items(invoice_id);

-- RLS -------------------------------------------------------------------
ALTER TABLE public.invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

-- Super-admins manage all invoices
DROP POLICY IF EXISTS "Super admins manage invoices"        ON public.invoices;
CREATE POLICY "Super admins manage invoices"
    ON public.invoices FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins manage invoice line items" ON public.invoice_line_items;
CREATE POLICY "Super admins manage invoice line items"
    ON public.invoice_line_items FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

-- An org admin / owner can VIEW invoices billed to their org
DROP POLICY IF EXISTS "Org admins read their invoices" ON public.invoices;
CREATE POLICY "Org admins read their invoices"
    ON public.invoices FOR SELECT
    USING (public.is_admin_of_org(auth.uid(), bill_to_org_id));

DROP POLICY IF EXISTS "Org admins read their invoice line items" ON public.invoice_line_items;
CREATE POLICY "Org admins read their invoice line items"
    ON public.invoice_line_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.invoices i
             WHERE i.id = invoice_id
               AND public.is_admin_of_org(auth.uid(), i.bill_to_org_id)
        )
    );

-- A distributor admin can VIEW invoices issued BY their distributor org
-- (the invoices the disty issues to their resellers).
DROP POLICY IF EXISTS "Distributor admins read invoices they issued" ON public.invoices;
CREATE POLICY "Distributor admins read invoices they issued"
    ON public.invoices FOR SELECT
    USING (public.is_admin_of_org(auth.uid(), issuer_org_id));

DROP POLICY IF EXISTS "Distributor admins read line items they issued" ON public.invoice_line_items;
CREATE POLICY "Distributor admins read line items they issued"
    ON public.invoice_line_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.invoices i
             WHERE i.id = invoice_id
               AND public.is_admin_of_org(auth.uid(), i.issuer_org_id)
        )
    );

-- Issuance helpers -----------------------------------------------------

-- Next invoice number for a given issuer org and YYYYMM.
-- Format: <ISSUER-SLUG-3>-YYYYMM-NNNN  e.g. MTH-202606-0001
CREATE OR REPLACE FUNCTION public.next_invoice_number(_issuer_org_id uuid, _period_end date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    yyyymm  text := to_char(_period_end, 'YYYYMM');
    prefix  text;
    seq     int;
BEGIN
    SELECT upper(substr(regexp_replace(slug, '[^a-z0-9]', '', 'g'), 1, 3))
      INTO prefix
      FROM public.organizations
     WHERE id = _issuer_org_id;
    prefix := coalesce(nullif(prefix, ''), 'INV');

    SELECT count(*) + 1 INTO seq
      FROM public.invoices
     WHERE issuer_org_id = _issuer_org_id
       AND invoice_number LIKE prefix || '-' || yyyymm || '-%';

    RETURN prefix || '-' || yyyymm || '-' || lpad(seq::text, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_invoice_number(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid, date) TO authenticated, service_role;

-- Generate (or refresh as draft) the invoice from Peritus to a single
-- channel-partner org for one cycle. Reuses the existing rollup RPCs so
-- the math is consistent with what the partner sees in their billing page.
CREATE OR REPLACE FUNCTION public.generate_peritus_invoice(
    _bill_to_org_id uuid,
    _period_start   date,
    _period_end     date,
    _due_offset_days int DEFAULT 14
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    issuer_id   uuid;     -- the first super_admin's org acts as Peritus issuer if none designated
    new_id      uuid;
    existing_id uuid;
    org_type    text;
    org_currency text;
    line_total  bigint := 0;
    sub_total   bigint := 0;
BEGIN
    -- Resolve Peritus issuer org: the org with slug 'peritus' if present,
    -- otherwise the first 'distributor' or 'partner' org marked as platform owner.
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

    -- Idempotent: if a draft exists for this org+period, reuse it.
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

    -- For a distributor: one line per reseller using the distributor rollup
    -- For a reseller: one line per customer using the reseller rollup
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
    ELSE -- partner / reseller
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
REVOKE ALL ON FUNCTION public.generate_peritus_invoice(uuid, date, date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_peritus_invoice(uuid, date, date, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_peritus_invoice(uuid, date, date, int) IS
'Generates or refreshes a draft invoice for one distributor/reseller covering one billing period. Idempotent — calling twice for the same period replaces the draft. Returns the invoice id.';
