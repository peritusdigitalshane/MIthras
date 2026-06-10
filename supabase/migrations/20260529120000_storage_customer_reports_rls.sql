-- Customer reports storage bucket RLS.
--
-- Bucket layout: customer-reports/{org_id}/{kind}-{period_start}.html
--
-- Without these policies, regular org members cannot generate signed URLs to
-- view their own reports — only service_role can — and the UI download button
-- in CustomerReports.tsx silently fails on a 403.

DO $$ BEGIN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('customer-reports', 'customer-reports', false)
    ON CONFLICT (id) DO NOTHING;
END $$;

-- SELECT — org member can read any object whose top-level folder is the org id.
DROP POLICY IF EXISTS "customer_reports_select_org_member" ON storage.objects;
CREATE POLICY "customer_reports_select_org_member" ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'customer-reports'
    AND (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(
            auth.uid(),
            ((storage.foldername(name))[1])::uuid
        )
    )
);

-- INSERT / UPDATE — service_role only (the generate-customer-report function
-- writes via the service role key; humans never upload here directly).
DROP POLICY IF EXISTS "customer_reports_write_service" ON storage.objects;
CREATE POLICY "customer_reports_write_service" ON storage.objects FOR INSERT
TO service_role WITH CHECK (bucket_id = 'customer-reports');

DROP POLICY IF EXISTS "customer_reports_update_service" ON storage.objects;
CREATE POLICY "customer_reports_update_service" ON storage.objects FOR UPDATE
TO service_role USING (bucket_id = 'customer-reports') WITH CHECK (bucket_id = 'customer-reports');

DROP POLICY IF EXISTS "customer_reports_delete_service" ON storage.objects;
CREATE POLICY "customer_reports_delete_service" ON storage.objects FOR DELETE
TO service_role USING (bucket_id = 'customer-reports');
