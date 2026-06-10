-- DNS filtering & split-DNS module.
--
-- Architecture: the Mithras resolver (dns.mithras.com.au) terminates DoH
-- queries from endpoints, scopes by /{org-uuid}/dns-query URL, applies the
-- org's policy, and forwards to the configured upstream. Internal scopes
-- never hit the resolver — the agent pushes Windows NRPT rules so internal
-- suffixes go directly to the customer's internal DNS forwarders.
--
-- Tables:
--   organizations.dns_module_enabled  - module gate
--   dns_policies                      - per-org policy (categories + lists +
--                                       optional upstream override)
--   dns_internal_scopes               - per-policy split-DNS rules
--   dns_policy_assignments            - which endpoints/groups get a policy
--   dns_query_logs                    - partitioned per-query log (resolver
--                                       writes; SOC UI reads)

BEGIN;

-- 1. Module gate
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS dns_module_enabled boolean NOT NULL DEFAULT false;

-- 2. Policies
CREATE TABLE IF NOT EXISTS public.dns_policies (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                text NOT NULL,
    description         text,
    is_default          boolean NOT NULL DEFAULT false,

    -- Upstream override (NULL = use platform-default upstream).
    upstream_provider   text,                       -- 'cloudflare_family' | 'quad9' | 'opendns_family' | 'nextdns' | 'custom'
    upstream_doh_uri    text,
    upstream_servers    text[],                     -- IPs as fallback if DoH unavailable

    -- Category toggles
    block_malware       boolean NOT NULL DEFAULT true,
    block_phishing      boolean NOT NULL DEFAULT true,
    block_adult         boolean NOT NULL DEFAULT false,
    block_gambling      boolean NOT NULL DEFAULT false,
    block_social        boolean NOT NULL DEFAULT false,

    -- Custom lists. allowlist always wins over blocklist + categories.
    custom_blocklist    text[] NOT NULL DEFAULT '{}',
    custom_allowlist    text[] NOT NULL DEFAULT '{}',

    -- Browser DoH bypass — push GPO disabling Chrome/Firefox/Edge built-in
    -- DoH so they can't go around our resolver.
    disable_browser_doh boolean NOT NULL DEFAULT true,

    created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dns_policies_org ON public.dns_policies(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dns_policy_default
    ON public.dns_policies(organization_id) WHERE is_default;

CREATE OR REPLACE FUNCTION public.touch_dns_policies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_dns_policies_touch ON public.dns_policies;
CREATE TRIGGER trg_dns_policies_touch BEFORE UPDATE ON public.dns_policies
FOR EACH ROW EXECUTE FUNCTION public.touch_dns_policies_updated_at();

-- 3. Internal scopes (split-DNS rules)
CREATE TABLE IF NOT EXISTS public.dns_internal_scopes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id       uuid NOT NULL REFERENCES public.dns_policies(id) ON DELETE CASCADE,
    suffix          text NOT NULL,             -- e.g. 'corp.local', '0.168.192.in-addr.arpa'
    forwarders      text[] NOT NULL,           -- e.g. ['192.168.1.10','192.168.1.11']
    description     text,
    display_order   integer NOT NULL DEFAULT 100,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dns_internal_scopes_policy ON public.dns_internal_scopes(policy_id);

-- 4. Assignments — policy ↔ endpoint or endpoint_group
CREATE TABLE IF NOT EXISTS public.dns_policy_assignments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id           uuid NOT NULL REFERENCES public.dns_policies(id) ON DELETE CASCADE,
    endpoint_id         uuid REFERENCES public.endpoints(id) ON DELETE CASCADE,
    endpoint_group_id   uuid REFERENCES public.endpoint_groups(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT one_target_required CHECK (
        (endpoint_id IS NOT NULL AND endpoint_group_id IS NULL)
     OR (endpoint_id IS NULL AND endpoint_group_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_dns_assignments_policy ON public.dns_policy_assignments(policy_id);
CREATE INDEX IF NOT EXISTS idx_dns_assignments_endpoint
    ON public.dns_policy_assignments(endpoint_id) WHERE endpoint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dns_assignments_group
    ON public.dns_policy_assignments(endpoint_group_id) WHERE endpoint_group_id IS NOT NULL;

-- 5. Query log (partitioned monthly, 30-day retention)
CREATE TABLE IF NOT EXISTS public.dns_query_logs (
    id              uuid                     NOT NULL DEFAULT gen_random_uuid(),
    organization_id uuid                     NOT NULL,
    endpoint_id     uuid,                    -- nullable: cannot always identify
    policy_id       uuid,                    -- which policy applied
    query_time      timestamptz              NOT NULL,
    query_name      text                     NOT NULL,
    query_type      text,                    -- 'A','AAAA','CNAME','MX','TXT','SRV'
    action          text                     NOT NULL,   -- 'allowed' | 'blocked' | 'forwarded'
    block_reason    text,                    -- 'category:malware' | 'custom_blocklist' | NULL
    client_ip       text,
    upstream_used   text,                    -- e.g. 'cloudflare_family'
    latency_ms      integer,
    response_code   text,                    -- 'NOERROR','NXDOMAIN','REFUSED'
    PRIMARY KEY (id, query_time)
) PARTITION BY RANGE (query_time);

CREATE INDEX IF NOT EXISTS idx_dns_query_logs_org_time
    ON public.dns_query_logs (organization_id, query_time DESC);
CREATE INDEX IF NOT EXISTS idx_dns_query_logs_endpoint_time
    ON public.dns_query_logs (endpoint_id, query_time DESC)
    WHERE endpoint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dns_query_logs_action
    ON public.dns_query_logs (organization_id, action, query_time DESC);
CREATE INDEX IF NOT EXISTS idx_dns_query_logs_name
    ON public.dns_query_logs (organization_id, query_name);

-- 6. Partition helpers
CREATE OR REPLACE FUNCTION public.ensure_dns_query_logs_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_start date := date_trunc('month', p_month)::date;
    v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name  text := format('dns_query_logs_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.dns_query_logs FOR VALUES FROM (%L) TO (%L);',
        v_name, v_start, v_end
    );
END
$$;

CREATE OR REPLACE FUNCTION public.drop_old_dns_query_logs_partitions(p_keep interval DEFAULT interval '30 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cutoff    timestamptz := now() - p_keep;
    v_partition text;
    v_dropped   int := 0;
BEGIN
    FOR v_partition IN
        SELECT child.relname
        FROM pg_inherits i
        JOIN pg_class parent ON i.inhparent = parent.oid
        JOIN pg_class child  ON i.inhrelid  = child.oid
        JOIN pg_namespace n  ON child.relnamespace = n.oid
        WHERE parent.relname = 'dns_query_logs'
          AND n.nspname = 'public'
          AND (to_date(substring(child.relname FROM 'dns_query_logs_(\d{4}_\d{2})'), 'YYYY_MM')
               + interval '1 month')::timestamptz < v_cutoff
    LOOP
        EXECUTE format('DROP TABLE public.%I;', v_partition);
        v_dropped := v_dropped + 1;
    END LOOP;
    RETURN v_dropped;
END
$$;

-- 7. RLS
ALTER TABLE public.dns_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dns_internal_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dns_policy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dns_query_logs ENABLE ROW LEVEL SECURITY;

-- dns_policies: members read; admins write
DROP POLICY IF EXISTS "dns_policies_select" ON public.dns_policies;
CREATE POLICY "dns_policies_select" ON public.dns_policies FOR SELECT TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "dns_policies_insert" ON public.dns_policies;
CREATE POLICY "dns_policies_insert" ON public.dns_policies FOR INSERT TO authenticated
    WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "dns_policies_update" ON public.dns_policies;
CREATE POLICY "dns_policies_update" ON public.dns_policies FOR UPDATE TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "dns_policies_delete" ON public.dns_policies;
CREATE POLICY "dns_policies_delete" ON public.dns_policies FOR DELETE TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

-- dns_internal_scopes: piggyback on parent policy's org
DROP POLICY IF EXISTS "dns_scopes_select" ON public.dns_internal_scopes;
CREATE POLICY "dns_scopes_select" ON public.dns_internal_scopes FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dns_policies p
        WHERE p.id = dns_internal_scopes.policy_id
          AND (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), p.organization_id))
    ));
DROP POLICY IF EXISTS "dns_scopes_write" ON public.dns_internal_scopes;
CREATE POLICY "dns_scopes_write" ON public.dns_internal_scopes FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dns_policies p
        WHERE p.id = dns_internal_scopes.policy_id
          AND (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), p.organization_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.dns_policies p
        WHERE p.id = dns_internal_scopes.policy_id
          AND (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), p.organization_id))
    ));

