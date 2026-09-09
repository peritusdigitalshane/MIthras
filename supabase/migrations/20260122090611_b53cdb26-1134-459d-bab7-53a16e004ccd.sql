-- Add manual resolution tracking to endpoint_threats
ALTER TABLE public.endpoint_threats
  ADD COLUMN IF NOT EXISTS manual_resolution_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_resolved_at timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS manual_resolved_by uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'endpoint_threats'
      AND policyname = 'Admins can update threats for org endpoints'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Admins can update threats for org endpoints"
      ON public.endpoint_threats
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1
          FROM public.endpoints e
          WHERE e.id = endpoint_threats.endpoint_id
            AND is_admin_of_org(auth.uid(), e.organization_id)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.endpoints e
          WHERE e.id = endpoint_threats.endpoint_id
            AND is_admin_of_org(auth.uid(), e.organization_id)
        )
      );
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'endpoint_threats'
      AND policyname = 'Super admins can update all endpoint threats'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Super admins can update all endpoint threats"
      ON public.endpoint_threats
      FOR UPDATE
      USING (is_super_admin(auth.uid()))
      WITH CHECK (is_super_admin(auth.uid()));
    $pol$;
  END IF;
END $$;