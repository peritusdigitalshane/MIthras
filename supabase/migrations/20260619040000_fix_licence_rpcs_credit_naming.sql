-- Re-align the licence-pool RPCs with the actual production schema.
--
-- Problem found during platform audit 2026-06-19:
--   * `cut_licences_to_reseller` and `consume_licence` reference columns and
--     tables that do not exist on prod:
--       - column  licence_balance       -> actual is  credit_balance
--       - table   licence_transactions  -> actual is  credit_transactions
--       - reason value 'consumed' would fail credit_transactions_reason_check
--         (allowed: mithras_issue / distributor_cut / enrolment_consume /
--          monthly_consume / admin_adjust)
--   * The schema was renamed to "credit" semantics (credit_balance,
--     credit_transactions) but these RPC bodies were never updated.
--   * No recent call attempts in activity_logs, so the bug is latent — but
--     the first distributor who clicks "Cut licences" or first reseller who
--     enrols a customer would hit it.
--
-- This migration replaces both RPCs with bodies that use the right
-- table/column names. Behaviour is unchanged.

CREATE OR REPLACE FUNCTION public.cut_licences_to_reseller(
    _reseller_org_id uuid,
    _quantity integer,
    _notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    SELECT credit_balance INTO distributor_bal
      FROM public.organizations WHERE id = distributor_id FOR UPDATE;
    PERFORM 1 FROM public.organizations WHERE id = _reseller_org_id FOR UPDATE;

    IF distributor_bal < _quantity THEN
        RAISE EXCEPTION 'insufficient_distributor_balance'
            USING DETAIL = 'You have ' || distributor_bal || ' credits available; tried to cut ' || _quantity || '.';
    END IF;

    INSERT INTO public.credit_transactions
        (from_org_id, to_org_id, quantity, reason, notes, created_by)
    VALUES (distributor_id, _reseller_org_id, _quantity, 'distributor_cut', _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations SET credit_balance = credit_balance - _quantity WHERE id = distributor_id;
    UPDATE public.organizations SET credit_balance = credit_balance + _quantity WHERE id = _reseller_org_id;

    RETURN txn_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_licence(
    _customer_org_id uuid,
    _endpoint_id uuid DEFAULT NULL::uuid,
    _notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    SELECT credit_balance INTO reseller_bal
      FROM public.organizations WHERE id = reseller_id FOR UPDATE;
    IF reseller_bal < 1 THEN
        RAISE EXCEPTION 'insufficient_reseller_balance'
            USING DETAIL = 'Your distributor needs to allocate more credits before you can add this customer.',
                  HINT   = 'Contact your distributor to top up your credit pool.';
    END IF;

    INSERT INTO public.credit_transactions
        (from_org_id, to_org_id, quantity, reason, customer_org_id, endpoint_id, notes, created_by)
    VALUES (reseller_id, _customer_org_id, 1, 'enrolment_consume', _customer_org_id, _endpoint_id, _notes, auth.uid())
    RETURNING id INTO txn_id;

    UPDATE public.organizations SET credit_balance = credit_balance - 1 WHERE id = reseller_id;

    RETURN txn_id;
END;
$function$;
