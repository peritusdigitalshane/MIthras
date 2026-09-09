-- Create activity log table for audit trail
CREATE TABLE public.activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  endpoint_id UUID REFERENCES public.endpoints(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX idx_activity_logs_org_id ON public.activity_logs(organization_id);
CREATE INDEX idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_action ON public.activity_logs(action);
CREATE INDEX idx_activity_logs_resource_type ON public.activity_logs(resource_type);

-- Enable RLS
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can view activity logs for their organizations
CREATE POLICY "Users can view org activity logs"
ON public.activity_logs
FOR SELECT
USING (
  organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
);

-- Users can insert activity logs for their organizations
CREATE POLICY "Users can insert org activity logs"
ON public.activity_logs
FOR INSERT
WITH CHECK (
  organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
);

-- Create function to log activity
CREATE OR REPLACE FUNCTION public.log_activity(
  _org_id UUID,
  _action TEXT,
  _resource_type TEXT,
  _resource_id TEXT DEFAULT NULL,
  _details JSONB DEFAULT NULL,
  _endpoint_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO public.activity_logs (organization_id, user_id, endpoint_id, action, resource_type, resource_id, details)
  VALUES (_org_id, auth.uid(), _endpoint_id, _action, _resource_type, _resource_id, _details)
  RETURNING id INTO new_id;
  
  RETURN new_id;
END;
$$;