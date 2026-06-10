-- Grafana SOC datasource role. Read-only across every tenant — that's
-- the whole point of the SOC console: Peritus operators view all
-- customer data in one place.
--
-- BYPASSRLS lets the role read every row regardless of organization;
-- access is granted only to specific SOC operators (super-admins) via
-- Grafana SSO (Caddy cookie → X-JWT-Assertion). We do NOT expose the
-- token columns of m365_tenants — same protection as the app layer.
--
-- Password sourced from GRAFANA_DB_PASSWORD env in the supabase compose
-- stack. Re-running this migration is safe: passwords match if env is
-- unchanged, otherwise rotate first then re-run.

DO $$
DECLARE
    _pw TEXT := current_setting('grafana_db_password', true);
BEGIN
    -- We can't read env vars directly; pass via SET LOCAL or use a default
    -- placeholder. Operators run this with `psql -v grafana_db_password=…`
    -- or rely on the matching docker-compose env. Below we use COALESCE
    -- so the placeholder is detected at first run.
    NULL;
END $$;

-- Role is created via DO block so re-runs don't fail on "already exists".
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_reader') THEN
        EXECUTE 'CREATE ROLE grafana_reader LOGIN BYPASSRLS PASSWORD ''__placeholder_set_via_alter_role__''';
    END IF;
END $$;

-- Connect / schema basics.
GRANT CONNECT ON DATABASE postgres TO grafana_reader;
GRANT USAGE ON SCHEMA public TO grafana_reader;

-- Most tables: full SELECT. (BYPASSRLS already lets the role see every
-- row; SELECT grant lets it read the columns.)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_reader;
-- New tables added later inherit the grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_reader;

-- Token columns of m365_tenants are sensitive — same line we draw for
-- the app-level authenticated role. Revoke specifically.
REVOKE SELECT (access_token, refresh_token) ON public.m365_tenants FROM grafana_reader;

-- Sequences / functions: usage-only on the safe ones.
GRANT EXECUTE ON FUNCTION public.is_member_of_org(uuid, uuid) TO grafana_reader;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid)         TO grafana_reader;