-- dns_policy_assignments: same pattern
DROP POLICY IF EXISTS "dns_assignments_select" ON public.dns_policy_assignments;
CREATE POLICY "dns_assignments_select" ON public.dns_policy_assignments FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dns_policies p
        WHERE p.id = dns_policy_assignments.policy_id
          AND (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), p.organization_id))
    ));
DROP POLICY IF EXISTS "dns_assignments_write" ON public.dns_policy_assignments;
CREATE POLICY "dns_assignments_write" ON public.dns_policy_assignments FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dns_policies p
        WHERE p.id = dns_policy_assignments.policy_id
          AND (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), p.organization_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.dns_policies p
        WHERE p.id = dns_policy_assignments.policy_id
          AND (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), p.organization_id))
    ));

-- dns_query_logs: read-only for org members. Resolver writes via service role.
DROP POLICY IF EXISTS "dns_query_logs_select" ON public.dns_query_logs;
CREATE POLICY "dns_query_logs_select" ON public.dns_query_logs FOR SELECT TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

-- 8. Initial partitions: prev / current / +2 future
SELECT public.ensure_dns_query_logs_partition((date_trunc('month', now()) - interval '1 month')::date);
SELECT public.ensure_dns_query_logs_partition(date_trunc('month', now())::date);
SELECT public.ensure_dns_query_logs_partition((date_trunc('month', now()) + interval '1 month')::date);
SELECT public.ensure_dns_query_logs_partition((date_trunc('month', now()) + interval '2 months')::date);

