-- =============================================================================
-- Email security: per-day sweep metrics
--
-- The flagged-messages list shows you what Mithras *flagged*. It doesn't
-- prove what Mithras *checked*. Customers who run a quiet month with no
-- detections need positive evidence the sweep is alive and processing mail.
--
-- This table accumulates daily counters per org. Every poll updates today's
-- row with the messages scanned, classified by AI vs short-circuited by a
-- block rule, and threats detected. The console sums it to display
-- "Messages scanned (last 30 days)" — the confidence number for a clean
-- month.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_sweep_metrics (
    organization_id           uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    sweep_date                date    NOT NULL,
    messages_scanned          bigint  NOT NULL DEFAULT 0,
    messages_classified_by_ai bigint  NOT NULL DEFAULT 0,
    messages_matched_by_rule  bigint  NOT NULL DEFAULT 0,
    threats_detected          bigint  NOT NULL DEFAULT 0,
    mailboxes_swept           integer NOT NULL DEFAULT 0,
    updated_at                timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, sweep_date)
);

CREATE INDEX IF NOT EXISTS email_sweep_metrics_org_date_desc_idx
    ON public.email_sweep_metrics (organization_id, sweep_date DESC);

ALTER TABLE public.email_sweep_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_sweep_metrics_select ON public.email_sweep_metrics;
CREATE POLICY email_sweep_metrics_select ON public.email_sweep_metrics
FOR SELECT TO authenticated
USING (
       public.is_super_admin(auth.uid())
    OR public.is_member_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
);

-- service-role writes only — no INSERT/UPDATE policy for authenticated.

-- ----------------------------------------------------------------------------
-- RPC: increment today's counters atomically. Service-role-only, called from
-- the m365-email-sweep edge function once per tenant per poll.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_email_sweep_metrics(
    _organization_id           uuid,
    _messages_scanned          bigint  DEFAULT 0,
    _messages_classified_by_ai bigint  DEFAULT 0,
    _messages_matched_by_rule  bigint  DEFAULT 0,
    _threats_detected          bigint  DEFAULT 0,
    _mailboxes_swept           integer DEFAULT 0
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.email_sweep_metrics AS m
           (organization_id, sweep_date, messages_scanned, messages_classified_by_ai, messages_matched_by_rule, threats_detected, mailboxes_swept)
    VALUES (_organization_id, (now() AT TIME ZONE 'utc')::date, _messages_scanned, _messages_classified_by_ai, _messages_matched_by_rule, _threats_detected, _mailboxes_swept)
    ON CONFLICT (organization_id, sweep_date) DO UPDATE
       SET messages_scanned          = m.messages_scanned          + EXCLUDED.messages_scanned,
           messages_classified_by_ai = m.messages_classified_by_ai + EXCLUDED.messages_classified_by_ai,
           messages_matched_by_rule  = m.messages_matched_by_rule  + EXCLUDED.messages_matched_by_rule,
           threats_detected          = m.threats_detected          + EXCLUDED.threats_detected,
           -- mailboxes_swept tracks the highest distinct-mailbox count seen
           -- this day (per-tenant), not a sum across polls.
           mailboxes_swept            = GREATEST(m.mailboxes_swept, EXCLUDED.mailboxes_swept),
           updated_at                 = now();
END;
$$;

REVOKE ALL ON FUNCTION public.increment_email_sweep_metrics(uuid, bigint, bigint, bigint, bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_email_sweep_metrics(uuid, bigint, bigint, bigint, bigint, integer) TO service_role;

COMMENT ON TABLE public.email_sweep_metrics IS
'Per-day per-org counters from the email security sweep. Surfaces "Messages scanned (30d)" and similar confidence metrics in the console.';
