-- Wave: grant lockdown after the 2026-08-12 platform review.
--
-- Three defects, one root cause.
--
-- ROOT CAUSE: ALTER DEFAULT PRIVILEGES on schema public granted arwdDxt (ALL)
-- to anon + authenticated AND r (SELECT) to grafana_reader on EVERY new table.
-- Consequences found in production:
--
--   1. grafana_reader (which has BYPASSRLS *and* LOGIN) could SELECT
--      public.platform_settings, returning live secrets in plaintext:
--      stripe_secret_key (sk_live_...), service_role_key, smtp_password,
--      openai_api_key. Grafana's Postgres datasource allows raw-SQL panels,
--      so Grafana editor access escalated to payment keys + an RLS-bypassing
--      database key.
--
--   2. All 21 table partitions of the log tables carried full
--      INSERT/UPDATE/DELETE/TRUNCATE grants for anon + authenticated with RLS
--      OFF and zero policies. Not reachable through PostgREST today (it
--      excludes partitions from its schema cache, PGRST205) but a latent
--      landmine for any direct-connection path.
--
--   3. anon + authenticated held TRUNCATE on the partition PARENTS.
--      TRUNCATE is not subject to RLS, so no policy would have stopped it.
--
-- Deliberately NOT changed here:
--   * Secrets remain plaintext in platform_settings. Encrypting them requires
--     reworking every consumer (edge functions read these by key) and is not
--     safe to do blind. Tracked separately.
--   * anon/authenticated keep INSERT/SELECT/UPDATE/DELETE on the log parents,
--     matching the Supabase norm where RLS is the control. Only the privileges
--     no client legitimately needs (TRUNCATE/REFERENCES/TRIGGER) are removed.
--   * cve_lookup_cache is left exactly as-is. An earlier draft of the review
--     called its 0-policy state "likely broken"; that was wrong. Only
--     service_role holds grants and service_role has BYPASSRLS, so it works.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Stop the bleeding at the source: fix the DEFAULT privileges.
-- ---------------------------------------------------------------------------

-- grafana_reader must never again receive automatic SELECT on new tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM grafana_reader;

-- No API client role needs TRUNCATE/REFERENCES/TRIGGER. RLS does not gate
-- TRUNCATE, so leaving it granted is a data-destruction primitive.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The critical one: revoke Grafana's access to the secret store.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.platform_settings FROM grafana_reader;

-- platform_settings is super-admin-only by RLS; anon/authenticated should not
-- hold table grants on it either (defence in depth behind the RLS policies).
REVOKE ALL ON public.platform_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Revoke client grants on every existing table partition (21 of them;
--    relispartition is also true for ~128 partitioned indexes, which REVOKE
--    does not apply to, hence the relkind filter below).
--    Parent-level permissions govern queries against the parent, so this has
--    no effect on legitimate reads through firewall_audit_logs et al.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r record;
    n int := 0;
BEGIN
    FOR r IN
        SELECT c.oid::regclass AS part
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public'
          AND c.relispartition
          -- relispartition is also true for partitioned INDEXES; REVOKE only
          -- applies to relations. Restrict to ordinary + partitioned tables.
          AND c.relkind IN ('r', 'p')
    LOOP
        EXECUTE format('REVOKE ALL ON %s FROM anon, authenticated', r.part);
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'revoked anon/authenticated on % partitions', n;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Remove TRUNCATE/REFERENCES/TRIGGER from the partition parents.
--    SELECT/INSERT/UPDATE/DELETE are retained and remain governed by RLS.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'firewall_audit_logs','endpoint_event_logs','sysmon_events',
        'dns_query_logs','endpoint_status','site_event_logs'
    ] LOOP
        EXECUTE format(
            'REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. platform_locks: internal coordination table, no client grants exist.
--    Enable RLS so it is default-deny rather than relying on absent grants.
--    service_role/postgres carry BYPASSRLS, so internal use is unaffected.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_locks ENABLE ROW LEVEL SECURITY;

COMMIT;
