-- 20260606050000_licence_pool.sql
--
-- Pre-paid licence pool model:
--
--   1. Mithras issues licences to distributors (super-admin → /admin/licences)
--   2. Distributors cut licences from their pool to resellers (/distributor/licences)
--   3. Resellers consume licences when they add a customer + endpoints
--      (/my-customers → create)
--
-- Every movement is recorded in licence_transactions for full audit trail.
-- The licence_balance column on organizations is a cached running total —
-- always recomputable from the transactions ledger.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS licence_balance integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.organizations.licence_balance IS
'Cached running balance of available licences. Distributors: licences Mithras has issued minus licences cut to resellers. Resellers: licences distributor cut to them minus licences consumed by customers. Customers: NOT used (customer endpoints consume from the parent reseller balance directly).';

CREATE TABLE IF NOT EXISTS public.licence_transactions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- from_org_id NULL = Mithras issuing licences (no upstream org).
    from_org_id         uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
    to_org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    quantity            integer NOT NULL CHECK (quantity != 0),
    reason              text NOT NULL CHECK (reason IN (
        'mithras_issue',       -- super-admin issues to a distributor
        'distributor_cut',     -- distributor cuts to a reseller
        'consumed',            -- reseller assigned to a customer endpoint
        'returned',            -- endpoint deactivated, licence returned to reseller
        'admin_adjust'         -- super-admin manual correction (audit)
    )),
    customer_org_id     uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    endpoint_id         uuid REFERENCES public.endpoints(id)     ON DELETE SET NULL,
    notes               text,
    created_by          uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_licence_transactions_to_org ON public.licence_transactions(to_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_licence_transactions_from_org ON public.licence_transactions(from_org_id, created_at DESC);

ALTER TABLE public.licence_transactions ENABLE ROW LEVEL SECURITY;

-- RLS: super-admins see everything; org admins see transactions where their
-- org is either side.
DROP POLICY IF EXISTS "Super admins manage licence transactions" ON public.licence_transactions;
CREATE POLICY "Super admins manage licence transactions"
    ON public.licence_transactions FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Org admins read their licence transactions" ON public.licence_transactions;
CREATE POLICY "Org admins read their licence transactions"
    ON public.licence_transactions FOR SELECT
    USING (
        public.is_admin_of_org(auth.uid(), to_org_id)
        OR (from_org_id IS NOT NULL AND public.is_admin_of_org(auth.uid(), from_org_id))
    );

-- ----- RPC: super-admin issues licences to a distributor ------------------
CREATE OR REPLACE FUNCTION public.issue_licences_to_distributor(
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
    txn_id uuid;
    target_type text;
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;
    IF _quantity IS NULL OR _quantity <= 0 THEN
        RAISE EXCEPTION 'quantity_must_be_positive';
    END IF;

    SELECT organization_type INTO target_type FROM public.organizations WHERE id = _distributor_org_id;
    IF target_type IS NULL THEN
        RAISE EXCEPTION 'target_org_not_found';
    END IF;
    IF target_type <> 'distributor' THEN
        RAISE EXCEPTION 'target_must_be_distributor';
    END IF;

    INSERT INTO public.licence_transactions
        (from_org_id, to_org_id, quantity, reason, notes, created_by)
    VALUES (NULL, _distributor_org_id, _quantity, 'mithras_issue', _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations
       SET licence_balance = licence_balance + _quantity
     WHERE id = _distributor_org_id;

    RETURN txn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_licences_to_distributor(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_licences_to_distributor(uuid, integer, text) TO authenticated, service_role;

-- ----- RPC: distributor cuts licences to one of their resellers -----------
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

    -- Caller must be admin of the parent distributor (or super-admin).
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), distributor_id)) THEN
        RAISE EXCEPTION 'caller_not_distributor_admin';
    END IF;

    SELECT licence_balance INTO distributor_bal FROM public.organizations WHERE id = distributor_id;
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
REVOKE ALL ON FUNCTION public.cut_licences_to_reseller(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cut_licences_to_reseller(uuid, integer, text) TO authenticated, service_role;

-- ----- RPC: reseller consumes a licence when allocating to a customer -----
--
-- Returns the transaction id; raises if the reseller's pool is empty.
-- Called from the customer-creation flow and from agent enrolment.
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

    -- Caller must be admin of the reseller or super-admin.
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), reseller_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    SELECT licence_balance INTO reseller_bal FROM public.organizations WHERE id = reseller_id;
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
REVOKE ALL ON FUNCTION public.consume_licence(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_licence(uuid, uuid, text) TO authenticated, service_role;

-- ----- RPC: return a licence to the reseller pool (endpoint deactivation) -
CREATE OR REPLACE FUNCTION public.return_licence(
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
BEGIN
    SELECT * INTO customer_row FROM public.organizations WHERE id = _customer_org_id;
    IF customer_row IS NULL THEN
        RAISE EXCEPTION 'customer_not_found';
    END IF;
    reseller_id := customer_row.parent_partner_id;
    IF reseller_id IS NULL THEN
        RAISE EXCEPTION 'customer_has_no_reseller';
    END IF;

    -- Caller: reseller admin or super-admin.
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), reseller_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    INSERT INTO public.licence_transactions
        (from_org_id, to_org_id, quantity, reason, customer_org_id, endpoint_id, notes, created_by)
    VALUES (_customer_org_id, reseller_id, 1, 'returned', _customer_org_id, _endpoint_id, _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations SET licence_balance = licence_balance + 1 WHERE id = reseller_id;
    RETURN txn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.return_licence(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_licence(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.issue_licences_to_distributor(uuid, integer, text) IS 'Super-admin only: increment a distributor''s licence pool by a positive quantity. Records a mithras_issue txn.';
COMMENT ON FUNCTION public.cut_licences_to_reseller(uuid, integer, text)       IS 'Distributor admin: move licences from the distributor pool to one of their resellers. Raises insufficient_distributor_balance if the disty pool is empty.';
COMMENT ON FUNCTION public.consume_licence(uuid, uuid, text)                   IS 'Reseller admin: decrement reseller pool by 1, record consumption against a customer/endpoint. Raises insufficient_reseller_balance when pool is empty — UI should catch this and prompt to contact the distributor.';
COMMENT ON FUNCTION public.return_licence(uuid, uuid, text)                    IS 'Reseller admin: credit 1 licence back to the reseller pool when an endpoint is deactivated.';

-- Helper view for the disty cut-licences screen: list every reseller under
-- the calling user's distributor org with their current balance.
CREATE OR REPLACE VIEW public.distributor_reseller_licences AS
SELECT
    r.id              AS reseller_id,
    r.name            AS reseller_name,
    r.parent_partner_id AS distributor_id,
    r.licence_balance,
    r.is_active,
    r.created_at
FROM public.organizations r
WHERE r.organization_type = 'partner';

GRANT SELECT ON public.distributor_reseller_licences TO authenticated, service_role;

COMMENT ON VIEW public.distributor_reseller_licences IS
'Resellers and their current licence balances. Filtered by RLS — distributor admins see only their resellers; super-admins see all.';
