-- 20260606110000_credit_requests_and_invites.sql
--
-- Closes the "how does a partner actually buy credits from their disty" loop.
-- Today partners have to email channel@... and hope the disty cuts credits.
-- This migration adds:
--
--   1. credit_requests — partner-initiated purchase requests with a status
--      lifecycle (pending → approved/declined/canceled). Approval atomically
--      cuts credits from the disty's pool into the reseller's via the
--      existing cut_credits_to_reseller RPC.
--   2. RPCs: request_credits / approve_credit_request / decline_credit_request
--      / cancel_credit_request. RLS scoped so partners see their own requests,
--      distys see requests from their resellers, super-admin sees all.
--   3. get_pending_enrolment_invites RPC — surfaces orgs the caller owns
--      that still have an unused enrolment_code (i.e. they're an "invite"
--      that hasn't been accepted). Powers the disty's pending-reseller-invite
--      list and the partner's pending-customer-invite list.

-- 1. Credit request table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_requests (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    reseller_org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    distributor_org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    requested_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    quantity                 integer NOT NULL CHECK (quantity > 0),
    notes                    text,
    status                   text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'declined', 'canceled')),
    resolved_at              timestamptz,
    resolved_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    resolution_notes         text,
    fulfilled_transaction_id uuid REFERENCES public.credit_transactions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_requests_reseller_status
    ON public.credit_requests(reseller_org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_requests_dist_status
    ON public.credit_requests(distributor_org_id, status, created_at DESC);

ALTER TABLE public.credit_requests ENABLE ROW LEVEL SECURITY;

-- Partners see their own org's requests; distys see requests for their
-- distributor org; super-admins see everything.
CREATE POLICY credit_requests_select ON public.credit_requests
    FOR SELECT USING (
           public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), reseller_org_id)
        OR public.is_admin_of_org(auth.uid(), distributor_org_id)
    );

-- Inserts only via the request_credits RPC (SECURITY DEFINER); updates only
-- via the approve/decline/cancel RPCs. So no direct-write policies — the
-- RPCs gate everything.

-- 2. RPC: partner requests credits ---------------------------------------
CREATE OR REPLACE FUNCTION public.request_credits(
    _reseller_org_id  uuid,
    _quantity         integer,
    _notes            text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    dist_id  uuid;
    new_id   uuid;
BEGIN
    IF _quantity IS NULL OR _quantity <= 0 THEN
        RAISE EXCEPTION 'quantity_must_be_positive';
    END IF;

    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    -- Look up the reseller's distributor.
    SELECT parent_partner_id INTO dist_id
      FROM public.organizations
     WHERE id = _reseller_org_id AND organization_type = 'partner';
    IF dist_id IS NULL THEN
        RAISE EXCEPTION 'reseller_has_no_distributor'
            USING DETAIL = 'Direct-signed resellers must contact Mithras directly to purchase credits.';
    END IF;

    -- One pending request per reseller at a time keeps the inbox sane.
    IF EXISTS (
        SELECT 1 FROM public.credit_requests
         WHERE reseller_org_id = _reseller_org_id
           AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'already_have_pending_request'
            USING DETAIL = 'You already have a pending credit request. Cancel it before submitting a new one.';
    END IF;

    INSERT INTO public.credit_requests
        (reseller_org_id, distributor_org_id, requested_by, quantity, notes, status)
    VALUES
        (_reseller_org_id, dist_id, auth.uid(), _quantity, _notes, 'pending')
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_credits(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_credits(uuid, integer, text) TO authenticated, service_role;

-- 3. RPC: disty approves a request ---------------------------------------
CREATE OR REPLACE FUNCTION public.approve_credit_request(
    _request_id        uuid,
    _notes             text    DEFAULT NULL,
    _unit_price_cents  integer DEFAULT NULL
)
RETURNS public.credit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    req     public.credit_requests%ROWTYPE;
    txn_id  uuid;
BEGIN
    SELECT * INTO req FROM public.credit_requests WHERE id = _request_id;
    IF req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
    IF req.status <> 'pending' THEN
        RAISE EXCEPTION 'request_not_pending'
            USING DETAIL = 'This request has already been resolved (status: ' || req.status || ').';
    END IF;
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), req.distributor_org_id)) THEN
        RAISE EXCEPTION 'caller_not_distributor_admin';
    END IF;

    -- Cut credits via the canonical RPC so the cut path stays single-source.
    -- cut_credits_to_reseller derives the distributor from the caller's auth.uid()
    -- via is_admin_of_org — since we already gated the caller as distributor admin,
    -- this just works.
    txn_id := public.cut_credits_to_reseller(
                  req.reseller_org_id,
                  req.quantity,
                  _unit_price_cents,
                  COALESCE(_notes, 'Approved request #' || substring(req.id::text, 1, 8))
              );

    UPDATE public.credit_requests
       SET status                   = 'approved',
           resolved_at              = now(),
           resolved_by              = auth.uid(),
           resolution_notes         = _notes,
           fulfilled_transaction_id = txn_id,
           updated_at               = now()
     WHERE id = _request_id
    RETURNING * INTO req;

    RETURN req;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_credit_request(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_credit_request(uuid, text, integer) TO authenticated, service_role;

-- 4. RPC: disty declines a request ---------------------------------------
CREATE OR REPLACE FUNCTION public.decline_credit_request(
    _request_id uuid,
    _reason     text
)
RETURNS public.credit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    req public.credit_requests%ROWTYPE;
BEGIN
    SELECT * INTO req FROM public.credit_requests WHERE id = _request_id;
    IF req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
    IF req.status <> 'pending' THEN
        RAISE EXCEPTION 'request_not_pending'
            USING DETAIL = 'This request has already been resolved (status: ' || req.status || ').';
    END IF;
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), req.distributor_org_id)) THEN
        RAISE EXCEPTION 'caller_not_distributor_admin';
    END IF;

    UPDATE public.credit_requests
       SET status           = 'declined',
           resolved_at      = now(),
           resolved_by      = auth.uid(),
           resolution_notes = _reason,
           updated_at       = now()
     WHERE id = _request_id
    RETURNING * INTO req;

    RETURN req;
