-- Add openai_model platform setting
INSERT INTO public.platform_settings (key, value, description, is_secret)
VALUES ('openai_model', NULL, 'The OpenAI model to use for AI Security Advisor', false)
ON CONFLICT (key) DO NOTHING;