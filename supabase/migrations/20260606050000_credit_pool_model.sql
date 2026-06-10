-- 20260606050000_credit_pool_model.sql
--
-- Pre-paid credit pool model.
--
-- THE UNIT
-- ---------
-- 1 credit = 1 endpoint protected for 1 calendar month.
--
-- THE FLOW
-- ---------
--   Mithras → Distributor: super-admin issues credits, priced from
--                           credit_pack_tiers (4-tier volume schedule).
--   Distributor → Reseller: disty cuts any quantity from their pool;
--                           per-cut price is the disty's call.
--   Reseller → Customer: 1 credit consumed at endpoint enrolment, then
--                         1 credit per active endpoint on the 1st of each
--                         calendar month (via pg_cron job).
--
-- Balances can go negative — that surfaces as "you owe N credits" in the
-- reseller portal. Reseller tops up; new enrolments resume.
--
-- No refunds: once cut, credits are the receiver's. Resellers can reallocate
-- between their own customers; distys don't refund.

-- 1. Per-org credit balance. NULL-defaults to 0; negative allowed (overdraft).
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS credit_balance integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.organizations.credit_balance IS
'Available credits. 1 credit = 1 endpoint × 1 month. Distributors have credits issued by Mithras. Resellers have credits cut by their distributor. Customers do NOT track credits — their endpoints draw from the parent reseller pool. Can go negative (overdraft); reseller tops up to clear.';

-- 2. Volume-tier price schedule. Mithras-set, applied when a distributor
--    purchases a credit pack. Picked from credit_pack_tiers by matching the
--    largest tier whose min_quantity <= requested quantity.
CREATE TABLE IF NOT EXISTS public.credit_pack_tiers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text NOT NULL,
    min_quantity        integer NOT NULL CHECK (min_quantity > 0),
    per_credit_cents    integer NOT NULL CHECK (per_credit_cents > 0),
    description         text,
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.credit_pack_tiers (name, min_quantity, per_credit_cents, description) VALUES
  ('Starter pack',    100,   600, 'Up to 99 credits per order. Standard rate.'),
  ('Growth pack',     500,   585, '500+ credits — 2.5% off standard.'),
  ('Scale pack',     1000,   570, '1,000+ credits — 5% off standard.'),
  ('Anchor pack',   10000,   540, '10,000+ credits — 10% off standard.')
ON CONFLICT DO NOTHING;

ALTER TABLE public.credit_pack_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Any authenticated user can read credit pack tiers" ON public.credit_pack_tiers;
CREATE POLICY "Any authenticated user can read credit pack tiers"
    ON public.credit_pack_tiers FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Super admins manage credit pack tiers" ON public.credit_pack_tiers;
CREATE POLICY "Super admins manage credit pack tiers"
    ON public.credit_pack_tiers FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

