-- 20260605070000_distributor_portal_schema.sql
--
-- Phase 2: distributor tier. A distributor sits ABOVE resellers in the
-- channel hierarchy:
--
--   Peritus (super_admin)
--     └── Distributor
--           └── Reseller (organization_type='partner', parent_partner_id=distributor.id)
--                 └── Customer
--
-- A distributor's view is WHOLESALE-ONLY: they see their resellers + aggregate
-- endpoint counts (for billing roll-up), but NOT the resellers' customers,
-- endpoints, threats, or any other operational data. The reseller owns that
-- relationship and the distributor must not be able to poach.
--
-- This is enforced by:
--   1. RLS policies that only expose `organizations` rows where
--      parent_partner_id = distributor's org id AND type = 'partner'.
--      They explicitly DO NOT extend partner-admin RLS to distributors on
--      endpoint_status / endpoint_threats / endpoint_event_logs / etc.
--   2. The billing snapshot RPC is SECURITY DEFINER and returns only
--      pre-aggregated counts per reseller.

-- 1. Helper: org id of the distributor the user admins (NULL otherwise).
CREATE OR REPLACE FUNCTION public.get_distributor_org_id(_user_id uuid)
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
       AND o.organization_type = 'distributor'
     LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_distributor_org_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distributor_org_id(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_distributor_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.get_distributor_org_id(_user_id) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.is_distributor_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_distributor_admin(uuid) TO authenticated, service_role;

-- 2. Helper: is the user admin of the distributor that owns this RESELLER?
--    Walks ONE level (org's parent must be a distributor org the user admins).
--    Used in RLS so a distributor admin can SELECT/UPDATE their resellers.
CREATE OR REPLACE FUNCTION public.is_distributor_admin_of_org(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.organizations child
          JOIN public.organizations parent ON child.parent_partner_id = parent.id
          JOIN public.organization_memberships om ON om.organization_id = parent.id
         WHERE child.id = _org_id
           AND om.user_id = _user_id
           AND om.role IN ('admin','owner')
           AND parent.organization_type = 'distributor'
    )
$$;
REVOKE ALL ON FUNCTION public.is_distributor_admin_of_org(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_distributor_admin_of_org(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_distributor_admin_of_org(uuid, uuid) IS
'True if the user is admin/owner of the DISTRIBUTOR organisation that this org sits underneath. Walks one level only — does not extend to the resellers customers (wholesale-only model).';

-- 3. Per-reseller billing rollup, called by the distributor portal.
--    SECURITY DEFINER so the distributor never SELECTs the underlying
--    customer/endpoint rows; they only receive the aggregated numbers.
CREATE OR REPLACE FUNCTION public.get_distributor_billing_snapshot(_distributor_org_id uuid)
RETURNS TABLE (
    reseller_org_id        uuid,
    reseller_name          text,
    customer_count         bigint,
    endpoint_count         bigint,
    wholesale_price_cents  integer,
    line_total_cents       bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH resellers AS (
        SELECT id, name, COALESCE(wholesale_price_cents, 0) AS wholesale_price_cents
          FROM public.organizations
         WHERE parent_partner_id = _distributor_org_id
           AND organization_type = 'partner'
    ),
    customers AS (
        SELECT r.id              AS reseller_id,
               count(c.id)::bigint AS customer_count
          FROM resellers r
          LEFT JOIN public.organizations c
            ON c.parent_partner_id = r.id
           AND c.organization_type  = 'customer'
         GROUP BY r.id
    ),
    endpoints AS (
        SELECT r.id                 AS reseller_id,
               count(e.id)::bigint  AS endpoint_count
          FROM resellers r
          LEFT JOIN public.organizations c
            ON c.parent_partner_id = r.id
           AND c.organization_type  = 'customer'
          LEFT JOIN public.endpoints e
            ON e.organization_id    = c.id
           AND e.deleted_at         IS NULL
           AND e.is_active          IS DISTINCT FROM false
         GROUP BY r.id
    )
    SELECT r.id                              AS reseller_org_id,
           r.name                            AS reseller_name,
           COALESCE(c.customer_count, 0)     AS customer_count,
           COALESCE(e.endpoint_count, 0)     AS endpoint_count,
           r.wholesale_price_cents,
           COALESCE(e.endpoint_count, 0)::bigint * r.wholesale_price_cents::bigint AS line_total_cents
      FROM resellers r
      LEFT JOIN customers c ON c.reseller_id = r.id
      LEFT JOIN endpoints e ON e.reseller_id = r.id
     ORDER BY r.name;
$$;
REVOKE ALL ON FUNCTION public.get_distributor_billing_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distributor_billing_snapshot(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_distributor_billing_snapshot(uuid) IS
'Per-reseller rollup of customer count + endpoint count + wholesale subtotal for this distributor. SECURITY DEFINER so distributors get aggregates without RLS on the underlying customer rows — preserves the reseller↔customer relationship privacy.';

-- 4. RLS: distributor admins can manage their resellers.
--    They see/insert/update orgs where parent = self_distributor + type=partner.
--    They DO NOT get policies on endpoint_*, threat_*, audit_* tables — the
--    snapshot RPC above is their only window into customer data.

-- organizations: SELECT their resellers
DROP POLICY IF EXISTS "Distributor admins read their resellers" ON public.organizations;
CREATE POLICY "Distributor admins read their resellers"
    ON public.organizations FOR SELECT
    USING (public.is_distributor_admin_of_org(auth.uid(), id));

-- organizations: UPDATE their resellers (rename, pricing override)
DROP POLICY IF EXISTS "Distributor admins update their resellers" ON public.organizations;
CREATE POLICY "Distributor admins update their resellers"
    ON public.organizations FOR UPDATE
    USING (public.is_distributor_admin_of_org(auth.uid(), id));

-- organizations: INSERT a new reseller. Must be type=partner AND
-- parent_partner_id pointing at a distributor the inserter admins.
DROP POLICY IF EXISTS "Distributor admins create their resellers" ON public.organizations;
CREATE POLICY "Distributor admins create their resellers"
    ON public.organizations FOR INSERT
    WITH CHECK (
        organization_type = 'partner'
        AND parent_partner_id = public.get_distributor_org_id(auth.uid())
    );

-- enrollment_codes: distributor admins create + read codes for their resellers.
DROP POLICY IF EXISTS "Distributor admins manage reseller enrollment codes" ON public.enrollment_codes;
CREATE POLICY "Distributor admins manage reseller enrollment codes"
    ON public.enrollment_codes FOR ALL
    USING (public.is_distributor_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (public.is_distributor_admin_of_org(auth.uid(), organization_id));

-- organization_memberships: distributor admins can view their resellers'
-- members (for the per-reseller "members" count column). Read-only.
DROP POLICY IF EXISTS "Distributor admins read reseller memberships" ON public.organization_memberships;
CREATE POLICY "Distributor admins read reseller memberships"
    ON public.organization_memberships FOR SELECT
    USING (public.is_distributor_admin_of_org(auth.uid(), organization_id));
