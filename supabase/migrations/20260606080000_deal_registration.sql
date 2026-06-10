-- 20260606080000_deal_registration.sql
--
-- Deal registration — the mechanism that makes "channel-only" enforceable.
--
-- A reseller registers a prospect they're working on. While the registration
-- is active, no other reseller (under the same distributor) can register the
-- same prospect, and the registered reseller is reported to the distributor +
-- super-admin so direct-sale attempts can be deflected.
--
-- Protection windows depend on stage:
--   qualified  →  60 days
--   demo       →  60 days
--   poc        →  90 days
--   quote      →  30 days (close-or-lose)
--
-- Advancing stages resets the protection clock to the stage's window. A deal
-- without stage advancement for > 90 days auto-expires (caught by daily cron).

CREATE TABLE IF NOT EXISTS public.deal_registrations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    -- Who's working the deal + their chain
    reseller_org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    distributor_org_id    uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    registered_by         uuid REFERENCES auth.users(id),

    -- The prospect
    prospect_name         text NOT NULL,
    prospect_email        text,
    prospect_industry     text,
    prospect_region       text,
    estimated_endpoints   integer NOT NULL DEFAULT 0 CHECK (estimated_endpoints >= 0),
    estimated_close_date  date,
    notes                 text,

    -- Stage + protection
    stage                 text NOT NULL DEFAULT 'qualified'
        CHECK (stage IN ('qualified','demo','poc','quote','won','lost','expired')),
    protection_starts_at  timestamptz NOT NULL DEFAULT now(),
    protection_expires_at timestamptz NOT NULL,

    -- Lifecycle
    status                text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','won','lost','expired')),
    won_customer_org_id   uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    won_at                timestamptz,
    lost_at               timestamptz,
    lost_reason           text
);

CREATE INDEX IF NOT EXISTS idx_deal_reg_reseller        ON public.deal_registrations(reseller_org_id);
CREATE INDEX IF NOT EXISTS idx_deal_reg_distributor     ON public.deal_registrations(distributor_org_id);
CREATE INDEX IF NOT EXISTS idx_deal_reg_status_expires  ON public.deal_registrations(status, protection_expires_at);
CREATE INDEX IF NOT EXISTS idx_deal_reg_prospect_lower  ON public.deal_registrations(lower(prospect_name));

COMMENT ON TABLE public.deal_registrations IS
'Channel deal registry. Resellers register prospects they''re actively pursuing; protection windows prevent intra-channel and direct-sale conflict for the registered period. Distributors get pipeline visibility across their resellers; super-admin sees the full pipeline across all channels.';

-- RLS -------------------------------------------------------------------
ALTER TABLE public.deal_registrations ENABLE ROW LEVEL SECURITY;

-- Reseller admins manage their own deals
DROP POLICY IF EXISTS "Resellers manage own deal registrations" ON public.deal_registrations;
CREATE POLICY "Resellers manage own deal registrations"
    ON public.deal_registrations FOR ALL
    USING (public.is_admin_of_org(auth.uid(), reseller_org_id))
    WITH CHECK (public.is_admin_of_org(auth.uid(), reseller_org_id));

-- Distributor admins read deals registered by their resellers
DROP POLICY IF EXISTS "Distributors read their resellers' deals" ON public.deal_registrations;
CREATE POLICY "Distributors read their resellers' deals"
    ON public.deal_registrations FOR SELECT
    USING (distributor_org_id IS NOT NULL
           AND public.is_admin_of_org(auth.uid(), distributor_org_id));

-- Super admins see everything
DROP POLICY IF EXISTS "Super admins manage all deal registrations" ON public.deal_registrations;
CREATE POLICY "Super admins manage all deal registrations"
    ON public.deal_registrations FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

-- Helper: how long does protection last for a given stage?
CREATE OR REPLACE FUNCTION public.deal_stage_window(_stage text)
RETURNS interval
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE _stage
        WHEN 'qualified' THEN interval '60 days'
        WHEN 'demo'      THEN interval '60 days'
        WHEN 'poc'       THEN interval '90 days'
        WHEN 'quote'     THEN interval '30 days'
        ELSE interval '60 days'
    END;
$$;

