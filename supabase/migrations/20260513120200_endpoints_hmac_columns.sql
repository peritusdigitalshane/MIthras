-- Phase 1: additive columns on public.endpoints for HMAC auth + enrollment provenance.
-- Existing agents continue to authenticate via agent_token through agent-api; they don't see these columns.
-- New agents (phase 2+) use agent_secret + agent-heartbeat edge function.

ALTER TABLE public.endpoints
    ADD COLUMN agent_secret      text,              -- HMAC-SHA256 shared secret (base64url, 32 bytes raw)
    ADD COLUMN enrolled_via      text REFERENCES public.enrollment_tokens(token) ON DELETE SET NULL,
    ADD COLUMN enrolled_at       timestamptz,
    ADD COLUMN runtime           text CHECK (runtime IS NULL OR runtime IN ('powershell', 'dotnet')),
    ADD COLUMN agent_version     text,
    ADD COLUMN update_channel    text NOT NULL DEFAULT 'stable'
                                  CHECK (update_channel IN ('stable', 'beta', 'canary')),
    ADD COLUMN is_active         boolean NOT NULL DEFAULT true,
    ADD COLUMN revoked_at        timestamptz,
    ADD COLUMN revoked_reason    text;

CREATE INDEX idx_endpoints_active_hmac
    ON public.endpoints(id)
    WHERE agent_secret IS NOT NULL AND is_active = true;

-- agent_secret may be null for legacy rows; new rows from agent-enroll always set it.
COMMENT ON COLUMN public.endpoints.agent_secret IS
    'HMAC-SHA256 shared secret. NULL for legacy rows that still authenticate via agent_token. Phase 2+ agents always have this set.';
COMMENT ON COLUMN public.endpoints.is_active IS
    'False after admin revocation. agent-heartbeat/agent-event reject inactive endpoints.';