-- 9. Helper RPC: resolve which policy applies to a given endpoint.
-- Used by the agent-api dns-policy endpoint. Falls back: endpoint direct
-- assignment > group assignment > org default.
CREATE OR REPLACE FUNCTION public.get_endpoint_dns_policy(p_endpoint_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH org_id AS (
        SELECT organization_id FROM public.endpoints WHERE id = p_endpoint_id
    ),
    direct AS (
        SELECT a.policy_id
        FROM public.dns_policy_assignments a
        JOIN public.dns_policies p ON p.id = a.policy_id
        WHERE a.endpoint_id = p_endpoint_id
          AND p.organization_id = (SELECT organization_id FROM org_id)
        LIMIT 1
    ),
    via_group AS (
        SELECT a.policy_id
        FROM public.dns_policy_assignments a
        JOIN public.dns_policies p ON p.id = a.policy_id
        JOIN public.endpoint_group_memberships egm ON egm.group_id = a.endpoint_group_id
        WHERE egm.endpoint_id = p_endpoint_id
          AND p.organization_id = (SELECT organization_id FROM org_id)
        LIMIT 1
    ),
    org_default AS (
        SELECT id AS policy_id
        FROM public.dns_policies
        WHERE organization_id = (SELECT organization_id FROM org_id)
          AND is_default
        LIMIT 1
    )
    SELECT policy_id FROM direct
    UNION ALL SELECT policy_id FROM via_group
    UNION ALL SELECT policy_id FROM org_default
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_endpoint_dns_policy(uuid) TO service_role, authenticated;

COMMIT;

-- 10. Schedule partition mgmt
DO $$ BEGIN PERFORM cron.unschedule('dns-query-logs-create-next-partition'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('dns-query-logs-drop-old-partitions');   EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'dns-query-logs-create-next-partition',
    '0 0 25 * *',
    $$SELECT public.ensure_dns_query_logs_partition((date_trunc('month', now()) + interval '1 month')::date)$$
);

SELECT cron.schedule(
    'dns-query-logs-drop-old-partitions',
    '20 3 * * *',
    $$SELECT public.drop_old_dns_query_logs_partitions(interval '30 days')$$
);
