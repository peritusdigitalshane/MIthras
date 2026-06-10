-- Self-signup bootstrap.
--
-- When a new user signs up via /signup, GoTrue creates a row in auth.users
-- with the raw_user_meta_data we passed from the React form. Previously
-- nothing handled that — the user got an account but no profile, no org,
-- and a blank dashboard. This migration adds an AFTER INSERT trigger that:
--
--   1. Creates a profile.
--   2. If raw_user_meta_data->>'enrollment_code' is set:
--        Looks up the enrollment_token, consumes a slot, joins the user to
--        the existing org with role='member'. The MSP operator pre-mints
--        the code in /admin and shares it with the new user.
--   3. If raw_user_meta_data->>'free_trial' is 'true':
--        Creates a fresh org (named after display_name), makes the user owner,
--        and the existing create_default_policies trigger auto-creates a
--        baseline Defender policy + UAC + WU.
--
-- The trigger runs as SECURITY DEFINER (owner postgres) so it can insert
-- across schemas that the unauthenticated GoTrue context can't reach.

-- Helper: build a URL-safe slug from a display name. Falls back to a
-- random 12-char id if the input is empty or all-non-alphanumeric.
CREATE OR REPLACE FUNCTION public.gen_org_slug(p_seed text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_base text;
BEGIN
    v_base := lower(regexp_replace(COALESCE(p_seed, ''), '[^a-zA-Z0-9]+', '-', 'g'));
    v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
    IF v_base IS NULL OR v_base = '' THEN
        v_base := 'org';
    END IF;
    -- Always suffix with 6 random chars so collisions are vanishingly rare.
    RETURN substring(v_base FROM 1 FOR 40) || '-' || substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6);
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_display_name   text;
    v_enrollment     text;
    v_free_trial     boolean;
    v_token_row      public.enrollment_tokens%ROWTYPE;
    v_org_id         uuid;
    v_org_name       text;
    v_org_slug       text;
BEGIN
    v_display_name := NULLIF(BTRIM(NEW.raw_user_meta_data->>'display_name'), '');
    v_enrollment   := NULLIF(BTRIM(NEW.raw_user_meta_data->>'enrollment_code'), '');
    v_free_trial   := COALESCE((NEW.raw_user_meta_data->>'free_trial')::boolean, FALSE);

    -- Always create a profile so RLS helpers that join through it don't break.
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email, COALESCE(v_display_name, split_part(NEW.email, '@', 1)))
    ON CONFLICT (id) DO NOTHING;

    -- Path 1: enrollment-code signup — join the existing org named by the code.
    IF v_enrollment IS NOT NULL THEN
        SELECT * INTO v_token_row
        FROM public.enrollment_tokens
        WHERE upper(code) = upper(v_enrollment)
          AND is_active
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_uses IS NULL OR uses_count < max_uses)
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
            INSERT INTO public.organization_memberships (organization_id, user_id, role)
            VALUES (v_token_row.organization_id, NEW.id, 'member')
            ON CONFLICT (organization_id, user_id) DO NOTHING;

            UPDATE public.enrollment_tokens
               SET uses_count = uses_count + 1
             WHERE id = v_token_row.id;

            RETURN NEW;
        END IF;
        -- If the code was invalid we fall through to free-trial behaviour rather
        -- than leaving the user orphaned. Operators see the orphaned-then-
        -- promoted org in the activity log.
    END IF;

    -- Path 2: free-trial signup — provision a personal org with the user
    -- as the owner. The create_default_policies trigger handles baseline
    -- Defender / UAC / WU policy seeding automatically.
    IF v_free_trial OR v_enrollment IS NULL THEN
        v_org_name := COALESCE(v_display_name, split_part(NEW.email, '@', 1)) || ' Trial';
        v_org_slug := public.gen_org_slug(v_org_name);

        INSERT INTO public.organizations (name, slug)
        VALUES (v_org_name, v_org_slug)
        RETURNING id INTO v_org_id;

        INSERT INTO public.organization_memberships (organization_id, user_id, role)
        VALUES (v_org_id, NEW.id, 'owner');
    END IF;

    RETURN NEW;
END $$;

-- Drop any prior trigger; recreate fresh. on_auth_user_created is the canonical name.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Permissions: the trigger runs as postgres (SECURITY DEFINER) so the
-- function itself needs no public grants. Calling it directly from clients
-- is not supported.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gen_org_slug(text) FROM PUBLIC;
