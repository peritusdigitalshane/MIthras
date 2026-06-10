-- 20260605060000_reseller_portal_schema.sql
--
-- Phase 1 of the channel-partner portal: extends `organizations` so a
-- partner-typed org (which we now call a "reseller" in user-facing copy)
-- carries its own wholesale price, currency, billing contact, and
-- active/suspended state. Also seeds the `distributor` type so phase 2
-- can layer on top without another constraint change.
--
-- We deliberately keep the legacy column name `parent_partner_id` and the
-- legacy enum value `partner`. The schema already uses these in RLS
-- helpers (is_partner_admin_of_org) and several edge functions. Renaming
-- would force a churn across 30+ files for no semantic gain.

-- 1. New columns on organizations. Idempotent ADD COLUMN IF NOT EXISTS.
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS wholesale_price_cents integer,
    ADD COLUMN IF NOT EXISTS currency_code         text    NOT NULL DEFAULT 'AUD',
    ADD COLUMN IF NOT EXISTS billing_email         text,
    ADD COLUMN IF NOT EXISTS billing_contact_name  text,
    ADD COLUMN IF NOT EXISTS is_active             boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.wholesale_price_cents IS
'Per-endpoint monthly price the OWNER of this org pays. For a reseller this is what they owe Peritus per endpoint across all their customers. NULL = inherit channel default.';

COMMENT ON COLUMN public.organizations.currency_code IS
'ISO 4217 currency for invoices to/from this org. Defaults AUD.';

COMMENT ON COLUMN public.organizations.is_active IS
'Soft-suspend an org without deleting. Suspended resellers can still log in but cannot provision new customers; suspended customers stop accepting agent check-ins (enforced in agent-heartbeat).';

-- 2. Expand organization_type to allow 'distributor' (phase 2).
ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_organization_type_check;
ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_organization_type_check
    CHECK (organization_type IN ('partner', 'distributor', 'customer'));

-- 3. Helper: org id of the reseller (partner) this user admins, NULL otherwise.
--    A user is a reseller_admin if they are owner/admin of an org with
--    organization_type = 'partner'. Used by the frontend to decide whether
--    to route them into /partner/* and by RLS policies that need to scope
--    customers under that reseller.
CREATE OR REPLACE FUNCTION public.get_reseller_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT o.id
      FROM public.organizations o
      JOIN public.organization_memberships om
        ON om.organization_id = o.id
     WHERE om.user_id = _user_id
       AND om.role IN ('admin','owner')
       AND o.organization_type = 'partner'
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_reseller_org_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reseller_org_id(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_reseller_org_id(uuid) IS
'Returns the reseller (partner) organization id this user administers, or NULL if they are not a reseller admin. STABLE SECURITY DEFINER so it works inside RLS policies without recursion.';

-- 4. Helper: is the user a reseller admin at all? Convenience boolean.
CREATE OR REPLACE FUNCTION public.is_reseller_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.get_reseller_org_id(_user_id) IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.is_reseller_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_reseller_admin(uuid) TO authenticated, service_role;

-- 5. Reseller billing rollup: aggregate per-customer endpoint counts for the
--    current month, intended for both the portal billing view and the
--    monthly invoice job (phase 3). Returns one row per (reseller, customer).
--    Endpoint count = active, non-deleted endpoints currently on the books.
--    A more accurate "endpoint-days" calc lives in phase 3.
CREATE OR REPLACE FUNCTION public.get_reseller_billing_snapshot(_reseller_org_id uuid)
RETURNS TABLE (
    customer_org_id     uuid,
    customer_name       text,
    endpoint_count      bigint,
    wholesale_price_cents integer,
    line_total_cents    bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_reseller_billing_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reseller_billing_snapshot(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_reseller_billing_snapshot(uuid) IS
'Snapshot of what each customer under this reseller costs the reseller this billing cycle. Price precedence: per-customer override → reseller default → 0. Endpoint count is current active endpoints, not month-prorated (phase 3 adds endpoint-days).';
