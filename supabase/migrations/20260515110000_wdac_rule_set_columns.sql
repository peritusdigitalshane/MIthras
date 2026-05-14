-- 20260515110000_wdac_rule_set_columns.sql
-- Add audit-window, auto-promote, policy_version, feature_enabled columns to wdac_rule_sets.
-- Idempotent: each ADD COLUMN uses IF NOT EXISTS.

ALTER TABLE public.wdac_rule_sets
  ADD COLUMN IF NOT EXISTS audit_window_days int  NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS auto_promote      bool NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS policy_version    bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS feature_enabled   bool NOT NULL DEFAULT true;

COMMENT ON COLUMN public.wdac_rule_sets.audit_window_days IS
  'How many days a newly-assigned endpoint stays in audit mode before auto-promote.';
COMMENT ON COLUMN public.wdac_rule_sets.auto_promote IS
  'If true, hourly pg_cron job flips per-device current_mode to enforce when audit_until passes.';
COMMENT ON COLUMN public.wdac_rule_sets.policy_version IS
  'Bumped on any change to rules within this set. Agent compares to last_applied_version.';
COMMENT ON COLUMN public.wdac_rule_sets.feature_enabled IS
  'Kill switch — when false, agent treats devices on this rule set as mode=off.';
