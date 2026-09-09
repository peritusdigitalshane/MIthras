-- Create platform settings table for super admin configurable settings
CREATE TABLE public.platform_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  description TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Only super admins can view and manage platform settings
CREATE POLICY "Super admins can view platform settings"
ON public.platform_settings
FOR SELECT
USING (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can insert platform settings"
ON public.platform_settings
FOR INSERT
WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update platform settings"
ON public.platform_settings
FOR UPDATE
USING (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete platform settings"
ON public.platform_settings
FOR DELETE
USING (is_super_admin(auth.uid()));

-- Add trigger for updated_at
CREATE TRIGGER update_platform_settings_updated_at
BEFORE UPDATE ON public.platform_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default OpenAI API key setting (empty by default)
INSERT INTO public.platform_settings (key, value, description, is_secret)
VALUES ('openai_api_key', '', 'OpenAI API key for AI Security Advisor', true);