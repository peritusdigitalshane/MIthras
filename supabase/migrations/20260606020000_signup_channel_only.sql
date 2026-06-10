-- 20260606020000_signup_channel_only.sql
--
-- Rewrites handle_new_user() to enforce the channel-only sales model:
--
--   - Every signup MUST present a valid, active enrolment code.
--   - Invalid/expired/exhausted codes raise a hard exception. The previous
--     behaviour was to fall through and silently provision a free trial
--     org with the user as owner — a sales-funnel-bypass bug.
--   - The free_trial=true metadata flag is now ignored. Super-admins still
--     grant free licences via per-org pricing overrides (wholesale_price_cents=0
--     in /admin/pricing) — that's a deliberate, audited, post-creation action.
--
-- Existing free-trial orgs created before this migration are unaffected.
-- They keep working until manually retired.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
    v_display_name   text;
    v_enrollment     text;
    v_token_row      public.enrollment_tokens%ROWTYPE;
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

    -- Look up the code. Hard-fail on miss — no silent free-trial fallback.
    SELECT * INTO v_token_row
    FROM public.enrollment_tokens
    WHERE upper(code) = upper(v_enrollment)
      AND is_active
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses IS NULL OR uses_count < max_uses)
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
       SET uses_count = uses_count + 1
     WHERE id = v_token_row.id;

    RETURN NEW;
END $$;

COMMENT ON FUNCTION public.handle_new_user() IS
'Provisions a profile + joins the new user to the org named by their enrolment code. Hard-fails if the code is missing or invalid — channel-only sales model. The previous free-trial fallback was a funnel bypass and has been removed.';
