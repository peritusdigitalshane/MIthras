-- Seed the three analytics rows in platform_settings.
--
-- These are read by the no-auth public-config edge function (only the
-- safe subset; never service keys or API tokens) and consumed by the
-- marketing surfaces to inject Google Tag Manager.
--
-- All three default to empty / off so the platform ships with no
-- tracking until a super-admin explicitly opts in via Settings →
-- Analytics.

INSERT INTO public.platform_settings (key, value, description, is_secret)
VALUES
  ('analytics_gtm_id',           '',      'Google Tag Manager container ID (GTM-XXXXXXX). Empty = no tracking.', false),
  ('analytics_track_logged_in',  'false', 'Whether to fire pageviews when a user is authenticated. Default off so the operator console stays out of GA.', false),
  ('analytics_consent_mode',     'false', 'Push Google Consent Mode v2 default=denied flags on load. Required for EU traffic if you don''t run a consent banner.', false)
ON CONFLICT (key) DO NOTHING;
