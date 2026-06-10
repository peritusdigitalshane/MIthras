-- 20260606060000_credit_overdraft_visibility.sql
--
-- Make credit overdraft loud rather than silent.
--
-- Today, when a reseller's credit_balance goes negative (because they
-- onboarded more endpoints than their pool covers, or the monthly cron
-- burned past zero), nothing surfaces it to the user. Mike's complaint is
-- that he'll find out at next month's billing, by which time it's too
-- late to top up gracefully.
--
-- Two things this migration adds:
--   1. An is_credit_overdrawn cached flag on organizations, set whenever
--      a credit transaction drives the balance below zero. Frontend reads
--      this directly to render a sticky banner everywhere relevant.
--   2. A get_reseller_credit_health() RPC that returns the reseller's
--      balance, monthly burn, runway, overdraft, and consumed-this-month —
--      so the partner credits page can show a "you've used X% of credits
--      this month" warning without doing the math client-side.
--
-- Existing transactions are NOT rewritten — the flag is set going forward.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS is_credit_overdrawn boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.is_credit_overdrawn IS
'Cached flag — true when this org''s credit_balance is below zero. Maintained by triggers on credit_transactions. Frontend surfaces a sticky alert when true.';

-- Refresh the flag for any existing orgs already in overdraft.
UPDATE public.organizations
   SET is_credit_overdrawn = (credit_balance < 0)
 WHERE organization_type IN ('partner','distributor');

-- Trigger: after any credit_transactions insert, re-evaluate both sides'
-- is_credit_overdrawn flags. The flag mirrors the balance — never lies.
CREATE OR REPLACE FUNCTION public.sync_credit_overdraft_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.to_org_id IS NOT NULL THEN
        UPDATE public.organizations
           SET is_credit_overdrawn = (credit_balance < 0)
         WHERE id = NEW.to_org_id;
    END IF;
    IF NEW.from_org_id IS NOT NULL AND NEW.from_org_id <> NEW.to_org_id THEN
        UPDATE public.organizations
           SET is_credit_overdrawn = (credit_balance < 0)
         WHERE id = NEW.from_org_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_credit_overdraft ON public.credit_transactions;
CREATE TRIGGER trg_sync_credit_overdraft
    AFTER INSERT ON public.credit_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_credit_overdraft_flag();

-- Combined health snapshot for the reseller portal.
CREATE OR REPLACE FUNCTION public.get_reseller_credit_health(_reseller_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    out             jsonb;
    bal             integer;
    active_eps      integer;
    consumed_mtd    integer;
    runway_months   numeric;
BEGIN
    -- Caller must be admin of this reseller (or super-admin).
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _reseller_org_id)) THEN
        RAISE EXCEPTION 'caller_not_reseller_admin';
    END IF;

    SELECT credit_balance INTO bal
      FROM public.organizations WHERE id = _reseller_org_id;

    SELECT count(*)::int INTO active_eps
      FROM public.endpoints e
      JOIN public.organizations c ON c.id = e.organization_id
     WHERE c.parent_partner_id = _reseller_org_id
       AND c.organization_type = 'customer'
       AND e.deleted_at IS NULL
       AND e.is_active IS DISTINCT FROM false;

    -- Consumed month-to-date = sum of enrolment_consume + monthly_consume
    -- where to_org_id (or from_org_id for self-references) is this reseller
    -- and created_at is in the current month.
    SELECT COALESCE(SUM(quantity), 0)::int INTO consumed_mtd
      FROM public.credit_transactions
     WHERE reason IN ('enrolment_consume', 'monthly_consume')
       AND (from_org_id = _reseller_org_id OR to_org_id = _reseller_org_id)
       AND created_at >= date_trunc('month', now());

    runway_months := CASE WHEN active_eps > 0 THEN (bal::numeric / active_eps::numeric) ELSE NULL END;

    out := jsonb_build_object(
        'balance',             bal,
        'active_endpoints',    active_eps,
        'consumed_this_month', consumed_mtd,
        'runway_months',       runway_months,
        'is_overdrawn',        bal < 0,
        'is_low_runway',       runway_months IS NOT NULL AND runway_months < 1,
        'is_midmonth_warning',
            -- More than 50% of a month's worth burned already this month.
            consumed_mtd > 0 AND active_eps > 0 AND consumed_mtd > (active_eps * 0.5),
        'generated_at',        now()
    );
    RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_reseller_credit_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reseller_credit_health(uuid) TO authenticated, service_role;
