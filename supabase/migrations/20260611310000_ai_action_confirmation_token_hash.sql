-- Security fix for ai_agent_actions.confirmation_token.
--
-- The original migration stored the rollback confirmation token in plaintext
-- in a column that org members can SELECT. That gave any member of the org
-- — including viewer-role users — the ability to call /ai-response-rollback
-- with the leaked token and roll back actions they shouldn't be able to.
--
-- Fix: store a SHA-256 hex hash instead. The raw token only exists in:
--   (a) the ai-response-execute response (delivered to the customer via email)
--   (b) the customer's inbox / the email-click URL
-- Even a full DB read leak no longer grants rollback authority.

BEGIN;

-- Add the hash column. nullable for the backfill step.
ALTER TABLE public.ai_agent_actions
    ADD COLUMN IF NOT EXISTS confirmation_token_hash text;

-- Backfill any rows that have a plaintext token (test rows from this session).
-- pgcrypto.digest is in the extensions schema in Supabase.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'ai_agent_actions'
           AND column_name = 'confirmation_token'
    ) THEN
        UPDATE public.ai_agent_actions
           SET confirmation_token_hash = encode(extensions.digest(confirmation_token, 'sha256'), 'hex')
         WHERE confirmation_token_hash IS NULL
           AND confirmation_token IS NOT NULL;
    END IF;
END $$;

-- Drop the plaintext column and its unique index.
DROP INDEX IF EXISTS uq_ai_agent_actions_confirmation_token;
ALTER TABLE public.ai_agent_actions
    DROP COLUMN IF EXISTS confirmation_token;

-- Going forward, the hash is required. Edge function generates + stores it.
ALTER TABLE public.ai_agent_actions
    ALTER COLUMN confirmation_token_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_actions_confirmation_token_hash
    ON public.ai_agent_actions (confirmation_token_hash);

COMMIT;
