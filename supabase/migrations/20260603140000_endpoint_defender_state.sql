-- endpoints.defender_state — JSONB snapshot of Defender posture, updated
-- every heartbeat. Used by the SOC console to triage an endpoint that's gone
-- into a Defender-induced lockdown WITHOUT needing to round-trip a command.
--
-- Shape (set by agent's Get-DefenderStatePayload, v0.6.6+):
--   {
--     collected_at: ISO,
--     active_threats: [{threat_id, threat_name, severity_id, category_id, resources[], detection_time}],
--     active_threat_count: int,
--     recent_detections_24h: [{threat_id, detected_at, action_success, resource_short}],
--     recent_detection_count: int,
--     behavior_monitoring: 'on'|'off'|'unknown',
--     realtime_protection: 'on'|'off'|'unknown',
--     tamper_protection: 'on'|'off'|'unknown',
--     mithras_paths_excluded: bool,
--     asr_rules: [{rule_id, rule_name, mode}],
--     last_quick_scan_at: ISO|null,
--     last_full_scan_at: ISO|null
--   }

ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS defender_state JSONB;

ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS defender_state_updated_at TIMESTAMPTZ;

-- Partial index for the SOC's "endpoints with active threats" filter -- cheap
-- to maintain since most endpoints have count=0.
CREATE INDEX IF NOT EXISTS idx_endpoints_active_threats
    ON public.endpoints (organization_id)
    WHERE (defender_state ->> 'active_threat_count')::int > 0;

COMMENT ON COLUMN public.endpoints.defender_state IS
    'Live Defender posture snapshot from agent v0.6.6+. Used by SOC triage UI.';
