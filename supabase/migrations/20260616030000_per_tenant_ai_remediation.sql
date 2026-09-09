-- 20260616030000_per_tenant_ai_remediation.sql
--
-- Per-customer-tenant master switches for whether the AI may take
-- remediation actions WITHOUT a human click.
--
--   * ai_email_remediation_enabled    — gate for AI-driven email auto-actions
--                                       (auto-quarantine of flagged messages,
--                                       auto-apply of block-rule actions when
--                                       Mithras detects net-new sender intent)
--
--   * ai_endpoint_remediation_enabled — gate for AI-driven endpoint actions
--                                       (auto-isolate, kill-process, quarantine
--                                       file, run-scan, etc. when the AI SOC
--                                       Response Agent's consensus is high)
--
-- Independent so an MSP can give a customer AI email protection without
-- granting it the more invasive endpoint-control authority (or vice
-- versa). Default OFF for safety — matches the AI SOC's existing Option C
-- rollout ("dark by default; enable per-customer explicitly").
--
-- Operator-clicked actions (Quarantine button on /email-security, Isolate
-- button on /endpoints/:id) are NOT gated by these flags. Only autonomous
-- AI actions are.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS ai_email_remediation_enabled    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ai_endpoint_remediation_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.ai_email_remediation_enabled IS
    'When true, AI may auto-quarantine flagged messages and auto-apply block rules without an operator click. Gates ONLY autonomous actions; operator-clicked email actions are always allowed.';

COMMENT ON COLUMN public.organizations.ai_endpoint_remediation_enabled IS
    'When true, AI SOC Response Agent may auto-isolate hosts, kill processes, quarantine files, etc. without an operator click. Gates ONLY autonomous actions; operator-clicked endpoint actions are always allowed.';
