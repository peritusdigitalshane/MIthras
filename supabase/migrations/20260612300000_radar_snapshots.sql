-- Mithras Radar — public threat-intelligence dashboard at /radar.
--
-- Strategy: pre-aggregated tile snapshots refreshed hourly by a cron-driven
-- edge function. The public endpoint reads from radar_snapshots only — never
-- touches the underlying telemetry tables — so the page can be served
-- aggressively cached without leaking customer-level data and without
-- competing with the live operational workload for I/O.
--
-- Privacy floor: every tile that aggregates across customers requires at
-- least MIN_CONTRIBUTING_TENANTS contributing organisations before it is
-- rendered. The threshold lives in the refresh function, not in the DB,
-- because it varies per tile.

create table if not exists public.radar_snapshots (
    tile_key      text primary key,
    data          jsonb     not null,
    computed_at   timestamptz not null default now(),
    tenant_count  integer   not null default 0,
    sample_count  bigint    not null default 0
);

comment on table public.radar_snapshots is
  'Pre-aggregated public-radar tiles, refreshed hourly by the radar-refresh edge function. RLS allows public read; writes are service-role only.';

alter table public.radar_snapshots enable row level security;

drop policy if exists radar_snapshots_public_read on public.radar_snapshots;
create policy radar_snapshots_public_read
    on public.radar_snapshots
    for select
    to anon, authenticated
    using (true);


create table if not exists public.radar_external_feeds (
    feed_key      text primary key,
    data          jsonb     not null,
    source        text      not null,
    fetched_at    timestamptz not null default now(),
    upstream_etag text
);

comment on table public.radar_external_feeds is
  'Mirror of upstream public threat-intelligence feeds. CISA KEV, urlhaus, threatfox. Refreshed on its own cadence by radar-refresh.';

alter table public.radar_external_feeds enable row level security;

drop policy if exists radar_external_feeds_public_read on public.radar_external_feeds;
create policy radar_external_feeds_public_read
    on public.radar_external_feeds
    for select
    to anon, authenticated
    using (true);


-- ----------------------------------------------------------------------------
-- Aggregator helpers. SQL functions, called via supabase.rpc() from the
-- radar-refresh edge function which wraps the result with the tenant-count
-- floor and upserts into radar_snapshots.
-- ----------------------------------------------------------------------------

-- Tile: threats_blocked_week. 7-day Defender detections, severity split, plus
-- the count of distinct contributing tenants. endpoint_threats has no direct
-- organization_id — join via endpoints to attribute to a tenant.
drop function if exists public.radar_tile_threats_blocked_week();
create or replace function public.radar_tile_threats_blocked_week()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with seven as (
        select
            et.severity,
            count(*) filter (where lower(et.status) in ('cleaned','quarantined','removed','blocked','remediated')) as blocked,
            count(*)                                                                                                as total
        from public.endpoint_threats et
        where coalesce(et.initial_detection_time, et.created_at) >= now() - interval '7 days'
        group by 1
    ),
    tenants as (
        select count(distinct e.organization_id) as tenants
        from public.endpoint_threats et
        join public.endpoints e on e.id = et.endpoint_id
        where coalesce(et.initial_detection_time, et.created_at) >= now() - interval '7 days'
    )
    select jsonb_build_object(
        'window',     '7d',
        'total',      coalesce((select sum(total) from seven), 0),
        'blocked',    coalesce((select sum(blocked) from seven), 0),
        'by_severity', coalesce(
            (select jsonb_object_agg(severity, jsonb_build_object('total', total, 'blocked', blocked))
             from seven), '{}'::jsonb),
        'tenants',    (select tenants from tenants)
    );
$$;


-- Tile: top_malware_families_30d. Most-seen threat_name strings across the
-- fleet over 30 days. Capped at 15 rows, families only return when seen in
-- >=2 distinct tenants.
drop function if exists public.radar_tile_top_malware_families();
create or replace function public.radar_tile_top_malware_families()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with raw as (
        select
            coalesce(nullif(et.threat_name, ''), 'Unknown') as family,
            count(*)                                         as hits,
            count(distinct e.organization_id)                as tenants
        from public.endpoint_threats et
        join public.endpoints e on e.id = et.endpoint_id
        where coalesce(et.initial_detection_time, et.created_at) >= now() - interval '30 days'
        group by 1
        having count(distinct e.organization_id) >= 2
        order by hits desc
        limit 15
    )
    select jsonb_build_object(
        'window',  '30d',
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                    'family',  family,
                    'hits',    hits,
                    'tenants', tenants))
                  from raw), '[]'::jsonb),
        'tenants', (select count(distinct e.organization_id)
                    from public.endpoint_threats et
                    join public.endpoints e on e.id = et.endpoint_id
                    where coalesce(et.initial_detection_time, et.created_at) >= now() - interval '30 days')
    );
