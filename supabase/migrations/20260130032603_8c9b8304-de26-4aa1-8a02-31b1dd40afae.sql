-- Phase 1: Add Missing Foreign Key Indexes
-- These reduce table scans during FK constraint validation on INSERT/UPDATE/DELETE

-- FK indexes for activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_endpoint_id ON public.activity_logs(endpoint_id);

-- FK indexes for endpoint_groups
CREATE INDEX IF NOT EXISTS idx_endpoint_groups_created_by ON public.endpoint_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_endpoint_groups_defender_policy_id ON public.endpoint_groups(defender_policy_id);
CREATE INDEX IF NOT EXISTS idx_endpoint_groups_wdac_policy_id ON public.endpoint_groups(wdac_policy_id);
CREATE INDEX IF NOT EXISTS idx_endpoint_groups_uac_policy_id ON public.endpoint_groups(uac_policy_id);
CREATE INDEX IF NOT EXISTS idx_endpoint_groups_windows_update_policy_id ON public.endpoint_groups(windows_update_policy_id);

-- FK indexes for endpoints
CREATE INDEX IF NOT EXISTS idx_endpoints_policy_id ON public.endpoints(policy_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_wdac_policy_id ON public.endpoints(wdac_policy_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_uac_policy_id ON public.endpoints(uac_policy_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_windows_update_policy_id ON public.endpoints(windows_update_policy_id);

-- FK indexes for other tables
CREATE INDEX IF NOT EXISTS idx_endpoint_rule_set_assignments_assigned_by ON public.endpoint_rule_set_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_enrollment_codes_created_by ON public.enrollment_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_firewall_audit_logs_rule_id ON public.firewall_audit_logs(rule_id);
CREATE INDEX IF NOT EXISTS idx_firewall_policies_created_by ON public.firewall_policies(created_by);
CREATE INDEX IF NOT EXISTS idx_group_rule_set_assignments_assigned_by ON public.group_rule_set_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_hunt_jobs_created_by ON public.hunt_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_hunt_matches_ioc_id ON public.hunt_matches(ioc_id);
CREATE INDEX IF NOT EXISTS idx_hunt_matches_reviewed_by ON public.hunt_matches(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_ioc_library_created_by ON public.ioc_library(created_by);
CREATE INDEX IF NOT EXISTS idx_organization_memberships_invited_by ON public.organization_memberships(invited_by);
CREATE INDEX IF NOT EXISTS idx_security_reports_generated_by ON public.security_reports(generated_by);
CREATE INDEX IF NOT EXISTS idx_endpoint_threats_manual_resolved_by ON public.endpoint_threats(manual_resolved_by);

-- Phase 2: Add Composite Indexes for Hot Query Paths
-- These speed up the most frequent query patterns in the agent API

-- endpoint_threats: frequently queried by endpoint_id + created_at for listing
CREATE INDEX IF NOT EXISTS idx_endpoint_threats_endpoint_created 
ON public.endpoint_threats(endpoint_id, created_at DESC);

-- endpoint_threats: queried by endpoint_id + threat_id for upsert lookups
CREATE INDEX IF NOT EXISTS idx_endpoint_threats_endpoint_threat_id 
ON public.endpoint_threats(endpoint_id, threat_id);

-- endpoint_status: queried by endpoint_id + collected_at for latest status
CREATE INDEX IF NOT EXISTS idx_endpoint_status_endpoint_collected 
ON public.endpoint_status(endpoint_id, collected_at DESC);

-- endpoint_event_logs: queried by endpoint_id + event_time for event listing
CREATE INDEX IF NOT EXISTS idx_endpoint_event_logs_endpoint_event_time 
ON public.endpoint_event_logs(endpoint_id, event_time DESC);

-- endpoints: queried by organization_id + last_seen_at for dashboard views
CREATE INDEX IF NOT EXISTS idx_endpoints_org_last_seen 
ON public.endpoints(organization_id, last_seen_at DESC);

-- endpoints: agent_token is used for authentication on every request
CREATE INDEX IF NOT EXISTS idx_endpoints_agent_token 
ON public.endpoints(agent_token);

-- endpoint_logs: queried by endpoint_id for log retrieval  
CREATE INDEX IF NOT EXISTS idx_endpoint_logs_endpoint_id 
ON public.endpoint_logs(endpoint_id, created_at DESC);

-- firewall_audit_logs: queried by endpoint_id + event_time
CREATE INDEX IF NOT EXISTS idx_firewall_audit_logs_endpoint_event_time
ON public.firewall_audit_logs(endpoint_id, event_time DESC);

-- wdac_discovered_apps: queried by endpoint_id + file_path + file_hash for upserts
CREATE INDEX IF NOT EXISTS idx_wdac_discovered_apps_endpoint_file
ON public.wdac_discovered_apps(endpoint_id, file_path, file_hash);