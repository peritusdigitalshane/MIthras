-- 20260605080000_platform_pricing_defaults.sql
--
-- Platform-wide default pricing per channel tier. Super-admins set these
-- and any organisation in that tier with a NULL wholesale_price_cents
-- inherits the default. Per-org overrides still win.
--
-- Three rows seeded at install time, one per tier we charge:
--   distributor → what Peritus charges the distributor per endpoint
--   partner     → what Peritus / the distributor charges the reseller
--   customer    → SUGGESTED retail per endpoint (resellers see as guidance)
--
-- The customer tier is advisory only — resellers may charge whatever they
-- want. We track it so the pricing sheet + billing rollups have a
-- recommended retail figure to surface.

CREATE TABLE IF NOT EXISTS public.platform_pricing_defaults (
    tier                       text PRIMARY KEY
        CHECK (tier IN ('distributor', 'partner', 'customer')),
    wholesale_price_cents      integer NOT NULL DEFAULT 0,
    currency_code              text    NOT NULL DEFAULT 'AUD',
    description                text,
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    updated_by                 uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE  public.platform_pricing_defaults IS
'Per-tier default per-endpoint price in the channel. Super-admin managed.';
COMMENT ON COLUMN public.platform_pricing_defaults.wholesale_price_cents IS
'Per-endpoint per-month price for organisations in this tier where their own wholesale_price_cents is NULL. Cents in currency_code.';

INSERT INTO public.platform_pricing_defaults (tier, wholesale_price_cents, description)
VALUES
  ('distributor', 500,  'What Peritus charges the distributor per endpoint per month.'),
  ('partner',     750,  'What a distributor (or Peritus, for direct resellers) charges the reseller per endpoint per month.'),
  ('customer',    1500, 'Suggested retail rate resellers charge their end customers. Advisory — resellers price as they wish.')
ON CONFLICT (tier) DO NOTHING;

ALTER TABLE public.platform_pricing_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read platform pricing defaults" ON public.platform_pricing_defaults;
CREATE POLICY "Anyone authenticated can read platform pricing defaults"
    ON public.platform_pricing_defaults FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Super admins manage platform pricing defaults" ON public.platform_pricing_defaults;
CREATE POLICY "Super admins manage platform pricing defaults"
    ON public.platform_pricing_defaults FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

-- View: every channel org with its effective per-endpoint price.
-- Effective = own override, else tier default, else 0.
CREATE OR REPLACE VIEW public.organization_pricing AS
SELECT
    o.id,
    o.name,
    o.slug,
    o.organization_type,
    o.parent_partner_id,
    o.wholesale_price_cents                                          AS override_price_cents,
    pd.wholesale_price_cents                                         AS tier_default_cents,
    COALESCE(o.wholesale_price_cents, pd.wholesale_price_cents, 0)   AS effective_price_cents,
    COALESCE(o.currency_code, pd.currency_code, 'AUD')               AS currency_code,
    o.is_active
  FROM public.organizations o
  LEFT JOIN public.platform_pricing_defaults pd
    ON pd.tier = o.organization_type;

GRANT SELECT ON public.organization_pricing TO authenticated, service_role;

COMMENT ON VIEW public.organization_pricing IS
'Each org with both its override and the tier default broken out, plus the effective price. Used by the pricing admin UI and billing roll-ups.';

-- Refresh the existing reseller/distributor billing snapshot RPCs so they
-- ALSO fall back to the tier default when a reseller/customer has no
-- override. Without this, all the billing screens read $0 until every
-- org gets an explicit override.
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
        COALESCE(c.wholesale_price_cents, r.wholesale_price_cents, pd.wholesale_price_cents, 0) AS wholesale_price_cents,
        COALESCE(ep.endpoint_count, 0)
          * COALESCE(c.wholesale_price_cents, r.wholesale_price_cents, pd.wholesale_price_cents, 0)::bigint AS line_total_cents
      FROM public.organizations c
      JOIN public.organizations r ON r.id = c.parent_partner_id
      LEFT JOIN public.platform_pricing_defaults pd ON pd.tier = 'customer'
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
    WITH defaults AS (
        SELECT
            (SELECT wholesale_price_cents FROM public.platform_pricing_defaults WHERE tier='partner') AS partner_default
    ),
    resellers AS (
        SELECT r.id,
               r.name,
               COALESCE(r.wholesale_price_cents, d.partner_default, 0) AS effective_price
          FROM public.organizations r, defaults d
         WHERE r.parent_partner_id = _distributor_org_id
           AND r.organization_type = 'partner'
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
           r.effective_price                 AS wholesale_price_cents,
           COALESCE(e.endpoint_count, 0)::bigint * r.effective_price::bigint AS line_total_cents
      FROM resellers r
      LEFT JOIN customers c ON c.reseller_id = r.id
      LEFT JOIN endpoints e ON e.reseller_id = r.id
     ORDER BY r.name;
$$;