$$;


-- Tile: top_cves_in_fleet. vulnerability_findings has organization_id direct,
-- so no join. Cross-reference against the CISA KEV mirror.
drop function if exists public.radar_tile_top_cves();
create or replace function public.radar_tile_top_cves()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    kev jsonb;
    result jsonb;
begin
    select data into kev from public.radar_external_feeds where feed_key = 'cisa_kev';
    with raw as (
        select
            vf.cve_id,
            count(distinct vf.endpoint_id)        as endpoints,
            count(distinct vf.organization_id)    as tenants,
            max(coalesce(vf.cvss_score, 0))::numeric as cvss
        from public.vulnerability_findings vf
        where vf.status = 'open'
          and vf.cve_id is not null
        group by vf.cve_id
        having count(distinct vf.organization_id) >= 2
        order by tenants desc, endpoints desc
        limit 20
    )
    select jsonb_build_object(
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                    'cve',       cve_id,
                    'endpoints', endpoints,
                    'tenants',   tenants,
                    'cvss',      cvss,
                    'kev',       case when kev ? cve_id then true else false end
                 ) order by tenants desc, endpoints desc)
                 from raw), '[]'::jsonb),
        'tenants', (select count(distinct organization_id)
                    from public.vulnerability_findings
                    where status = 'open')
    ) into result;
    return result;
end;
$$;


-- Tile: eol_windows_exposure. endpoints has no `os_version` on every schema;
-- guard against missing column.
drop function if exists public.radar_tile_eol_exposure();
create or replace function public.radar_tile_eol_exposure()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    has_col boolean;
    result jsonb;
begin
    select exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='endpoints' and column_name='os_version'
    ) into has_col;
    if not has_col then
        return jsonb_build_object('items', '[]'::jsonb, 'tenants', 0, 'unavailable', true);
    end if;

    execute $sql$
        with classified as (
            select
                case
                    when os_version ilike '%windows 7%'             then 'Windows 7'
                    when os_version ilike '%windows 8.1%'           then 'Windows 8.1'
                    when os_version ilike '%windows 10%'            then 'Windows 10'
                    when os_version ilike '%windows 11%'            then 'Windows 11'
                    when os_version ilike '%server 2008%'           then 'Server 2008 / R2'
                    when os_version ilike '%server 2012%'           then 'Server 2012 / R2'
                    when os_version ilike '%server 2016%'           then 'Server 2016'
                    when os_version ilike '%server 2019%'           then 'Server 2019'
                    when os_version ilike '%server 2022%'           then 'Server 2022'
                    else 'Other / unknown'
                end as os_bucket,
                organization_id
            from public.endpoints
            where is_active = true and os_version is not null
        ),
        counts as (
            select os_bucket,
                   count(*)::numeric                                        as endpoints,
                   count(distinct organization_id)                          as tenants
            from classified
            group by os_bucket
        ),
        total as (select sum(endpoints) as t from counts)
        select jsonb_build_object(
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'os',       os_bucket,
                        'share',    round(endpoints * 100.0 / nullif((select t from total),0), 1),
                        'eol',      os_bucket in ('Windows 7','Windows 8.1','Server 2008 / R2','Server 2012 / R2'),
                        'tenants',  tenants
                    ) order by endpoints desc)
                    from counts where tenants >= 2), '[]'::jsonb),
            'tenants', (select count(distinct organization_id) from public.endpoints where is_active = true)
        )
    $sql$ into result;
    return coalesce(result, jsonb_build_object('items', '[]'::jsonb, 'tenants', 0));
end;
$$;


-- Tile: brute_force_target_ports. firewall_audit_logs uses local_port for the
-- destination port on inbound traffic and stores service_name. We group by
-- local_port and surface service_name as the label.
drop function if exists public.radar_tile_brute_force_ports();
create or replace function public.radar_tile_brute_force_ports()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with raw as (
        select
            fal.local_port::text                 as port,
            mode() within group (order by fal.service_name) as service,
            count(*)::bigint                     as attempts,
            count(distinct fal.organization_id)  as tenants
        from public.firewall_audit_logs fal
        where fal.event_time >= now() - interval '7 days'
          and fal.direction = 'inbound'
          and fal.local_port is not null
        group by 1
        having count(distinct fal.organization_id) >= 2
        order by attempts desc
        limit 12
    )
    select jsonb_build_object(
        'window', '7d',
        'items',  coalesce((select jsonb_agg(jsonb_build_object(
                    'port',    port,
                    'service', service,
                    'attempts', attempts,
                    'tenants',  tenants))
                from raw), '[]'::jsonb),
        'tenants', coalesce((select sum(tenants) from raw), 0)
    );
