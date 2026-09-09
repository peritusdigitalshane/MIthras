
-- Add agent_token to routers for check-in authentication
ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS agent_token text UNIQUE;

-- Router enrollment tokens table
CREATE TABLE public.router_enrollment_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  label text NOT NULL DEFAULT 'Default',
  is_active boolean NOT NULL DEFAULT true,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.router_enrollment_tokens ENABLE ROW LEVEL SECURITY;

-- RLS: org members can manage tokens
CREATE POLICY "Org members can view router enrollment tokens"
  ON public.router_enrollment_tokens FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "Org members can create router enrollment tokens"
  ON public.router_enrollment_tokens FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "Org members can update router enrollment tokens"
  ON public.router_enrollment_tokens FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "Org members can delete router enrollment tokens"
  ON public.router_enrollment_tokens FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
  ));

-- Index for fast token lookups during check-in
CREATE INDEX idx_router_enrollment_tokens_token ON public.router_enrollment_tokens(token);
