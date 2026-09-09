-- Add VirusTotal enrichment columns to ioc_library table
ALTER TABLE ioc_library ADD COLUMN vt_enrichment JSONB DEFAULT NULL;
ALTER TABLE ioc_library ADD COLUMN vt_enriched_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE ioc_library ADD COLUMN vt_detection_ratio TEXT DEFAULT NULL;

-- Add virustotal_api_key platform setting
INSERT INTO platform_settings (key, value, description, is_secret)
VALUES ('virustotal_api_key', NULL, 'VirusTotal API key for IOC enrichment', true)
ON CONFLICT (key) DO NOTHING;