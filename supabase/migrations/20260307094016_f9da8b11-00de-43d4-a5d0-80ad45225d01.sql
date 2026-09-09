
-- Drop existing foreign keys and re-add with ON DELETE CASCADE for all endpoint child tables

-- endpoint_status
ALTER TABLE public.endpoint_status DROP CONSTRAINT IF EXISTS endpoint_status_endpoint_id_fkey;
ALTER TABLE public.endpoint_status ADD CONSTRAINT endpoint_status_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- endpoint_logs
ALTER TABLE public.endpoint_logs DROP CONSTRAINT IF EXISTS endpoint_logs_endpoint_id_fkey;
ALTER TABLE public.endpoint_logs ADD CONSTRAINT endpoint_logs_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- endpoint_event_logs
ALTER TABLE public.endpoint_event_logs DROP CONSTRAINT IF EXISTS endpoint_event_logs_endpoint_id_fkey;
ALTER TABLE public.endpoint_event_logs ADD CONSTRAINT endpoint_event_logs_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- endpoint_threats
ALTER TABLE public.endpoint_threats DROP CONSTRAINT IF EXISTS endpoint_threats_endpoint_id_fkey;
ALTER TABLE public.endpoint_threats ADD CONSTRAINT endpoint_threats_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- endpoint_group_memberships
ALTER TABLE public.endpoint_group_memberships DROP CONSTRAINT IF EXISTS endpoint_group_memberships_endpoint_id_fkey;
ALTER TABLE public.endpoint_group_memberships ADD CONSTRAINT endpoint_group_memberships_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- endpoint_rule_set_assignments
ALTER TABLE public.endpoint_rule_set_assignments DROP CONSTRAINT IF EXISTS endpoint_rule_set_assignments_endpoint_id_fkey;
ALTER TABLE public.endpoint_rule_set_assignments ADD CONSTRAINT endpoint_rule_set_assignments_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- firewall_audit_logs
ALTER TABLE public.firewall_audit_logs DROP CONSTRAINT IF EXISTS firewall_audit_logs_endpoint_id_fkey;
ALTER TABLE public.firewall_audit_logs ADD CONSTRAINT firewall_audit_logs_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- hunt_matches
ALTER TABLE public.hunt_matches DROP CONSTRAINT IF EXISTS hunt_matches_endpoint_id_fkey;
ALTER TABLE public.hunt_matches ADD CONSTRAINT hunt_matches_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;

-- activity_logs (endpoint_id is optional/nullable but should still cascade)
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_endpoint_id_fkey;
ALTER TABLE public.activity_logs ADD CONSTRAINT activity_logs_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE SET NULL;
