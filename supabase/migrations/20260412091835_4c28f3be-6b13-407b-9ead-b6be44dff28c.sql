
-- Create endpoint_commands table for queuing actions to agents
CREATE TABLE public.endpoint_commands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  parameters JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  issued_by UUID REFERENCES auth.users(id),
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.endpoint_commands ENABLE ROW LEVEL SECURITY;

-- Admins can create commands for their org endpoints
CREATE POLICY "Admins can create endpoint commands"
  ON public.endpoint_commands
  FOR INSERT
  WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

-- Members can view commands for their org
CREATE POLICY "Members can view endpoint commands"
  ON public.endpoint_commands
  FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id));

-- Admins can update commands in their org
CREATE POLICY "Admins can update endpoint commands"
  ON public.endpoint_commands
  FOR UPDATE
  USING (is_admin_of_org(auth.uid(), organization_id));

-- Super admins can manage all commands
CREATE POLICY "Super admins can manage all endpoint commands"
  ON public.endpoint_commands
  FOR ALL
  USING (is_super_admin(auth.uid()));

-- Partners can manage customer commands
CREATE POLICY "Partners can manage customer endpoint commands"
  ON public.endpoint_commands
  FOR ALL
  USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Index for fast lookup by endpoint + status
CREATE INDEX idx_endpoint_commands_pending ON public.endpoint_commands (endpoint_id, status) WHERE status = 'pending';
