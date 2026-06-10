-- Three public views lack `security_invoker = true`, which means they execute
-- as the view owner (postgres) and therefore bypass every RLS policy on the
-- underlying tables. Any authenticated user querying them via PostgREST gets
-- cross-tenant rows.
--
-- Worst offender: `endpoints_live` exposes `agent_secret` and `agent_token`
-- on every endpoint in the platform. A customer org admin could SELECT that
-- view and impersonate any other agent.
--
-- Quick fix: flip security_invoker on. Each consumer must already be carrying
-- an authenticated JWT that owns the rows it's allowed to see — the
-- underlying tables (`organizations`, `endpoints`, `platform_pricing_defaults`)
-- already have correct RLS policies.

ALTER VIEW IF EXISTS public.endpoints_live              SET (security_invoker = true);
ALTER VIEW IF EXISTS public.distributor_reseller_credits SET (security_invoker = true);
ALTER VIEW IF EXISTS public.organization_pricing        SET (security_invoker = true);