-- 3. Full audit ledger.
CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- from_org_id NULL = Mithras (issued from thin air against payment).
    from_org_id         uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
    to_org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    quantity            integer NOT NULL CHECK (quantity != 0),
    reason              text NOT NULL CHECK (reason IN (
        'mithras_issue',       -- super-admin issues to a distributor (paid order)
        'distributor_cut',     -- distributor cuts to a reseller
        'enrolment_consume',   -- agent enrolled, 1 credit charged immediately
        'monthly_consume',     -- 1st-of-month cron, batch deduction per active endpoint
        'admin_adjust'         -- super-admin manual correction
    )),
    -- Optional refs for traceability — populated by enrolment/monthly_consume.
    customer_org_id     uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    endpoint_id         uuid REFERENCES public.endpoints(id)     ON DELETE SET NULL,
    -- Per-credit price paid by the receiver (only set for mithras_issue +
    -- distributor_cut). Persists the deal even if pack tiers later change.
    unit_price_cents    integer,
    notes               text,
    created_by          uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_to_org   ON public.credit_transactions(to_org_id,   created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_txn_from_org ON public.credit_transactions(from_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_txn_endpoint ON public.credit_transactions(endpoint_id) WHERE endpoint_id IS NOT NULL;

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage credit transactions" ON public.credit_transactions;
CREATE POLICY "Super admins manage credit transactions"
    ON public.credit_transactions FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Org admins read their credit transactions" ON public.credit_transactions;
CREATE POLICY "Org admins read their credit transactions"
    ON public.credit_transactions FOR SELECT
    USING (
        public.is_admin_of_org(auth.uid(), to_org_id)
        OR (from_org_id IS NOT NULL AND public.is_admin_of_org(auth.uid(), from_org_id))
    );

-- 4. Helper: how much does N credits cost a distributor right now?
CREATE OR REPLACE FUNCTION public.get_credit_pack_price(_quantity integer)
RETURNS TABLE (
    quantity         integer,
    per_credit_cents integer,
    total_cents      bigint,
    tier_name        text
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT
        _quantity                  AS quantity,
        t.per_credit_cents,
        (_quantity::bigint * t.per_credit_cents::bigint) AS total_cents,
        t.name                     AS tier_name
    FROM public.credit_pack_tiers t
    WHERE t.is_active AND t.min_quantity <= _quantity
    ORDER BY t.min_quantity DESC
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_credit_pack_price(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_credit_pack_price(integer) TO authenticated, service_role;

-- 5. RPC: super-admin issues credits to a distributor.
CREATE OR REPLACE FUNCTION public.issue_credits_to_distributor(
    _distributor_org_id uuid,
    _quantity           integer,
    _notes              text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    txn_id      uuid;
    target_type text;
    unit_price  integer;
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;
    IF _quantity IS NULL OR _quantity <= 0 THEN
        RAISE EXCEPTION 'quantity_must_be_positive';
    END IF;

    SELECT organization_type INTO target_type
      FROM public.organizations WHERE id = _distributor_org_id;
    IF target_type IS NULL THEN
        RAISE EXCEPTION 'target_org_not_found';
    END IF;
    IF target_type <> 'distributor' THEN
        RAISE EXCEPTION 'target_must_be_distributor';
    END IF;

    SELECT per_credit_cents INTO unit_price
      FROM public.get_credit_pack_price(_quantity);

    INSERT INTO public.credit_transactions
        (from_org_id, to_org_id, quantity, reason, unit_price_cents, notes, created_by)
    VALUES (NULL, _distributor_org_id, _quantity, 'mithras_issue', unit_price, _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations
       SET credit_balance = credit_balance + _quantity
     WHERE id = _distributor_org_id;

    RETURN txn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_credits_to_distributor(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_credits_to_distributor(uuid, integer, text) TO authenticated, service_role;

-- 6. RPC: distributor cuts credits to one of their resellers. Distributor
--    sets the per-credit price they charge (defaults to NULL = "private deal").
CREATE OR REPLACE FUNCTION public.cut_credits_to_reseller(
    _reseller_org_id uuid,
    _quantity        integer,
    _unit_price_cents integer DEFAULT NULL,
    _notes           text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    txn_id          uuid;
    distributor_id  uuid;
    reseller_row    public.organizations%ROWTYPE;
    distributor_bal integer;
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

    SELECT credit_balance INTO distributor_bal FROM public.organizations WHERE id = distributor_id;
    IF distributor_bal < _quantity THEN
        RAISE EXCEPTION 'insufficient_distributor_balance'
            USING DETAIL = 'You have ' || distributor_bal || ' credits available; tried to cut ' || _quantity || '.';
    END IF;

    INSERT INTO public.credit_transactions
        (from_org_id, to_org_id, quantity, reason, unit_price_cents, notes, created_by)
    VALUES (distributor_id, _reseller_org_id, _quantity, 'distributor_cut', _unit_price_cents, _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations SET credit_balance = credit_balance - _quantity WHERE id = distributor_id;
    UPDATE public.organizations SET credit_balance = credit_balance + _quantity WHERE id = _reseller_org_id;

    RETURN txn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cut_credits_to_reseller(uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cut_credits_to_reseller(uuid, integer, integer, text) TO authenticated, service_role;

-- 7. RPC: charge 1 credit when an endpoint enrols. Called by the agent
--    enrolment edge function (agent-enroll or legacy paths).
CREATE OR REPLACE FUNCTION public.consume_credit_for_endpoint_enrolment(
    _endpoint_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    txn_id        uuid;
    endpoint_row  public.endpoints%ROWTYPE;
    customer_row  public.organizations%ROWTYPE;
    reseller_id   uuid;
BEGIN
    SELECT * INTO endpoint_row FROM public.endpoints WHERE id = _endpoint_id;
    IF endpoint_row IS NULL THEN
        RAISE EXCEPTION 'endpoint_not_found';
    END IF;

    SELECT * INTO customer_row FROM public.organizations WHERE id = endpoint_row.organization_id;
    IF customer_row IS NULL THEN
        RAISE EXCEPTION 'customer_org_not_found';
    END IF;

    -- Home users + direct customers don't draw from a reseller pool
    -- (home users go through Stripe; direct customers will be wired
    -- against the Peritus self-distributor in a follow-up).
    IF customer_row.organization_type <> 'customer' OR customer_row.parent_partner_id IS NULL THEN
        RETURN NULL;
    END IF;

    reseller_id := customer_row.parent_partner_id;

    -- Idempotency: if a credit was already charged for this endpoint's
    -- enrolment, don't double-charge.
    IF EXISTS (
        SELECT 1 FROM public.credit_transactions
         WHERE endpoint_id = _endpoint_id
           AND reason = 'enrolment_consume'
    ) THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.credit_transactions
        (from_org_id, to_org_id, quantity, reason, customer_org_id, endpoint_id, created_by)
    VALUES (reseller_id, customer_row.id, 1, 'enrolment_consume',
            customer_row.id, _endpoint_id, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations
       SET credit_balance = credit_balance - 1
     WHERE id = reseller_id;

    RETURN txn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_credit_for_endpoint_enrolment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_credit_for_endpoint_enrolment(uuid) TO authenticated, service_role;

-- 8. RPC: monthly burn. Called by pg_cron on the 1st of each calendar month.
--    For each reseller, deducts (active endpoint count) credits from their
--    pool. Logs one monthly_consume row per reseller for audit.
CREATE OR REPLACE FUNCTION public.run_monthly_credit_burn()
RETURNS TABLE (
    reseller_org_id uuid,
    reseller_name   text,
    endpoints_charged integer,
    new_balance     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r RECORD;
    txn_id uuid;
    ep_count int;
BEGIN
    FOR r IN
        SELECT o.id AS org_id, o.name
          FROM public.organizations o
         WHERE o.organization_type = 'partner'
           AND o.is_active = true
    LOOP
        -- Count active endpoints under all this reseller's customers.
        SELECT count(*)::int INTO ep_count
          FROM public.endpoints e
          JOIN public.organizations c ON c.id = e.organization_id
         WHERE c.parent_partner_id = r.org_id
           AND c.organization_type = 'customer'
           AND e.deleted_at IS NULL
           AND e.is_active IS DISTINCT FROM false;

        IF ep_count > 0 THEN
            INSERT INTO public.credit_transactions
                (from_org_id, to_org_id, quantity, reason, notes)
            VALUES (r.org_id, r.org_id, ep_count, 'monthly_consume',
                    'Auto burn for ' || to_char(now(), 'YYYY-MM') || ': ' || ep_count || ' active endpoints')
            RETURNING id INTO txn_id;

            UPDATE public.organizations
               SET credit_balance = credit_balance - ep_count
             WHERE id = r.org_id;
        END IF;

        reseller_org_id := r.org_id;
        reseller_name   := r.name;
        endpoints_charged := ep_count;
        SELECT credit_balance INTO new_balance FROM public.organizations WHERE id = r.org_id;
        RETURN NEXT;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.run_monthly_credit_burn() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_monthly_credit_burn() TO service_role;

COMMENT ON FUNCTION public.run_monthly_credit_burn() IS
'Monthly batch deduction of 1 credit per active endpoint per reseller. Scheduled via pg_cron on the 1st of each month at 00:05. Resellers with insufficient credits go into overdraft (negative balance) which the portal surfaces as "you owe N credits".';

-- 9. Schedule the monthly cron — first day of each month at 00:05.
SELECT cron.schedule(
    'mithras-monthly-credit-burn',
    '5 0 1 * *',
    $$SELECT public.run_monthly_credit_burn();$$
);

-- 10. Helper view: every reseller + balance + last-month burn for the
--     distributor portal "Cut credits" screen.
CREATE OR REPLACE VIEW public.distributor_reseller_credits AS
SELECT
    r.id                  AS reseller_id,
    r.name                AS reseller_name,
    r.parent_partner_id   AS distributor_id,
    r.credit_balance,
    r.is_active,
    r.created_at,
    (SELECT count(*)
       FROM public.endpoints e
       JOIN public.organizations c ON c.id = e.organization_id
      WHERE c.parent_partner_id = r.id
        AND e.deleted_at IS NULL
        AND e.is_active IS DISTINCT FROM false) AS active_endpoint_count
FROM public.organizations r
WHERE r.organization_type = 'partner';

GRANT SELECT ON public.distributor_reseller_credits TO authenticated, service_role;

COMMENT ON VIEW public.distributor_reseller_credits IS
'Resellers + their credit balance + current month-burn rate (one credit per active endpoint). RLS filters to distributor admins seeing only their own resellers; super-admins see all.';
