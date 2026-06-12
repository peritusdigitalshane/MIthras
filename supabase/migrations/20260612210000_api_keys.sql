-- =====================================================================
-- Customer-facing API keys
--
-- Lets any signed-in admin of a customer, reseller, or distributor org
-- issue a long-lived bearer token used to call the public REST API
-- (functions/v1/api-v1). Tokens are stored as SHA-256 hashes; the raw
-- token is shown to the operator exactly once at creation time.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by         uuid NOT NULL REFERENCES auth.users(id),
    name               text NOT NULL,
    key_prefix         text NOT NULL,          -- first 12 chars, displayable
    key_hash           text NOT NULL UNIQUE,   -- sha256 hex of full token
    scopes             text[] NOT NULL DEFAULT ARRAY['read']::text[],
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz,            -- NULL = no expiry
    last_used_at       timestamptz,
    last_used_ip       inet,
    revoked_at         timestamptz,
    revoked_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT api_keys_name_len  CHECK (char_length(name) BETWEEN 3 AND 80),
    CONSTRAINT api_keys_scope_chk CHECK (cardinality(scopes) > 0)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org    ON public.api_keys(organization_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON public.api_keys(key_hash)        WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON public.api_keys(organization_id, revoked_at, expires_at);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_keys_org_admin_read" ON public.api_keys
    FOR SELECT USING (
        public.is_admin_of_org(auth.uid(), organization_id)
        OR public.is_super_admin(auth.uid())
    );

CREATE POLICY "api_keys_service_write" ON public.api_keys
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- =====================================================================
-- RPCs — issue / list / revoke
-- =====================================================================

-- One-shot helper: caller produces token client-side, hashes it, supplies
-- prefix + hash to this RPC. The server never sees the plaintext.
CREATE OR REPLACE FUNCTION public.create_api_key(
    p_organization_id uuid,
    p_name            text,
    p_key_prefix      text,
    p_key_hash        text,
    p_scopes          text[]      DEFAULT ARRAY['read']::text[],
    p_expires_at      timestamptz DEFAULT NULL
)
RETURNS public.api_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_row    public.api_keys;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000';
    END IF;
    IF NOT (public.is_admin_of_org(v_caller, p_organization_id) OR public.is_super_admin(v_caller)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF char_length(p_key_prefix) NOT BETWEEN 8 AND 24 THEN
        RAISE EXCEPTION 'invalid_prefix' USING ERRCODE = '22023';
    END IF;
    IF char_length(p_key_hash) <> 64 THEN
        RAISE EXCEPTION 'invalid_hash_length' USING ERRCODE = '22023';
    END IF;
    IF cardinality(p_scopes) = 0 THEN
        RAISE EXCEPTION 'no_scopes' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.api_keys (
        organization_id, created_by, name, key_prefix, key_hash, scopes, expires_at
    ) VALUES (
        p_organization_id, v_caller, p_name, p_key_prefix, p_key_hash, p_scopes, p_expires_at
    )
    RETURNING * INTO v_row;
    RETURN v_row;
END
$$;
REVOKE ALL ON FUNCTION public.create_api_key(uuid, text, text, text, text[], timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.create_api_key(uuid, text, text, text, text[], timestamptz) TO authenticated;

-- Revoke an API key (soft delete via revoked_at).
CREATE OR REPLACE FUNCTION public.revoke_api_key(p_key_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_org    uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000';
    END IF;
    SELECT organization_id INTO v_org FROM public.api_keys WHERE id = p_key_id;
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.is_admin_of_org(v_caller, v_org) OR public.is_super_admin(v_caller)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    UPDATE public.api_keys
       SET revoked_at = now(), revoked_by = v_caller
     WHERE id = p_key_id AND revoked_at IS NULL;
    RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION public.revoke_api_key(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(uuid) TO authenticated;

-- =====================================================================
-- Service-role-only helpers used by the api-v1 edge function
-- =====================================================================

CREATE OR REPLACE FUNCTION public.api_key_resolve(p_key_hash text)
RETURNS TABLE (
    api_key_id      uuid,
    organization_id uuid,
    scopes          text[],
    organization_type text,
    expired         boolean,
    revoked         boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT k.id,
           k.organization_id,
           k.scopes,
           o.organization_type,
           (k.expires_at IS NOT NULL AND k.expires_at < now()) AS expired,
           (k.revoked_at IS NOT NULL) AS revoked
      FROM public.api_keys k
      JOIN public.organizations o ON o.id = k.organization_id
     WHERE k.key_hash = p_key_hash
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.api_key_resolve(text) FROM public;
GRANT EXECUTE ON FUNCTION public.api_key_resolve(text) TO service_role;

CREATE OR REPLACE FUNCTION public.api_key_touch(p_api_key_id uuid, p_ip text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE public.api_keys
       SET last_used_at = now(),
           last_used_ip = CASE WHEN p_ip IS NULL THEN last_used_ip ELSE p_ip::inet END
     WHERE id = p_api_key_id;
$$;
REVOKE ALL ON FUNCTION public.api_key_touch(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.api_key_touch(uuid, text) TO service_role;

-- =====================================================================
-- Helper RPC used by the partner-onboarding API path. The reseller's
-- direct INSERT pattern already works through RLS for human users, but
-- the API edge function calls the DB with the service-role JWT so we
-- need a SECURITY DEFINER wrapper that re-asserts authorisation.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.api_create_customer(
    p_parent_org_id uuid,
    p_name          text,
    p_wholesale_price_cents int DEFAULT NULL,
    p_acting_org_id uuid DEFAULT NULL    -- the org the API key belongs to
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_slug   text;
    v_row    public.organizations;
    v_acting uuid := COALESCE(p_acting_org_id, p_parent_org_id);
BEGIN
    -- The acting org must be the parent (resellers create their own customers)
    -- or a distributor that owns the parent reseller.
    IF v_acting <> p_parent_org_id THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.organizations
             WHERE id = p_parent_org_id
               AND parent_partner_id = v_acting
        ) THEN
            RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF char_length(trim(p_name)) < 2 THEN
        RAISE EXCEPTION 'name_too_short' USING ERRCODE = '22023';
    END IF;

    v_slug := lower(regexp_replace(trim(p_name), '[^a-z0-9]+', '-', 'gi'));
    v_slug := regexp_replace(v_slug, '(^-+)|(-+$)', '', 'g');
    v_slug := substring(v_slug, 1, 60);

    INSERT INTO public.organizations (name, slug, organization_type, parent_partner_id, wholesale_price_cents)
    VALUES (trim(p_name), v_slug, 'customer', p_parent_org_id, p_wholesale_price_cents)
    RETURNING * INTO v_row;

    INSERT INTO public.activity_logs (organization_id, user_id, action, resource_type, resource_id, details)
    VALUES (v_acting, NULL, 'create', 'customer', v_row.id::text,
            jsonb_build_object('via', 'api', 'name', trim(p_name)));

    RETURN v_row;
END
$$;
REVOKE ALL ON FUNCTION public.api_create_customer(uuid, text, int, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.api_create_customer(uuid, text, int, uuid) TO service_role;
