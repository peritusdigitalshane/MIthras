-- 20260909030000_hash_router_tokens_at_rest.sql
--
-- Hash both router credentials at rest, and make router enrolment atomic.
--
-- WHAT WAS WRONG
-- --------------
-- 1. public.routers.agent_token was stored in PLAINTEXT and compared with a
--    plain equality lookup in the router-checkin edge function. Anyone with
--    read access to the table -- a database dump, a backup, the grafana_reader
--    role (which held BYPASSRLS and, before 20260812000000, SELECT on
--    everything), or any future SQL-injection -- could impersonate any router
--    and forge its telemetry.
--
-- 2. public.router_enrollment_tokens.token had the same problem. Endpoint
--    enrolment tokens were hashed at rest in 20260612220000, and WordPress
--    site secrets are hashed in the site-enroll function; routers were simply
--    never given the same treatment.
--
-- 3. handleEnroll incremented use_count with a read-then-write
--    (`use_count: token.use_count + 1`), so two concurrent enrolments both
--    read the same value and both wrote the same increment. A max_uses = 1
--    token could be redeemed several times in a race.
--
-- APPROACH
-- --------
-- Both credentials are bearer secrets presented IN FULL by the caller, so the
-- server can hash the presented value and compare against a stored digest --
-- it never needs to recover the plaintext. (This is the property that makes
-- endpoints.agent_token a harder problem: agent-heartbeat has to hand that one
-- back to agents as `legacy_agent_token`, so it cannot be stored hashed until
-- the six legacy agent-api subsystems move to HMAC. Tracked separately.)
--
-- SHA-256 with no salt is deliberate and correct here: these are 96-bit and
-- 192-bit random machine-generated tokens, not user passwords. There is no
-- dictionary to attack, and an unsalted digest keeps the lookup a single
-- indexed equality probe. A per-row salt would force a table scan.
--
-- Existing routers keep working: their tokens are backfilled to hashes in the
-- same transaction, and the plaintext columns are dropped only after.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. routers.agent_token -> agent_token_hash
-- ---------------------------------------------------------------------------

ALTER TABLE public.routers
    ADD COLUMN IF NOT EXISTS agent_token_hash text;

UPDATE public.routers
   SET agent_token_hash = encode(extensions.digest(agent_token, 'sha256'), 'hex')
 WHERE agent_token IS NOT NULL
   AND agent_token_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS routers_agent_token_hash_key
    ON public.routers (agent_token_hash)
    WHERE agent_token_hash IS NOT NULL;

ALTER TABLE public.routers DROP COLUMN IF EXISTS agent_token;

COMMENT ON COLUMN public.routers.agent_token_hash IS
    'SHA-256 (hex) of the router bearer token. The plaintext is returned to the '
    'router exactly once at enrolment and never stored. router-checkin hashes the '
    'presented x-token value and looks it up here.';

-- ---------------------------------------------------------------------------
-- 2. router_enrollment_tokens.token -> token_hash
-- ---------------------------------------------------------------------------

ALTER TABLE public.router_enrollment_tokens
    ADD COLUMN IF NOT EXISTS token_hash text;

UPDATE public.router_enrollment_tokens
   SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
 WHERE token IS NOT NULL
   AND token_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS router_enrollment_tokens_token_hash_key
    ON public.router_enrollment_tokens (token_hash)
    WHERE token_hash IS NOT NULL;

-- The column has a DEFAULT that generates plaintext; drop it before the column
-- so nothing keeps minting plaintext values.
ALTER TABLE public.router_enrollment_tokens ALTER COLUMN token DROP DEFAULT;
ALTER TABLE public.router_enrollment_tokens DROP COLUMN IF EXISTS token;

COMMENT ON COLUMN public.router_enrollment_tokens.token_hash IS
    'SHA-256 (hex) of the enrolment token. Plaintext is shown to the operator once '
    'at mint time (see mint_router_enrollment_token) and never persisted.';

-- ---------------------------------------------------------------------------
-- 3. Minting: return the plaintext once, store only the hash.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mint_router_enrollment_token(
    p_organization_id uuid,
    p_label           text DEFAULT 'Default',
    p_max_uses        integer DEFAULT NULL,
    p_expires_at      timestamptz DEFAULT NULL
)
RETURNS TABLE (token_id uuid, plaintext_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_plain text;
    v_id    uuid;
BEGIN
    -- Caller must be able to administer the target organisation. SECURITY
    -- DEFINER means we cannot rely on RLS here, so check explicitly.
    IF NOT (public.is_admin_of_org(auth.uid(), p_organization_id)
            OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'not authorised to mint enrolment tokens for this organisation';
    END IF;

    v_plain := encode(extensions.gen_random_bytes(24), 'hex');

    INSERT INTO public.router_enrollment_tokens
        (organization_id, token_hash, label, max_uses, expires_at, created_by)
    VALUES
        (p_organization_id,
         encode(extensions.digest(v_plain, 'sha256'), 'hex'),
         COALESCE(p_label, 'Default'),
         p_max_uses,
         p_expires_at,
         auth.uid())
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_id, v_plain;
END $$;

REVOKE ALL ON FUNCTION public.mint_router_enrollment_token(uuid, text, integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mint_router_enrollment_token(uuid, text, integer, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Atomic enrolment-slot reservation.
--
-- Mirrors reserve_site_enrollment_slot. The single UPDATE ... WHERE takes a
-- row lock, so concurrent enrolments serialise and max_uses is honoured
-- exactly. Returns zero rows when the token is unknown, inactive, expired, or
-- exhausted -- the caller cannot tell which, by design.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_router_enrollment_slot(p_token text)
RETURNS TABLE (organization_id uuid, use_count int, max_uses int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.router_enrollment_tokens t
       SET use_count = t.use_count + 1
     WHERE t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
       AND t.is_active
       AND (t.expires_at IS NULL OR t.expires_at > now())
       AND (t.max_uses  IS NULL OR t.use_count < t.max_uses)
    RETURNING t.organization_id, t.use_count, t.max_uses;
END $$;

REVOKE ALL ON FUNCTION public.reserve_router_enrollment_slot(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reserve_router_enrollment_slot(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Heartbeat lookup by hash.
--
-- SECURITY DEFINER + service_role only. Returns the router identity for a
-- presented bearer token and stamps last_seen_at in the same statement, so
-- the heartbeat path is one round trip instead of a select-then-update.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.router_heartbeat_by_token(
    p_token            text,
    p_wan_ip           text DEFAULT NULL,
    p_firmware_version text DEFAULT NULL,
    p_is_online        boolean DEFAULT true
)
RETURNS TABLE (id uuid, hostname text, organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.routers r
       SET last_seen_at     = now(),
           is_online        = COALESCE(p_is_online, true),
           wan_ip           = COALESCE(p_wan_ip, r.wan_ip),
           firmware_version = COALESCE(p_firmware_version, r.firmware_version)
     WHERE r.agent_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    RETURNING r.id, r.hostname, r.organization_id;
END $$;

REVOKE ALL ON FUNCTION public.router_heartbeat_by_token(text, text, text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.router_heartbeat_by_token(text, text, text, boolean) TO service_role;

COMMIT;
