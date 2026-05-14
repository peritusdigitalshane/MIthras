-- 20260515110100_endpoint_app_control_state.sql
-- Per-(endpoint, rule_set) state. One row per endpoint-rule_set assignment.

CREATE TABLE IF NOT EXISTS public.endpoint_app_control_state (
  endpoint_id  uuid NOT NULL REFERENCES public.endpoints(id)        ON DELETE CASCADE,
  rule_set_id  uuid NOT NULL REFERENCES public.wdac_rule_sets(id)   ON DELETE CASCADE,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  audit_until  timestamptz NOT NULL,
  current_mode text NOT NULL DEFAULT 'audit'
    CHECK (current_mode IN ('audit','enforce','off')),
  last_applied_version  text,
  last_applied_at       timestamptz,
  apply_failure_count   int NOT NULL DEFAULT 0,
  last_apply_error      text,
  PRIMARY KEY (endpoint_id, rule_set_id)
);

CREATE INDEX IF NOT EXISTS idx_eacs_audit_until
  ON public.endpoint_app_control_state (audit_until)
  WHERE current_mode = 'audit';

ALTER TABLE public.endpoint_app_control_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read endpoint_app_control_state"
  ON public.endpoint_app_control_state FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.endpoints e
    WHERE e.id = endpoint_app_control_state.endpoint_id
      AND public.is_member_of_org(auth.uid(), e.organization_id)
  ));

CREATE POLICY "Admins update endpoint_app_control_state"
  ON public.endpoint_app_control_state FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.endpoints e
    WHERE e.id = endpoint_app_control_state.endpoint_id
      AND public.is_admin_of_org(auth.uid(), e.organization_id)
  ));

CREATE POLICY "Super admins manage endpoint_app_control_state"
  ON public.endpoint_app_control_state FOR ALL
  USING (public.is_super_admin(auth.uid()));
