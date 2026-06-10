-- 20260606030000_sales_leads.sql
--
-- Captures prospects who hit /contact-sales without an enrolment code.
-- Replaces the existing mailto:hello@peritusdigital.com.au pattern with
-- a structured lead pipeline Shane can work from /admin/leads later.
--
-- Anonymous INSERT is allowed (the form is public). RLS prevents read
-- access — super-admins SELECT via service-role or the future admin UI.

CREATE TABLE IF NOT EXISTS public.sales_leads (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    company_name        text NOT NULL,
    contact_name        text NOT NULL,
    contact_email       text NOT NULL,
    contact_phone       text,
    role_intent         text NOT NULL
        CHECK (role_intent IN ('customer','reseller','distributor','unknown')),
    endpoint_estimate   text,
    region              text,
    message             text,
    source_url          text,
    user_agent          text,
    status              text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','contacted','qualified','converted','closed_lost')),
    assigned_to         uuid REFERENCES auth.users(id),
    notes               text
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_status_created ON public.sales_leads(status, created_at DESC);

ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;

-- Allow anonymous + authenticated INSERT — the form is public.
DROP POLICY IF EXISTS "Anyone can submit a sales lead" ON public.sales_leads;
CREATE POLICY "Anyone can submit a sales lead"
    ON public.sales_leads FOR INSERT
    TO public
    WITH CHECK (true);

-- Only super-admins can read or update.
DROP POLICY IF EXISTS "Super admins manage sales leads" ON public.sales_leads;
CREATE POLICY "Super admins manage sales leads"
    ON public.sales_leads FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

COMMENT ON TABLE public.sales_leads IS
'Inbound prospects from /contact-sales. Public INSERT (RLS allows anonymous submit); read/update restricted to super-admins.';
