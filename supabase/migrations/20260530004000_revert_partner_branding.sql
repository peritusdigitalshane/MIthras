-- 20260530004000_revert_partner_branding.sql
--
-- Reverts 20260530003000_partner_branding. Decision: Mithras is the only
-- brand. Partners get access to manage and onboard their customers, but they
-- do not white-label the product. Drop the table, RPC, storage bucket, and
-- the test rows seeded during the B7 smoke test.

BEGIN;

-- Test rows from the B7 smoke run.
DELETE FROM public.organizations WHERE slug IN ('acme-customer-a','acme-smoketest');

-- Drop the storage bucket's RLS policies first.
DROP POLICY IF EXISTS "partner_logos_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "partner_logos_admin_write"  ON storage.objects;
DROP POLICY IF EXISTS "partner_logos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "partner_logos_admin_delete" ON storage.objects;

-- Empty + delete the bucket. Best-effort: ignore missing.
DO $$ BEGIN
    PERFORM storage.delete_object('partner-logos', name) FROM storage.objects WHERE bucket_id = 'partner-logos';
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DELETE FROM storage.objects WHERE bucket_id = 'partner-logos';
DELETE FROM storage.buckets WHERE id = 'partner-logos';

DROP FUNCTION IF EXISTS public.get_branding_for_org(uuid);
DROP TABLE    IF EXISTS public.partner_branding;

COMMIT;
