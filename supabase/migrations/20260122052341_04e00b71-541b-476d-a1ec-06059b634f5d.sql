-- Remove overly permissive policy and rely on security definer function for validation
DROP POLICY IF EXISTS "Anyone can validate enrollment codes" ON public.enrollment_codes;