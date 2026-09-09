-- Expand allowed values for endpoint_threats.status to support manual resolution
ALTER TABLE public.endpoint_threats
  DROP CONSTRAINT IF EXISTS endpoint_threats_status_check;

ALTER TABLE public.endpoint_threats
  ADD CONSTRAINT endpoint_threats_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'Active'::text,
        'Removed'::text,
        'Quarantined'::text,
        'Allowed'::text,
        'Blocked'::text,
        'Cleaning'::text,
        'Resolved'::text
      ]
    )
  );