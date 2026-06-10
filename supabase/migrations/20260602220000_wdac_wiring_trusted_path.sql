-- PoC rec #8 Phase 1: WDAC wiring through the modular agent, plus the first
-- Airlock-flavoured feature: trusted-path rules. A trusted-path rule fires
-- only when BOTH the file path matches a glob AND the binary is signed by a
-- specific publisher. Closes the "drop unsigned payload into a trusted
-- folder" bypass class.
--
--   match_type='trusted_path'
--     match_value = path glob (case-insensitive, * wildcards)
--     publisher   = required Authenticode publisher (existing column)
--
-- Both engines learn this match type:
--   * AppWhitelist (PowerShell agent, WMI process watcher)
--   * WDAC          (kernel CI policy via WdacEnforcer.psm1, this iteration)

-- AppWhitelist rules: add 'trusted_path' to the allowed match_type set.
ALTER TABLE public.app_whitelist_rules
    DROP CONSTRAINT IF EXISTS app_whitelist_rules_valid_type;
ALTER TABLE public.app_whitelist_rules
    ADD CONSTRAINT app_whitelist_rules_valid_type
    CHECK (match_type IN ('hash','publisher','path','trusted_path'));

-- A trusted_path rule must declare its required publisher. Enforced at write.
ALTER TABLE public.app_whitelist_rules
    DROP CONSTRAINT IF EXISTS app_whitelist_rules_trusted_path_needs_publisher;
ALTER TABLE public.app_whitelist_rules
    ADD CONSTRAINT app_whitelist_rules_trusted_path_needs_publisher
    CHECK (match_type <> 'trusted_path' OR (publisher IS NOT NULL AND length(trim(publisher)) > 0));

-- WDAC rules: same expansion. Note WDAC has a separate publisher_name column.
ALTER TABLE public.wdac_rules
    DROP CONSTRAINT IF EXISTS wdac_rules_rule_type_check;
ALTER TABLE public.wdac_rules
    ADD CONSTRAINT wdac_rules_rule_type_check
    CHECK (rule_type = ANY (ARRAY['publisher','path','hash','file_name','trusted_path']));

ALTER TABLE public.wdac_rules
    DROP CONSTRAINT IF EXISTS wdac_rules_trusted_path_needs_publisher;
ALTER TABLE public.wdac_rules
    ADD CONSTRAINT wdac_rules_trusted_path_needs_publisher
    CHECK (rule_type <> 'trusted_path' OR (publisher_name IS NOT NULL AND length(trim(publisher_name)) > 0));

-- wdac_rule_set_rules has the same shape and constraint as wdac_rules; mirror.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'wdac_rule_set_rules_rule_type_check'
    ) THEN
        ALTER TABLE public.wdac_rule_set_rules DROP CONSTRAINT wdac_rule_set_rules_rule_type_check;
    END IF;
END$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wdac_rule_set_rules') THEN
        EXECUTE 'ALTER TABLE public.wdac_rule_set_rules
                  ADD CONSTRAINT wdac_rule_set_rules_rule_type_check
                  CHECK (rule_type = ANY (ARRAY[''publisher'',''path'',''hash'',''file_name'',''trusted_path'']))';
    END IF;
END$$;

COMMENT ON CONSTRAINT app_whitelist_rules_valid_type ON public.app_whitelist_rules IS
'trusted_path = path glob + required publisher. Airlock-style compound rule.';
