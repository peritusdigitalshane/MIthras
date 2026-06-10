-- 20260530003000_partner_branding.sql
--
-- B7 fix: white-label / reseller branding for MSP partners.
--
-- Data model:
--   partner_branding (organization_id PK, brand_name, primary_colour,
--                     support_email, footer_text, logo_path)
--
-- One row per partner org. Customer orgs walking up via parent_partner_id
-- pick up their partner's branding everywhere the platform renders
-- customer-facing surfaces (customer reports, sidebar, login when accessed
-- under a partner-subdomain in the future).
--
-- `logo_path` is a path inside the partner-logos storage bucket — the bucket
-- is public-read so the URL works inside emailed reports without signed-URL
-- gymnastics.

BEGIN;

CREATE TABLE IF NOT EXISTS public.partner_branding (
    organization_id  uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    brand_name       text          NOT NULL,
    tagline          text,
    primary_colour   text          NOT NULL DEFAULT '#00C4AB' CHECK (primary_colour ~ '^#[0-9A-Fa-f]{6}$'),
    accent_colour    text          NOT NULL DEFAULT '#0F172A' CHECK (accent_colour ~ '^#[0-9A-Fa-f]{6}$'),
    support_email    text,
    support_url      text,
    footer_text      text,
    logo_path        text,                 -- relative path inside partner-logos bucket
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_branding_org ON public.partner_branding(organization_id);

DROP TRIGGER IF EXISTS update_partner_branding_updated_at ON public.partner_branding;
CREATE TRIGGER update_partner_branding_updated_at
    BEFORE UPDATE ON public.partner_branding
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.partner_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_branding_read_all" ON public.partner_branding;
CREATE POLICY "partner_branding_read_all"
    ON public.partner_branding FOR SELECT
    USING (true);   -- branding is presented publicly inside customer-facing reports

DROP POLICY IF EXISTS "partner_branding_write_admin" ON public.partner_branding;
CREATE POLICY "partner_branding_write_admin"
    ON public.partner_branding FOR ALL
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    )
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- Storage bucket for partner logos. Public-read so report HTML can hot-link
-- the logo without minting signed URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('partner-logos', 'partner-logos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "partner_logos_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "partner_logos_admin_write"  ON storage.objects;
DROP POLICY IF EXISTS "partner_logos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "partner_logos_admin_delete" ON storage.objects;

CREATE POLICY "partner_logos_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'partner-logos');

CREATE POLICY "partner_logos_admin_write"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'partner-logos'
        AND (
            public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), (split_part(name, '/', 1))::uuid)
        )
    );

CREATE POLICY "partner_logos_admin_update"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'partner-logos'
        AND (
            public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), (split_part(name, '/', 1))::uuid)
        )
    );

CREATE POLICY "partner_logos_admin_delete"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'partner-logos'
        AND (
            public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), (split_part(name, '/', 1))::uuid)
        )
    );

-- Helper: return the branding that should apply for a given org. If the org is
-- a partner, returns its own branding. If it's a partner-child customer, walks
-- up to the parent partner's branding. Returns NULL if neither has branding —
-- callers should fall back to the Mithras default.
CREATE OR REPLACE FUNCTION public.get_branding_for_org(_org_id uuid)
RETURNS public.partner_branding
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_parent uuid;
    v_row    public.partner_branding;
BEGIN
    IF _org_id IS NULL THEN RETURN NULL; END IF;

    -- Try direct branding (org IS the partner).
    SELECT * INTO v_row FROM public.partner_branding WHERE organization_id = _org_id;
    IF FOUND THEN RETURN v_row; END IF;

    -- Walk up to parent partner.
    SELECT parent_partner_id INTO v_parent FROM public.organizations WHERE id = _org_id;
    IF v_parent IS NULL THEN RETURN NULL; END IF;

    SELECT * INTO v_row FROM public.partner_branding WHERE organization_id = v_parent;
    IF FOUND THEN RETURN v_row; END IF;

    RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.get_branding_for_org(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_branding_for_org(uuid) TO anon, authenticated, service_role;

COMMIT;
