-- Create endpoints table
CREATE TABLE public.endpoints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_token TEXT NOT NULL UNIQUE,
  hostname TEXT NOT NULL,
  os_version TEXT,
  os_build TEXT,
  defender_version TEXT,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  policy_id UUID REFERENCES public.defender_policies(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create endpoint_status table for current Defender status
CREATE TABLE public.endpoint_status (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  
  -- Core protection status
  realtime_protection_enabled BOOLEAN,
  antivirus_enabled BOOLEAN,
  antispyware_enabled BOOLEAN,
  behavior_monitor_enabled BOOLEAN,
  ioav_protection_enabled BOOLEAN,
  on_access_protection_enabled BOOLEAN,
  
  -- Scan status
  full_scan_age INTEGER,
  quick_scan_age INTEGER,
  full_scan_end_time TIMESTAMP WITH TIME ZONE,
  quick_scan_end_time TIMESTAMP WITH TIME ZONE,
  
  -- Signature status
  antivirus_signature_age INTEGER,
  antispyware_signature_age INTEGER,
  antivirus_signature_version TEXT,
  nis_signature_version TEXT,
  
  -- Cloud protection
  nis_enabled BOOLEAN,
  tamper_protection_source TEXT,
  
  -- Overall status
  computer_state INTEGER,
  am_running_mode TEXT,
  
  -- Raw JSON for additional data
  raw_status JSONB,
  
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create endpoint_threats table
CREATE TABLE public.endpoint_threats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  threat_id TEXT NOT NULL,
  threat_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Unknown', 'Low', 'Moderate', 'High', 'Severe')),
  category TEXT,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Removed', 'Quarantined', 'Allowed', 'Blocked', 'Cleaning')),
  initial_detection_time TIMESTAMP WITH TIME ZONE,
  last_threat_status_change_time TIMESTAMP WITH TIME ZONE,
  resources JSONB,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create endpoint_logs table for activity logs
CREATE TABLE public.endpoint_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  log_type TEXT NOT NULL CHECK (log_type IN ('scan', 'update', 'threat', 'policy', 'agent', 'error')),
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_endpoints_org ON public.endpoints(organization_id);
CREATE INDEX idx_endpoints_token ON public.endpoints(agent_token);
CREATE INDEX idx_endpoint_status_endpoint ON public.endpoint_status(endpoint_id);
CREATE INDEX idx_endpoint_status_collected ON public.endpoint_status(collected_at DESC);
CREATE INDEX idx_endpoint_threats_endpoint ON public.endpoint_threats(endpoint_id);
CREATE INDEX idx_endpoint_threats_status ON public.endpoint_threats(status);
CREATE INDEX idx_endpoint_logs_endpoint ON public.endpoint_logs(endpoint_id);
CREATE INDEX idx_endpoint_logs_created ON public.endpoint_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoint_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoint_threats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoint_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for endpoints
CREATE POLICY "Users can view endpoints in their organizations"
  ON public.endpoints FOR SELECT
  USING (public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can manage endpoints"
  ON public.endpoints FOR ALL
  USING (public.is_admin_of_org(auth.uid(), organization_id));

-- RLS Policies for endpoint_status (through endpoint)
CREATE POLICY "Users can view status for their org endpoints"
  ON public.endpoint_status FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.endpoints e 
    WHERE e.id = endpoint_id 
    AND public.is_member_of_org(auth.uid(), e.organization_id)
  ));

-- RLS Policies for endpoint_threats
CREATE POLICY "Users can view threats for their org endpoints"
  ON public.endpoint_threats FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.endpoints e 
    WHERE e.id = endpoint_id 
    AND public.is_member_of_org(auth.uid(), e.organization_id)
  ));

-- RLS Policies for endpoint_logs
CREATE POLICY "Users can view logs for their org endpoints"
  ON public.endpoint_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.endpoints e 
    WHERE e.id = endpoint_id 
    AND public.is_member_of_org(auth.uid(), e.organization_id)
  ));

-- Trigger for updated_at on endpoints
CREATE TRIGGER update_endpoints_updated_at
  BEFORE UPDATE ON public.endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();