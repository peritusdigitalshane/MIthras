-- =====================================================================
-- Hash-at-rest for enrollment tokens
--
-- Adds a token_hash column and migrates the lookup path to hash-based
-- matching, so a database snapshot leak does not expose tokens that are
-- still valid for in-flight installs.
--
-- Compatibility:
--   * Existing in-flight tokens (where the raw value is stored in
--     `token`) are backfilled — token_hash = sha256(token). Both the
--     old plaintext lookup and the new hash lookup resolve correctly.
--   * Tokens issued through the new public REST API store ONLY the
--     hash; the `token` column carries an opaque storage value so the
--     NOT-NULL primary key constraint is satisfied without leaking the
--     credential.
--   * reserve_enrollment_slot still takes the agent-presented token
--     (raw) and hashes server-side, so agent-enroll requires no change.
-- =====================================================================

ALTER TABLE public.enrollment_tokens
  ADD COLUMN IF NOT EXISTS token_hash text;

-- Backfill — compute hash for every existing row.
UPDATE public.enrollment_tokens
   SET token_hash = encode(sha256(token::bytea), 'hex')
 WHERE token_hash IS NULL
   AND token IS NOT NULL
   AND token NOT LIKE '__hashed__:%';   -- safety belt for re-runs

-- Unique index on the hash so lookups are fast and collisions are rejected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_tokens_token_hash
  ON public.enrollment_tokens (token_hash)
  WHERE token_hash IS NOT NULL;

-- ---------------------------------------------------------------------
-- reserve_enrollment_slot: now hashes the presented token server-side
-- and matches on `token_hash`. Falls back to the legacy plaintext match
-- so any token issued before this migration but used before the
-- backfill completed continues to enrol.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_enrollment_slot(p_token text)
RETURNS TABLE(
    organization_id uuid,
    runtime_hint    text,
    channel         text,
    hostname_hint   text,
    use_count       integer,
    max_uses        integer,
    expires_at      timestamptz,
    used_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now  timestamptz := now();
    v_hash text        := encode(sha256(p_token::bytea), 'hex');
BEGIN
    RETURN QUERY
    UPDATE public.enrollment_tokens et
       SET use_count = et.use_count + 1,
           used_at   = CASE WHEN et.use_count + 1 >= et.max_uses THEN v_now ELSE et.used_at END
     WHERE (et.token_hash = v_hash OR et.token = p_token)
       AND et.expires_at > v_now
       AND et.use_count < et.max_uses
    RETURNING
        et.organization_id,
        et.runtime_hint,
        et.channel,
        et.hostname_hint,
        et.use_count,
        et.max_uses,
        et.expires_at,
        et.used_at;
END
$$;

REVOKE ALL ON FUNCTION public.reserve_enrollment_slot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_enrollment_slot(text) TO service_role;

-- ---------------------------------------------------------------------
-- create_enrollment_token: also write the hash. The plaintext `token`
-- remains in this RPC's output so the existing console install paths
-- (the React hooks that paste a one-liner with the raw token) still
-- work. This path's tokens carry both columns; tokens minted via the
-- public REST API carry only `token_hash`.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_enrollment_token(
    p_org_id        uuid,
    p_runtime_hint  text DEFAULT 'powershell',
    p_channel       text DEFAULT 'stable',
    p_hostname_hint text DEFAULT NULL,
    p_max_uses      integer DEFAULT 1
)
RETURNS TABLE(token text, expires_at timestamptz, max_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_token  text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_admin_of_org(v_caller, p_org_id) OR public.is_super_admin(v_caller)) THEN
        RAISE EXCEPTION 'forbidden_not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_runtime_hint NOT IN ('powershell','dotnet') THEN
        RAISE EXCEPTION 'invalid_runtime_hint' USING ERRCODE = '22023';
    END IF;
    IF p_channel NOT IN ('stable','beta','canary') THEN
        RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '22023';
    END IF;

    v_token := 'ent_' || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO public.enrollment_tokens (
        token, token_hash, organization_id, created_by,
        runtime_hint, channel, hostname_hint, max_uses
    ) VALUES (
        v_token,
        encode(sha256(v_token::bytea), 'hex'),
        p_org_id, v_caller,
        p_runtime_hint, p_channel, p_hostname_hint, p_max_uses
    );

    RETURN QUERY
        SELECT v_token,
               (now() + interval '7 days')::timestamptz,
               p_max_uses;
END
$$;

REVOKE ALL ON FUNCTION public.create_enrollment_token(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_enrollment_token(uuid, text, text, text, integer) TO authenticated;

-- ---------------------------------------------------------------------
-- API-issued tokens: a dedicated SECURITY DEFINER helper so the api-v1
-- edge function can persist only the hash. Returns nothing useful to
-- the caller — the raw token was generated client-side and returned to
-- the user directly; only the hash lands here.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_issue_enrollment_token(
    p_organization_id uuid,
    p_created_by      uuid,
    p_token_hash      text,
    p_runtime_hint    text,
    p_channel         text,
    p_expires_at      timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF char_length(p_token_hash) <> 64 THEN
        RAISE EXCEPTION 'invalid_hash_length' USING ERRCODE = '22023';
    END IF;
    IF p_runtime_hint NOT IN ('powershell','linux') THEN
        RAISE EXCEPTION 'invalid_runtime_hint' USING ERRCODE = '22023';
    END IF;
    IF p_channel NOT IN ('stable','beta','canary') THEN
        RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '22023';
    END IF;
    IF p_expires_at < now() THEN
        RAISE EXCEPTION 'expires_at_in_past' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.enrollment_tokens (
        token, token_hash, organization_id, created_by,
        runtime_hint, channel, expires_at, max_uses
    ) VALUES (
        '__hashed__:' || replace(gen_random_uuid()::text, '-', ''),
        p_token_hash,
        p_organization_id,
        p_created_by,
        p_runtime_hint,
        p_channel,
        p_expires_at,
        1
    );
END
$$;

REVOKE ALL ON FUNCTION public.api_issue_enrollment_token(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_issue_enrollment_token(uuid, uuid, text, text, text, timestamptz) TO service_role;