$$;


-- Tile: attack_origins. firewall_audit_logs has no country column. Instead of
-- a country breakdown we surface the top targeted service_name across the
-- fleet — same shape signal, available without geo enrichment.
drop function if exists public.radar_tile_attack_origins();
create or replace function public.radar_tile_attack_origins()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with raw as (
        select
            coalesce(nullif(fal.service_name, ''), 'unknown') as country,
            count(*)::bigint                                 as attempts,
            count(distinct fal.organization_id)              as tenants
        from public.firewall_audit_logs fal
        where fal.event_time >= now() - interval '7 days'
          and fal.direction = 'inbound'
        group by 1
        having count(distinct fal.organization_id) >= 2
        order by attempts desc
        limit 15
    )
    select jsonb_build_object(
        'window', '7d',
        -- Surface the actual signal we have: targeted service name.
        -- The frontend renders this as a list rather than a country flag.
        'items',  coalesce((select jsonb_agg(jsonb_build_object(
                    'country',  country,
                    'attempts', attempts,
                    'tenants',  tenants))
                from raw), '[]'::jsonb),
        'tenants', coalesce((select sum(tenants) from raw), 0)
    );
$$;


-- Tile: phishing_themes. Guarded — table may not exist on a given install.
drop function if exists public.radar_tile_phishing_themes();
create or replace function public.radar_tile_phishing_themes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    result jsonb;
    has_table boolean;
begin
    select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'm365_threat_events'
    ) into has_table;
    if not has_table then
        return jsonb_build_object('items', '[]'::jsonb, 'window', '30d', 'unavailable', true);
    end if;

    execute $sql$
        with raw as (
            select
                coalesce(nullif(m.threat_type, ''), 'Unclassified') as theme,
                count(*)::bigint as detections,
                count(distinct t.organization_id) as tenants
            from public.m365_threat_events m
            join public.m365_tenants t on t.id = m.tenant_id
            where m.detected_at >= now() - interval '30 days'
            group by 1
            having count(distinct t.organization_id) >= 2
            order by detections desc
            limit 10
        )
        select jsonb_build_object(
            'window', '30d',
            'items',  coalesce((select jsonb_agg(jsonb_build_object(
                        'theme',      theme,
                        'detections', detections,
                        'tenants',    tenants))
                    from raw), '[]'::jsonb)
        )
    $sql$ into result;

    return coalesce(result, jsonb_build_object('items', '[]'::jsonb, 'window', '30d'));
end;
$$;


-- Tile: wordpress_brute_force_trend. 14-day per-day count.
drop function if exists public.radar_tile_wp_bruteforce_trend();
create or replace function public.radar_tile_wp_bruteforce_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    has_alerts boolean;
    result jsonb;
begin
    select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'alerts'
    ) into has_alerts;
    if not has_alerts then
        return jsonb_build_object('items', '[]'::jsonb, 'window', '14d');
    end if;

    execute $sql$
        with days as (
            select generate_series(
                (now()::date - interval '13 days')::date,
                now()::date,
                interval '1 day'
            )::date as d
        ),
        counts as (
            select date_trunc('day', created_at)::date as d, count(*) as c
            from public.alerts
            where alert_type = 'wordpress_brute_force'
              and created_at >= now() - interval '14 days'
            group by 1
        )
        select jsonb_build_object(
            'window', '14d',
            'items',  jsonb_agg(jsonb_build_object(
                        'date', to_char(d.d, 'YYYY-MM-DD'),
                        'count', coalesce(c.c, 0)
                    ) order by d.d)
        )
        from days d
        left join counts c on c.d = d.d
    $sql$ into result;

    return coalesce(result, jsonb_build_object('items', '[]'::jsonb, 'window', '14d'));
end;
$$;


grant execute on function
    public.radar_tile_threats_blocked_week(),
    public.radar_tile_top_malware_families(),
    public.radar_tile_top_cves(),
    public.radar_tile_eol_exposure(),
    public.radar_tile_brute_force_ports(),
    public.radar_tile_attack_origins(),
    public.radar_tile_phishing_themes(),
    public.radar_tile_wp_bruteforce_trend()
  to service_role;
