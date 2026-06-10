-- Wave 15: two independent fixes.
--
-- 1. next_invoice_number() uses count(*)+1 to compute the per-issuer sequence
--    number. Two concurrent generate_peritus_invoice calls for the same
--    issuer+month see the same count and produce the same invoice number,
--    failing the unique constraint on invoices.invoice_number at commit
--    time. Wrap the count+return in a pg_advisory_xact_lock keyed on
--    hashtext(issuer || yyyymm) so concurrent calls serialise on the
--    same (issuer, month) only. Different (issuer, month) pairs do not
--    block each other.
--
-- 2. When an endpoint row is hard-deleted (i.e. its CASCADE-from-org or a
--    manual super-admin DELETE), the reseller licence pool stays
--    decremented. There's no caller of return_licence anywhere in the
--    codebase. Add an AFTER DELETE trigger that credits one licence
--    back to the parent reseller IF the customer is reseller-owned.
--    Soft-delete (deleted_at set) is OUT of scope — that's a separate
--    workstream where consume_licence needs to also be triggered on
--    INSERT. This trigger only handles hard-delete to plug the
--    immediate accounting drift.

-- 1. next_invoice_number with advisory lock --------------------------------

CREATE OR REPLACE FUNCTION public.next_invoice_number(_issuer_org_id uuid, _period_end date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    yyyymm    text := to_char(_period_end, 'YYYYMM');
    prefix    text;
    seq       int;
    lock_key  bigint;
BEGIN
    SELECT upper(substr(regexp_replace(slug, '[^a-z0-9]', '', 'g'), 1, 3))
      INTO prefix
      FROM public.organizations
     WHERE id = _issuer_org_id;
    prefix := coalesce(nullif(prefix, ''), 'INV');

    -- Serialise per (issuer, month). hashtext returns int (4 bytes) so we
    -- combine with the prefix to form a unique 8-byte advisory lock key.
    lock_key := (hashtextextended(_issuer_org_id::text || ':' || yyyymm, 0));
    PERFORM pg_advisory_xact_lock(lock_key);

    SELECT count(*) + 1 INTO seq
      FROM public.invoices
     WHERE issuer_org_id = _issuer_org_id
       AND invoice_number LIKE prefix || '-' || yyyymm || '-%';

    RETURN prefix || '-' || yyyymm || '-' || lpad(seq::text, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_invoice_number(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid, date) TO authenticated, service_role;

-- 2. return_licence on endpoint hard-delete --------------------------------

CREATE OR REPLACE FUNCTION public.on_endpoint_delete_return_licence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    customer_row public.organizations%ROWTYPE;
    reseller_id  uuid;
BEGIN
    -- Only act on rows belonging to a customer org that has a reseller.
    -- Direct customers (no parent_partner_id) and home-user orgs don't
    -- consume the licence pool, so nothing to return.
    SELECT * INTO customer_row FROM public.organizations WHERE id = OLD.organization_id;
    IF customer_row IS NULL THEN
        RETURN OLD;
    END IF;
    IF customer_row.organization_type IS DISTINCT FROM 'customer' THEN
        RETURN OLD;
    END IF;
    reseller_id := customer_row.parent_partner_id;
    IF reseller_id IS NULL THEN
        RETURN OLD;
    END IF;

    -- Credit the reseller pool and record the transaction. We use
    -- created_by = customer_row.created_by as a stand-in for the original
    -- consumer; the trigger itself runs in whatever session context
    -- triggered the delete (which may be a CASCADE — no auth.uid()).
    INSERT INTO public.licence_transactions
        (from_org_id, to_org_id, quantity, reason, customer_org_id, endpoint_id, notes, created_by)
    VALUES (
        OLD.organization_id, reseller_id, 1, 'returned',
        OLD.organization_id, OLD.id,
        'auto-return on endpoint delete',
        coalesce(auth.uid(), customer_row.created_by)
    );

    UPDATE public.organizations
       SET licence_balance = licence_balance + 1
     WHERE id = reseller_id;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_endpoints_return_licence ON public.endpoints;
CREATE TRIGGER trg_endpoints_return_licence
AFTER DELETE ON public.endpoints
FOR EACH ROW
EXECUTE FUNCTION public.on_endpoint_delete_return_licence();

COMMENT ON FUNCTION public.on_endpoint_delete_return_licence() IS
'Triggered AFTER DELETE on endpoints. Credits the reseller licence pool with one returned licence if the customer org has a parent_partner_id. No-op for direct customers, home-users, or rows without a parent reseller. Wave 15.';
