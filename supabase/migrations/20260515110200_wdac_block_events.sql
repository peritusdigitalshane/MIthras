-- 20260515110200_wdac_block_events.sql
-- Append-only log of enforce-mode block events from agents.

CREATE TABLE IF NOT EXISTS public.wdac_block_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  endpoint_id     uuid NOT NULL REFERENCES public.endpoints(id)      ON DELETE CASCADE,
  rule_set_id     uuid REFERENCES public.wdac_rule_sets(id)          ON DELETE SET NULL,
  blocked_at      timestamptz NOT NULL,
  file_path       text NOT NULL,
  file_hash       text,
  file_name       text,
  publisher       text,
  user_name       text,
  parent_process  text,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wbe_org_time      ON public.wdac_block_events (organization_id, blocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_wbe_endpoint_time ON public.wdac_block_events (endpoint_id, blocked_at DESC);

ALTER TABLE public.wdac_block_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read wdac_block_events"
  ON public.wdac_block_events FOR SELECT
  USING (public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins manage wdac_block_events"
  ON public.wdac_block_events FOR ALL
  USING (public.is_super_admin(auth.uid()));
