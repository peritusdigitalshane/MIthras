-- AI triage assessments on incidents.
--
-- Every incident gets ONE assessment row (1:1). Lazily populated by the
-- ai-triage-incident edge function. The Incidents page reads this and shows
-- the AI's plain-English summary + suggested action + MITRE tags + confidence.

CREATE TABLE IF NOT EXISTS public.incident_ai_assessments (
    incident_id        uuid PRIMARY KEY REFERENCES public.incidents(id) ON DELETE CASCADE,
    organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    summary            text,
    suggested_action   text,
    suggested_command  text CHECK (suggested_command IS NULL OR suggested_command IN (
        'isolate_network','release_isolation','kill_process','quarantine_file',
        'run_quick_scan','run_full_scan','collect_persistence','restart_agent','none'
    )),
    mitre_tags         text[] DEFAULT '{}'::text[],
    confidence         text CHECK (confidence IS NULL OR confidence IN ('high','medium','low')),
    severity_override  text CHECK (severity_override IS NULL OR severity_override IN ('Severe','High','Moderate','Low')),
    raw_response       jsonb,
    model              text,
    generated_at       timestamptz NOT NULL DEFAULT now(),
    error_message      text
);
CREATE INDEX IF NOT EXISTS idx_incident_ai_org ON public.incident_ai_assessments(organization_id, generated_at DESC);

ALTER TABLE public.incident_ai_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incident_ai_select_org" ON public.incident_ai_assessments;
CREATE POLICY "incident_ai_select_org" ON public.incident_ai_assessments FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "incident_ai_service" ON public.incident_ai_assessments;
CREATE POLICY "incident_ai_service" ON public.incident_ai_assessments FOR ALL TO service_role
USING (true) WITH CHECK (true);
