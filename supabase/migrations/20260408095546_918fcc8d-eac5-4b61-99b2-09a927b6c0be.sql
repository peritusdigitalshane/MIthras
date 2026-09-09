
-- Add viewer role to org_role enum
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'viewer';

-- Create alerts table
CREATE TABLE public.alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint_id UUID REFERENCES public.endpoints(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL DEFAULT 'info',
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by UUID REFERENCES public.profiles(id),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_org_id ON public.alerts(organization_id);
CREATE INDEX idx_alerts_acknowledged ON public.alerts(organization_id, acknowledged);
CREATE INDEX idx_alerts_created_at ON public.alerts(created_at DESC);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view alerts in their org"
  ON public.alerts FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins can view all alerts"
  ON public.alerts FOR SELECT
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Partners can view customer alerts"
  ON public.alerts FOR SELECT
  USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update alerts"
  ON public.alerts FOR UPDATE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins can manage all alerts"
  ON public.alerts FOR ALL
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete alerts"
  ON public.alerts FOR DELETE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "System can insert alerts"
  ON public.alerts FOR INSERT
  WITH CHECK (true);

-- Trigger function for auto-creating alerts on new threats
CREATE OR REPLACE FUNCTION public.create_alert_on_threat()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $fn$
DECLARE
  _org_id UUID;
  _hostname TEXT;
BEGIN
  SELECT e.organization_id, e.hostname INTO _org_id, _hostname
  FROM public.endpoints e WHERE e.id = NEW.endpoint_id;

  IF _org_id IS NOT NULL THEN
    INSERT INTO public.alerts (organization_id, endpoint_id, alert_type, severity, title, message)
    VALUES (
      _org_id,
      NEW.endpoint_id,
      'threat_detected',
      CASE 
        WHEN NEW.severity IN ('Severe', 'High') THEN 'critical'
        WHEN NEW.severity = 'Moderate' THEN 'high'
        ELSE 'medium'
      END,
      'Threat Detected: ' || NEW.threat_name,
      'Threat "' || NEW.threat_name || '" (' || NEW.severity || ') detected on endpoint ' || COALESCE(_hostname, 'Unknown') || '. Status: ' || NEW.status
    );
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER on_threat_created
  AFTER INSERT ON public.endpoint_threats
  FOR EACH ROW
  EXECUTE FUNCTION public.create_alert_on_threat();
