-- 20260515120000_wdac_policy_templates.sql
-- Peritus-curated policy templates. Seeded with 3 starter templates.
-- rules column is a jsonb array of wdac_rule_set_rules-shaped objects
-- (without id/created_at/created_by/rule_set_id — those are added on instantiation).

CREATE TABLE IF NOT EXISTS public.wdac_policy_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  rules       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_system   bool        NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wdac_policy_templates ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read templates.
CREATE POLICY "Authenticated users read templates"
  ON public.wdac_policy_templates FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only super_admins can write templates.
CREATE POLICY "Super admins manage templates"
  ON public.wdac_policy_templates FOR ALL
  USING (public.is_super_admin(auth.uid()));

-- Seed: 3 system templates.
INSERT INTO public.wdac_policy_templates (name, description, rules, is_system) VALUES
(
  'Office Worker',
  'Standard allow-list for an office workstation: Windows, Microsoft Office, Teams, Edge, Chrome, Firefox, Adobe Reader.',
  '[
    {"action":"allow","rule_type":"path","value":"C:\\\\Windows\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Windows OS"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft Office"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office 16\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Office 2016/365"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps (Teams, OneDrive, Edge)"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files (x86)\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps (x86)"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Common Files\\\\Microsoft Shared\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft shared components"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Google\\\\Chrome\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Google Chrome"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Mozilla Firefox\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Mozilla Firefox"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Adobe\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Adobe"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files (x86)\\\\Adobe\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Adobe (x86)"}
  ]'::jsonb,
  true
),
(
  'Dev Workstation',
  'Office Worker baseline plus common developer tools: VS Code, Git, Node.js, Docker, Python.',
  '[
    {"action":"allow","rule_type":"path","value":"C:\\\\Windows\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Windows OS"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files (x86)\\\\Microsoft\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft apps (x86)"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft Office"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft Office 16\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Office 2016/365"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Google\\\\Chrome\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Google Chrome"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Mozilla Firefox\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Mozilla Firefox"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft VS Code\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"VS Code"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Git\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Git"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\nodejs\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Node.js"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Docker\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Docker Desktop"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Python*\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Python"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Users\\\\*\\\\AppData\\\\Local\\\\Programs\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"User-installed developer tools"}
  ]'::jsonb,
  true
),
(
  'Reception / Kiosk',
  'Restrictive allow-list for a kiosk or reception terminal: Windows OS and one browser only.',
  '[
    {"action":"allow","rule_type":"path","value":"C:\\\\Windows\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Windows OS"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Google\\\\Chrome\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Google Chrome"},
    {"action":"allow","rule_type":"path","value":"C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\*","publisher_name":null,"product_name":null,"file_version_min":null,"description":"Microsoft Edge"}
  ]'::jsonb,
  true
)
ON CONFLICT DO NOTHING;
