-- Per-org "where the monthly report gets emailed" list. Distinct from MSP
-- operator users — these are the customer's contacts (owner, IT manager,
-- compliance lead) who receive the monthly PDF.
--
-- Also: track the PDF storage path on customer_reports so the existing HTML
-- workflow keeps working unchanged.

CREATE TABLE IF NOT EXISTS public.org_report_recipients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email           text NOT NULL,
    name            text,
    role_label      text,           -- "Owner", "IT manager", "Compliance lead", free-text
    monthly         boolean NOT NULL DEFAULT true,
    weekly          boolean NOT NULL DEFAULT false,
    quarterly       boolean NOT NULL DEFAULT false,
    created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_report_recipients_org
    ON public.org_report_recipients(organization_id);

CREATE OR REPLACE FUNCTION public.touch_org_report_recipients_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_org_report_recipients_touch ON public.org_report_recipients;
CREATE TRIGGER trg_org_report_recipients_touch BEFORE UPDATE ON public.org_report_recipients
FOR EACH ROW EXECUTE FUNCTION public.touch_org_report_recipients_updated_at();

ALTER TABLE public.org_report_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_report_recipients_select" ON public.org_report_recipients;
CREATE POLICY "org_report_recipients_select" ON public.org_report_recipients
    FOR SELECT TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

-- Only org admins (or super-admin) can add/change/remove recipients —
-- it's the MSP operator's responsibility to keep this list accurate, not
-- a regular member's.
DROP POLICY IF EXISTS "org_report_recipients_insert" ON public.org_report_recipients;
CREATE POLICY "org_report_recipients_insert" ON public.org_report_recipients
    FOR INSERT TO authenticated
    WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "org_report_recipients_update" ON public.org_report_recipients;
CREATE POLICY "org_report_recipients_update" ON public.org_report_recipients
    FOR UPDATE TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "org_report_recipients_delete" ON public.org_report_recipients;
CREATE POLICY "org_report_recipients_delete" ON public.org_report_recipients
    FOR DELETE TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

-- ---------------------------------------------------------------------------
-- customer_reports: track the PDF artefact alongside the HTML one. Existing
-- storage_path keeps pointing at the HTML so old links don't break.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_reports
    ADD COLUMN IF NOT EXISTS pdf_storage_path text,
    ADD COLUMN IF NOT EXISTS last_send_error  text;