END;
$$;
REVOKE ALL ON FUNCTION public.decline_credit_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_credit_request(uuid, text) TO authenticated, service_role;

-- 5. RPC: partner cancels their own pending request ----------------------
CREATE OR REPLACE FUNCTION public.cancel_credit_request(
    _request_id uuid
)
RETURNS public.credit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    req public.credit_requests%ROWTYPE;
BEGIN
    SELECT * INTO req FROM public.credit_requests WHERE id = _request_id;
    IF req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
    IF req.status <> 'pending' THEN
        RAISE EXCEPTION 'request_not_pending';
    END IF;
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), req.reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    UPDATE public.credit_requests
       SET status      = 'canceled',
           resolved_at = now(),
           resolved_by = auth.uid(),
           updated_at  = now()
     WHERE id = _request_id
    RETURNING * INTO req;

    RETURN req;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_credit_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_credit_request(uuid) TO authenticated, service_role;

-- 6. Pending enrolment invites view --------------------------------------
--
-- An "invite" is an org that exists in the DB but no human has signed up
-- against its enrolment_code yet (use_count = 0). We surface these so the
-- creator (disty for resellers, partner for customers) can re-fetch the
-- URL if they lost it, or regenerate if it was compromised.
CREATE OR REPLACE FUNCTION public.get_pending_enrolment_invites(
    _parent_org_id   uuid,
    _child_org_type  text DEFAULT NULL
)
RETURNS TABLE (
    org_id              uuid,
    org_name            text,
    org_slug            text,
    org_type            text,
    org_created_at      timestamptz,
    code_id             uuid,
    code                text,
    code_role           text,
    code_created_at     timestamptz,
    code_expires_at     timestamptz,
    code_use_count      integer,
    code_max_uses       integer,
    code_is_active      boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _parent_org_id)) THEN
        RAISE EXCEPTION 'caller_not_parent_admin';
    END IF;

    RETURN QUERY
    SELECT
        o.id                        AS org_id,
        o.name                      AS org_name,
        o.slug                      AS org_slug,
        o.organization_type::text   AS org_type,
        o.created_at                AS org_created_at,
        c.id                        AS code_id,
        c.code                      AS code,
        c.role::text                AS code_role,
        c.created_at                AS code_created_at,
        c.expires_at                AS code_expires_at,
        c.use_count                 AS code_use_count,
        c.max_uses                  AS code_max_uses,
        c.is_active                 AS code_is_active
      FROM public.organizations o
      JOIN public.enrollment_codes c ON c.organization_id = o.id
     WHERE o.parent_partner_id = _parent_org_id
       AND (_child_org_type IS NULL OR o.organization_type::text = _child_org_type)
       AND c.is_active = true
       AND c.use_count = 0
       AND (c.expires_at IS NULL OR c.expires_at > now())
     ORDER BY o.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_pending_enrolment_invites(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_enrolment_invites(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_pending_enrolment_invites(uuid, text) IS
'Returns child orgs with unused, active enrolment codes — i.e. invites the parent (disty for resellers, partner for customers) sent that no human has accepted yet. Caller must admin the parent org.';