-- ----- RPC: reseller registers a deal -------------------------------------
CREATE OR REPLACE FUNCTION public.register_deal(
    _reseller_org_id      uuid,
    _prospect_name        text,
    _estimated_endpoints  integer DEFAULT 0,
    _estimated_close_date date    DEFAULT NULL,
    _prospect_email       text    DEFAULT NULL,
    _prospect_industry    text    DEFAULT NULL,
    _prospect_region      text    DEFAULT NULL,
    _notes                text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_id     uuid;
    dist_id    uuid;
    conflict_id uuid;
BEGIN
    IF _prospect_name IS NULL OR length(BTRIM(_prospect_name)) = 0 THEN
        RAISE EXCEPTION 'prospect_name_required';
    END IF;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    SELECT parent_partner_id INTO dist_id
      FROM public.organizations
     WHERE id = _reseller_org_id AND organization_type = 'partner';

    -- Conflict check: any active deal under the SAME distributor with a
    -- prospect_name that lower-cases to the same string blocks registration.
    -- (Direct resellers under Peritus Direct still get cross-checked against
    -- other direct resellers — that's correct.)
    SELECT id INTO conflict_id
      FROM public.deal_registrations
     WHERE status = 'active'
       AND lower(prospect_name) = lower(BTRIM(_prospect_name))
       AND (
              (dist_id IS NOT NULL  AND distributor_org_id = dist_id)
           OR (dist_id IS NULL      AND distributor_org_id IS NULL)
           )
     LIMIT 1;

    IF conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'deal_already_registered'
            USING DETAIL = 'Another reseller in your distribution chain has already registered this prospect.',
                  HINT   = 'Contact your distributor to coordinate or pick a different prospect.';
    END IF;

    INSERT INTO public.deal_registrations
        (reseller_org_id, distributor_org_id, registered_by,
         prospect_name, prospect_email, prospect_industry, prospect_region,
         estimated_endpoints, estimated_close_date, notes,
         stage, protection_starts_at, protection_expires_at, status)
    VALUES
        (_reseller_org_id, dist_id, auth.uid(),
         BTRIM(_prospect_name), _prospect_email, _prospect_industry, _prospect_region,
         _estimated_endpoints, _estimated_close_date, _notes,
         'qualified', now(), now() + public.deal_stage_window('qualified'), 'active')
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_deal(uuid, text, integer, date, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_deal(uuid, text, integer, date, text, text, text, text) TO authenticated, service_role;

-- ----- RPC: advance / change stage ----------------------------------------
CREATE OR REPLACE FUNCTION public.update_deal_stage(
    _deal_id   uuid,
    _new_stage text
)
RETURNS public.deal_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deal public.deal_registrations%ROWTYPE;
BEGIN
    SELECT * INTO deal FROM public.deal_registrations WHERE id = _deal_id;
    IF deal.id IS NULL THEN RAISE EXCEPTION 'deal_not_found'; END IF;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), deal.reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    IF _new_stage NOT IN ('qualified','demo','poc','quote') THEN
        RAISE EXCEPTION 'invalid_stage_for_advancement'
            USING HINT = 'Use convert_deal_to_customer or lose_deal for terminal states.';
    END IF;

    UPDATE public.deal_registrations
       SET stage                 = _new_stage,
           protection_expires_at = now() + public.deal_stage_window(_new_stage),
           updated_at            = now()
     WHERE id = _deal_id
    RETURNING * INTO deal;

    RETURN deal;
END;
$$;
REVOKE ALL ON FUNCTION public.update_deal_stage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_deal_stage(uuid, text) TO authenticated, service_role;

-- ----- RPC: convert deal to customer (won) --------------------------------
CREATE OR REPLACE FUNCTION public.convert_deal_to_customer(
    _deal_id          uuid,
    _customer_org_id  uuid
)
RETURNS public.deal_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deal public.deal_registrations%ROWTYPE;
BEGIN
    SELECT * INTO deal FROM public.deal_registrations WHERE id = _deal_id;
    IF deal.id IS NULL THEN RAISE EXCEPTION 'deal_not_found'; END IF;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), deal.reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
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
REVOKE ALL ON FUNCTION public.convert_deal_to_customer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_deal_to_customer(uuid, uuid) TO authenticated, service_role;

-- ----- RPC: lose deal ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lose_deal(
    _deal_id uuid,
    _reason  text DEFAULT NULL
)
RETURNS public.deal_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deal public.deal_registrations%ROWTYPE;
BEGIN
    SELECT * INTO deal FROM public.deal_registrations WHERE id = _deal_id;
    IF deal.id IS NULL THEN RAISE EXCEPTION 'deal_not_found'; END IF;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), deal.reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    UPDATE public.deal_registrations
       SET status      = 'lost',
           stage       = 'lost',
           lost_at     = now(),
           lost_reason = _reason,
           updated_at  = now()
     WHERE id = _deal_id
    RETURNING * INTO deal;

    RETURN deal;
END;
$$;
REVOKE ALL ON FUNCTION public.lose_deal(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lose_deal(uuid, text) TO authenticated, service_role;

-- ----- Daily auto-expiry cron ---------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_deals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
BEGIN
    WITH expired AS (
        UPDATE public.deal_registrations
           SET status     = 'expired',
               stage      = 'expired',
               updated_at = now()
         WHERE status = 'active'
           AND protection_expires_at < now()
        RETURNING 1
    )
    SELECT count(*) INTO n FROM expired;
    RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_deals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_deals() TO service_role;

-- Schedule once a day at 02:15.
SELECT cron.schedule(
    'mithras-expire-stale-deals',
    '15 2 * * *',
    $$SELECT public.expire_stale_deals();$$
);
