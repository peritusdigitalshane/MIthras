-- Application whitelisting -- per-endpoint state machine that mirrors the
-- microsegmentation pattern but for processes instead of network traffic.
--
--   idle       -- no observation, no enforcement. Endpoint runs whatever.
--   auditing   -- agent ships every process launch (sha256, publisher, path)
--                  to app_audit_logs with action='observed'. Nothing blocked.
--   enforcing  -- agent compares every launch to app_whitelist_rules. Match by
--                  hash OR publisher OR path glob is allow; anything else is
--                  Stop-Process killed and shipped with action='blocked'.
--
-- Match identity: one rule = one (match_type, match_value) pair. Multiple
-- rules per app are fine and union together (allow if any rule matches).

CREATE TABLE IF NOT EXISTS public.app_whitelist_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    endpoint_id     uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
    match_type      text NOT NULL,
    match_value     text NOT NULL,
    app_name        text,                       -- friendly label for UI rows
    publisher       text,                       -- snapshot at promotion time
    file_path       text,                       -- snapshot at promotion time
    sha256          text,                       -- snapshot at promotion time
    enabled         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT app_whitelist_rules_valid_type CHECK (match_type IN ('hash','publisher','path'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_whitelist_rules_endpoint_type_value
    ON public.app_whitelist_rules(endpoint_id, match_type, lower(match_value));
CREATE INDEX IF NOT EXISTS idx_app_whitelist_rules_endpoint
    ON public.app_whitelist_rules(endpoint_id, enabled);
CREATE INDEX IF NOT EXISTS idx_app_whitelist_rules_org
    ON public.app_whitelist_rules(organization_id);

ALTER TABLE public.app_whitelist_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read app whitelist rules in own org" ON public.app_whitelist_rules;
CREATE POLICY "Read app whitelist rules in own org"
    ON public.app_whitelist_rules FOR SELECT
    USING (
      public.is_member_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Modify app whitelist rules needs admin" ON public.app_whitelist_rules;
CREATE POLICY "Modify app whitelist rules needs admin"
    ON public.app_whitelist_rules FOR ALL
    USING (
      public.is_admin_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    )
    WITH CHECK (
      public.is_admin_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    );

CREATE TABLE IF NOT EXISTS public.app_whitelist_state (
    endpoint_id            uuid PRIMARY KEY REFERENCES public.endpoints(id) ON DELETE CASCADE,
    organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    mode                   text NOT NULL DEFAULT 'idle',
    audit_started_at       timestamptz,
    enforce_started_at     timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_whitelist_valid_mode CHECK (mode IN ('idle','auditing','enforcing'))
);

CREATE INDEX IF NOT EXISTS idx_app_whitelist_state_org
    ON public.app_whitelist_state(organization_id);

ALTER TABLE public.app_whitelist_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read app whitelist state in own org" ON public.app_whitelist_state;
CREATE POLICY "Read app whitelist state in own org"
    ON public.app_whitelist_state FOR SELECT
    USING (
      public.is_member_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Modify app whitelist state needs admin" ON public.app_whitelist_state;
CREATE POLICY "Modify app whitelist state needs admin"
    ON public.app_whitelist_state FOR ALL
    USING (
      public.is_admin_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    )
    WITH CHECK (
      public.is_admin_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    );

-- Process-launch events. action='observed' during audit, 'allowed'/'blocked'
-- during enforce. Partitioned-ready PK: id+event_time.
CREATE TABLE IF NOT EXISTS public.app_audit_logs (
    id              uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    endpoint_id     uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
    event_time      timestamptz NOT NULL DEFAULT now(),
    file_name       text,
    file_path       text,
    sha256          text,
    publisher       text,
    product_name    text,
    file_version    text,
    process_id      int,
    parent_path     text,
    user_name       text,
    command_line    text,
    action          text NOT NULL,
    rule_id         uuid REFERENCES public.app_whitelist_rules(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, event_time),
    CONSTRAINT app_audit_logs_valid_action CHECK (action IN ('observed','allowed','blocked'))
);

CREATE INDEX IF NOT EXISTS idx_app_audit_logs_endpoint_time
    ON public.app_audit_logs(endpoint_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_org_time
    ON public.app_audit_logs(organization_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_sha256
    ON public.app_audit_logs(endpoint_id, sha256);

ALTER TABLE public.app_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read app audit logs in own org" ON public.app_audit_logs;
CREATE POLICY "Read app audit logs in own org"
    ON public.app_audit_logs FOR SELECT
    USING (
      public.is_member_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    );

-- Only the service role inserts (via edge function). No user-facing INSERT/UPDATE.

-- ---------------------------------------------------------------------------
-- State transition RPCs.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.endpoint_app_whitelist_start_audit(p_endpoint_id uuid)
RETURNS public.app_whitelist_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id uuid;
    v_row    public.app_whitelist_state;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    INSERT INTO public.app_whitelist_state (endpoint_id, organization_id, mode, audit_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, 'auditing', now(), NULL, now())
    ON CONFLICT (endpoint_id) DO UPDATE
       SET mode               = 'auditing',
           audit_started_at   = now(),
           enforce_started_at = NULL,
           updated_at         = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_app_whitelist_start_audit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.endpoint_app_whitelist_stop(p_endpoint_id uuid)
RETURNS public.app_whitelist_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id uuid;
    v_row    public.app_whitelist_state;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    INSERT INTO public.app_whitelist_state (endpoint_id, organization_id, mode, audit_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, 'idle', NULL, NULL, now())
    ON CONFLICT (endpoint_id) DO UPDATE
       SET mode               = 'idle',
           audit_started_at   = NULL,
           enforce_started_at = NULL,
           updated_at         = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_app_whitelist_stop(uuid) TO authenticated;

-- Enforce -- promote every distinct (sha256, publisher) observed since
-- audit_started_at into hash-rules + publisher-rules, then flip mode=enforcing.
-- A small set of OS path rules is seeded too so the box doesn't brick.
CREATE OR REPLACE FUNCTION public.endpoint_app_whitelist_enforce(p_endpoint_id uuid)
RETURNS public.app_whitelist_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id        uuid;
    v_audit_from    timestamptz;
    v_uid           uuid := auth.uid();
    v_row           public.app_whitelist_state;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    SELECT audit_started_at INTO v_audit_from
      FROM public.app_whitelist_state WHERE endpoint_id = p_endpoint_id;
    IF v_audit_from IS NULL THEN v_audit_from := now() - interval '7 days'; END IF;

    -- Seed OS-critical path rules so basic operation continues.
    INSERT INTO public.app_whitelist_rules
        (organization_id, endpoint_id, match_type, match_value, app_name, created_by)
    VALUES
        (v_org_id, p_endpoint_id, 'path', 'C:\Windows\System32\*',         'Windows System32',         v_uid),
        (v_org_id, p_endpoint_id, 'path', 'C:\Windows\SysWOW64\*',         'Windows SysWOW64',         v_uid),
        (v_org_id, p_endpoint_id, 'path', 'C:\Windows\WinSxS\*',           'Windows component store',  v_uid),
        (v_org_id, p_endpoint_id, 'path', 'C:\Program Files\Mithras\*',    'Mithras agent itself',     v_uid),
        (v_org_id, p_endpoint_id, 'path', 'C:\ProgramData\Mithras\*',      'Mithras agent data',       v_uid)
    ON CONFLICT (endpoint_id, match_type, lower(match_value)) DO NOTHING;

    -- Promote every distinct sha256 we've seen during the audit window.
    INSERT INTO public.app_whitelist_rules
        (organization_id, endpoint_id, match_type, match_value, app_name, publisher, file_path, sha256, created_by)
    SELECT v_org_id, p_endpoint_id, 'hash', a.sha256,
           COALESCE(MAX(a.product_name), MAX(a.file_name)),
           MAX(a.publisher),
           MAX(a.file_path),
           a.sha256,
           v_uid
      FROM public.app_audit_logs a
     WHERE a.endpoint_id = p_endpoint_id
       AND a.action = 'observed'
       AND a.event_time >= v_audit_from
       AND a.sha256 IS NOT NULL AND length(a.sha256) > 0
     GROUP BY a.sha256
    ON CONFLICT (endpoint_id, match_type, lower(match_value)) DO NOTHING;

    INSERT INTO public.app_whitelist_state (endpoint_id, organization_id, mode, audit_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, 'enforcing', v_audit_from, now(), now())
    ON CONFLICT (endpoint_id) DO UPDATE
       SET mode               = 'enforcing',
           enforce_started_at = now(),
           updated_at         = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_app_whitelist_enforce(uuid) TO authenticated;

-- Promote a single observed app (one sha256) into the whitelist. UI uses this
-- per-row from the "observed apps" table.
CREATE OR REPLACE FUNCTION public.endpoint_app_whitelist_add_observed(
    p_endpoint_id uuid,
    p_sha256      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id uuid;
    v_uid    uuid := auth.uid();
    v_rule_id uuid;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    INSERT INTO public.app_whitelist_rules
        (organization_id, endpoint_id, match_type, match_value, app_name, publisher, file_path, sha256, created_by)
    SELECT v_org_id, p_endpoint_id, 'hash', a.sha256,
           COALESCE(MAX(a.product_name), MAX(a.file_name)),
           MAX(a.publisher),
           MAX(a.file_path),
           a.sha256,
           v_uid
      FROM public.app_audit_logs a
     WHERE a.endpoint_id = p_endpoint_id
       AND a.sha256 = p_sha256
     GROUP BY a.sha256
    ON CONFLICT (endpoint_id, match_type, lower(match_value)) DO UPDATE
       SET enabled = true
    RETURNING id INTO v_rule_id;
    RETURN v_rule_id;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_app_whitelist_add_observed(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Query RPC. Returns mode + observed-app aggregates + current rules.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_endpoint_app_whitelist(uuid);

CREATE FUNCTION public.get_endpoint_app_whitelist(p_endpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id     uuid;
    v_state_row  public.app_whitelist_state;
    v_audit_from timestamptz;
    v_observed   jsonb;
    v_rules      jsonb;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RETURN NULL; END IF;
    IF NOT (public.is_member_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_state_row FROM public.app_whitelist_state WHERE endpoint_id = p_endpoint_id;

    v_audit_from := COALESCE(v_state_row.audit_started_at, now() - interval '7 days');

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'sha256',       o.sha256,
              'file_name',    o.file_name,
              'file_path',    o.file_path,
              'publisher',    o.publisher,
              'product_name', o.product_name,
              'file_version', o.file_version,
              'first_seen',   o.first_seen,
              'last_seen',    o.last_seen,
              'launches',     o.launches,
              'blocked',      o.blocked,
              'whitelisted',  o.whitelisted
           ) ORDER BY o.last_seen DESC NULLS LAST), '[]'::jsonb)
      INTO v_observed
      FROM (
        SELECT
          a.sha256,
          (array_agg(a.file_name    ORDER BY a.event_time DESC) FILTER (WHERE a.file_name    IS NOT NULL))[1] AS file_name,
          (array_agg(a.file_path    ORDER BY a.event_time DESC) FILTER (WHERE a.file_path    IS NOT NULL))[1] AS file_path,
          (array_agg(a.publisher    ORDER BY a.event_time DESC) FILTER (WHERE a.publisher    IS NOT NULL))[1] AS publisher,
          (array_agg(a.product_name ORDER BY a.event_time DESC) FILTER (WHERE a.product_name IS NOT NULL))[1] AS product_name,
          (array_agg(a.file_version ORDER BY a.event_time DESC) FILTER (WHERE a.file_version IS NOT NULL))[1] AS file_version,
          MIN(a.event_time) AS first_seen,
          MAX(a.event_time) AS last_seen,
          COUNT(*) AS launches,
          COUNT(*) FILTER (WHERE a.action = 'blocked') AS blocked,
          EXISTS (
            SELECT 1 FROM public.app_whitelist_rules r
             WHERE r.endpoint_id = p_endpoint_id
               AND r.enabled
               AND ((r.match_type = 'hash'      AND r.match_value = a.sha256)
                 OR (r.match_type = 'publisher' AND r.match_value IS NOT NULL))
          ) AS whitelisted
        FROM public.app_audit_logs a
        WHERE a.endpoint_id = p_endpoint_id
          AND a.event_time >= v_audit_from
          AND a.sha256 IS NOT NULL AND length(a.sha256) > 0
        GROUP BY a.sha256
        ORDER BY MAX(a.event_time) DESC NULLS LAST
        LIMIT 500
      ) o;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id',          r.id,
              'match_type',  r.match_type,
              'match_value', r.match_value,
              'app_name',    r.app_name,
              'publisher',   r.publisher,
              'file_path',   r.file_path,
              'sha256',      r.sha256,
              'enabled',     r.enabled,
              'created_at',  r.created_at
           ) ORDER BY r.created_at DESC), '[]'::jsonb)
      INTO v_rules
      FROM public.app_whitelist_rules r
     WHERE r.endpoint_id = p_endpoint_id;

    RETURN jsonb_build_object(
      'endpoint_id',        p_endpoint_id,
      'mode',               COALESCE(v_state_row.mode, 'idle'),
      'audit_started_at',   v_state_row.audit_started_at,
      'enforce_started_at', v_state_row.enforce_started_at,
      'observed',           COALESCE(v_observed, '[]'::jsonb),
      'rules',              COALESCE(v_rules,    '[]'::jsonb)
    );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_endpoint_app_whitelist(uuid) TO authenticated;
