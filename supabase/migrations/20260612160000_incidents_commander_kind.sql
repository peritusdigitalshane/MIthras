-- =============================================================================
-- incidents.commander_kind
--
-- The ai-incident-commander LLM classifies incidents with a richer taxonomy
-- (malware / ransomware / credential_compromise / lateral_movement / …) than
-- the existing incidents_kind_check CHECK constraint allows (threat / alert /
-- posture_drift / agent_offline / vuln_critical / custom). The commander
-- function now maps its LLM kind to one of the 6 schema-allowed values for
-- the `kind` column, and stores the original LLM classification here so
-- nothing is lost from the analyst trail.
-- =============================================================================

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS commander_kind TEXT;

COMMENT ON COLUMN public.incidents.commander_kind IS
    'AI Commander''s richer kind classification (malware, ransomware, credential_compromise, lateral_movement, etc.). The constrained `kind` column holds the schema-allowed parent category.';
