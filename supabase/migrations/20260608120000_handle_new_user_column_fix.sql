-- handle_new_user() trigger references non-existent columns on
-- enrollment_tokens. The migration that introduced channel-only signup
-- (20260606020000_signup_channel_only.sql) used `code` and `uses_count`,
-- but the actual `enrollment_tokens` schema has `token` (the PK) and
-- `use_count`. Every new-user INSERT into auth.users since that migration
-- has been raising "column code does not exist" at trigger time, killing
-- the signup before the auth row is committed.
--
-- Replace the function body with the correct column names.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_display_name text;
    v_enrollment   text;
    v_token_row    public.enrollment_tokens%ROWTYPE;
BEGIN
    v_display_name := NULLIF(BTRIM(NEW.raw_user_meta_data->>'display_name'), '');
    v_enrollment   := NULLIF(BTRIM(NEW.raw_user_meta_data->>'enrollment_code'), '');

    -- Always create a profile so downstream RLS helpers don't break.
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email, COALESCE(v_display_name, split_part(NEW.email, '@', 1)))
    ON CONFLICT (id) DO NOTHING;

    -- Channel-only: enrolment code is mandatory.
    IF v_enrollment IS NULL THEN
        RAISE EXCEPTION 'enrolment_code_required'
            USING DETAIL = 'Mithras is sold through authorised channel partners. Every signup requires a valid enrolment code.',
                  HINT   = 'Contact your reseller for a code, or visit /contact-sales to be put in touch with one.';
    END IF;

    -- Look up the code. Schema uses `token` (PK) and `use_count`, NOT the
    -- `code`/`uses_count` that the previous version of this function used.
    SELECT * INTO v_token_row
    FROM public.enrollment_tokens
    WHERE upper(token) = upper(v_enrollment)
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses   IS NULL OR use_count < max_uses)
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'enrolment_code_invalid'
            USING DETAIL = 'The enrolment code is unknown, expired, or has reached its use limit.',
                  HINT   = 'Contact the person who issued the code for a fresh one.';
    END IF;

    -- Valid code → join the org as a member.
    INSERT INTO public.organization_memberships (organization_id, user_id, role)
    VALUES (v_token_row.organization_id, NEW.id, 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    UPDATE public.enrollment_tokens
       SET use_count = use_count + 1,
           used_at   = COALESCE(used_at, now())
     WHERE token = v_token_row.token;

    RETURN NEW;
END $function$;
