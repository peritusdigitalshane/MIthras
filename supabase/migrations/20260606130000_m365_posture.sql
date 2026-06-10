-- 20260606130000_m365_posture.sql
--
-- M365 Security Posture engine. Sits next to the existing M365 ITDR tables
-- (m365_sign_in_events, m365_audit_events, etc.) and adds CIS-aligned
-- configuration auditing. Polls Microsoft Graph for ~8 high-signal controls
-- on a daily cron, stores a snapshot + per-control finding, then feeds the
-- snapshot into an AI advisor for plain-English fix plans.
--
-- Tables:
--   m365_posture_controls   — control catalogue (seeded statically)
--   m365_posture_snapshots  — one row per scan run per tenant
--   m365_posture_findings   — one row per control per snapshot
--   m365_posture_advice     — Claude-generated fix plans (optional, on-demand)

-- 1. Control catalogue -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m365_posture_controls (
    control_id          text PRIMARY KEY,
    category            text NOT NULL CHECK (category IN
        ('identity', 'email', 'data', 'apps', 'governance')),
    title               text NOT NULL,
    description         text NOT NULL,
    weight              integer NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
    cis_reference       text,
    remediation_url     text,
    remediation_steps   jsonb NOT NULL DEFAULT '[]'::jsonb,
    impact_if_failed    text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.m365_posture_controls IS
'Catalogue of M365 security controls Mithras audits. Seeded statically — additions
are platform-wide. Each control maps to one Graph API check in m365-posture-scan.';

-- Seed the v1 control set. 8 controls covering identity / apps / data.
-- Weight is 1-10; sum across an org's controls is the basis for overall score.
INSERT INTO public.m365_posture_controls
    (control_id, category, title, description, weight, cis_reference, remediation_url, impact_if_failed, remediation_steps)
VALUES
    -- IDENTITY -----------------------------------------------------------
    ('identity.mfa_coverage', 'identity',
     'MFA registration coverage',
     'Percentage of users with at least one MFA method registered. SMBs should be >95%.',
     10,
     'CIS M365 1.1.1',
     'https://learn.microsoft.com/en-us/microsoft-365/admin/security-and-compliance/multi-factor-authentication-microsoft-365',
     'Accounts without MFA are the #1 entry point for business email compromise (BEC). One stolen password = full inbox + lateral movement.',
     '[
       {"step": "Open Microsoft Entra admin centre → Identity → Users → Per-user MFA"},
       {"step": "Filter to users showing \"Disabled\" — these are the holdouts"},
       {"step": "Bulk-enable, then have each user run through the MFA setup at their next sign-in"},
       {"step": "Better: enforce a Conditional Access policy requiring MFA for all users (eliminates per-user toggles)"}
     ]'::jsonb),

    ('identity.legacy_auth_blocked', 'identity',
     'Legacy authentication blocked',
     'Protocols like POP, IMAP, SMTP basic auth bypass MFA. A Conditional Access policy must block them.',
     9,
     'CIS M365 1.1.2',
     'https://learn.microsoft.com/en-us/azure/active-directory/conditional-access/block-legacy-authentication',
     'Legacy auth disables MFA entirely. Even if you have MFA on, a 2018 IMAP client can sign in with just a password.',
     '[
       {"step": "Microsoft Entra → Protect → Conditional Access → New policy"},
       {"step": "Name: \"Block legacy authentication\""},
       {"step": "Assignments → Users: All users · Cloud apps: All cloud apps"},
       {"step": "Conditions → Client apps → Yes → tick \"Exchange ActiveSync clients\" + \"Other clients\""},
       {"step": "Access controls → Block access → Save with state \"On\""}
     ]'::jsonb),

    ('identity.global_admin_count', 'identity',
     'Global administrator count',
     'Number of accounts holding the Global Administrator role. Best practice is 2-5 (one break-glass, 1-4 admins).',
     8,
     'CIS M365 1.1.3',
     'https://learn.microsoft.com/en-us/azure/active-directory/roles/permissions-reference#global-administrator',
     'Excess global admins multiplies the blast radius of a single compromised credential. Microsoft recommends limiting to 4 plus one cloud-only break-glass account.',
     '[
       {"step": "Entra admin centre → Roles & admins → Global Administrator"},
       {"step": "Review the list — remove anyone who doesn''t actively need it (most can move to lesser roles like Exchange Admin or User Admin)"},
       {"step": "Keep one cloud-only break-glass account with a long random password and no MFA gate (documented securely)"},
       {"step": "Enable PIM (Privileged Identity Management) for time-bound role assignments"}
     ]'::jsonb),

    ('identity.guest_user_sprawl', 'identity',
     'Guest user sprawl review',
     'Count of guest users; flag if any are stale (no sign-in in 90+ days).',
     6,
     'CIS M365 1.4.1',
     'https://learn.microsoft.com/en-us/azure/active-directory/external-identities/users-restrict-guest-permissions',
     'Stale guest accounts retain access to shared documents and Teams channels. They''re also a common phishing target since they''re rarely monitored.',
     '[
       {"step": "Entra → External Identities → All users (filter: User type = Guest)"},
       {"step": "Sort by last sign-in date; review anything older than 90 days"},
       {"step": "Remove guests who no longer need access (Entra also auto-suggests these via Access Reviews)"},
       {"step": "Restrict guest permissions in External Identities → External collaboration settings"}
     ]'::jsonb),

    -- APPS ---------------------------------------------------------------
    ('apps.user_consent_disabled', 'apps',
     'Block user app consent',
     'Users should not be able to consent to third-party apps. All consent should route through an admin approval workflow.',
     9,
     'CIS M365 5.1.5',
     'https://learn.microsoft.com/en-us/azure/active-directory/manage-apps/configure-user-consent',
     'OAuth phishing (a malicious app requesting Mail.Read access) is the most under-defended attack vector in M365. Users will click "Accept" — the only defense is to remove that ability.',
     '[
       {"step": "Entra → Enterprise applications → Consent and permissions"},
       {"step": "User consent settings → \"Do not allow user consent\""},
       {"step": "Enable the admin consent request workflow → users get a Request-consent button → email goes to a reviewer queue"},
       {"step": "Assign Cloud Application Administrators to triage the queue"}
     ]'::jsonb),

    ('apps.risky_oauth_grants', 'apps',
     'High-risk OAuth grants',
     'Third-party apps with high-privilege scopes (Mail.ReadWrite, Files.Read.All, etc.) granted by users or admins.',
     8,
     'CIS M365 5.1.6',
     'https://learn.microsoft.com/en-us/azure/active-directory/manage-apps/configure-user-consent',
     'A single risky OAuth grant can give an attacker persistent access to every user''s inbox, calendar, or files — and survives password resets.',
     '[
       {"step": "Entra → Enterprise applications → All applications"},
       {"step": "Filter to apps with admin consent or check the OAuth permissions tab for high-risk scopes"},
       {"step": "For each app: confirm the vendor is legitimate, the scope is necessary, and an active business need exists"},
       {"step": "Revoke the grant if there''s any doubt — the user can re-request with admin approval"}
     ]'::jsonb),

    -- DATA ---------------------------------------------------------------
    ('data.sharepoint_external_sharing', 'data',
     'SharePoint external sharing posture',
     'Tenant-level external sharing should be no more permissive than "New and existing guests" (not "Anyone").',
     7,
     'CIS M365 3.2.1',
     'https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off',
     'When sharing is set to "Anyone", anyone with a link (or who guesses one) can access content. Leaks happen via inadvertent forwards and search-engine indexing.',
     '[
       {"step": "SharePoint admin centre → Policies → Sharing"},
       {"step": "External sharing → SharePoint slider → set to \"New and existing guests\" or stricter"},
       {"step": "OneDrive slider → set to same level or stricter"},
       {"step": "Optionally: limit external sharing to specific domains for tighter B2B control"}
     ]'::jsonb),

    -- GOVERNANCE ---------------------------------------------------------
    ('governance.secure_score', 'governance',
     'Microsoft Secure Score',
     'Microsoft''s own posture score (0-100) summarising identity / data / device / apps controls. Target ≥75%.',
     5,
     NULL,
     'https://security.microsoft.com/securescore',
     'Secure Score is Microsoft''s aggregate benchmark. A low score signals systemic mis-configuration that''ll fail an audit or insurance review.',
     '[
       {"step": "Security admin centre → Microsoft Secure Score"},
       {"step": "Review the \"Improvement actions\" tab — actions are pre-prioritised by impact"},
       {"step": "Walk through the top 5 highest-impact items; many are 1-click wins"},
       {"step": "Track progress weekly; aim for a 5-point monthly gain"}
     ]'::jsonb)
ON CONFLICT (control_id) DO NOTHING;

-- 2. Snapshots --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m365_posture_snapshots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id      uuid NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    scanned_at          timestamptz NOT NULL DEFAULT now(),
    overall_score       integer,        -- 0-100, weighted across controls
    secure_score        integer,        -- 0-100, Microsoft's own
    secure_score_max    integer,
    pass_count          integer NOT NULL DEFAULT 0,
    warn_count          integer NOT NULL DEFAULT 0,
    fail_count          integer NOT NULL DEFAULT 0,
    error_count         integer NOT NULL DEFAULT 0,
    scan_duration_ms    integer,
    scan_error          text,            -- non-null if the scan itself failed before producing findings
    triggered_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL  -- null = cron
);
CREATE INDEX IF NOT EXISTS idx_m365_posture_snapshots_org_time
    ON public.m365_posture_snapshots(organization_id, scanned_at DESC);

ALTER TABLE public.m365_posture_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY m365_posture_snapshots_select ON public.m365_posture_snapshots
    FOR SELECT USING (
           public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- 3. Findings ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m365_posture_findings (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id     uuid NOT NULL REFERENCES public.m365_posture_snapshots(id) ON DELETE CASCADE,
    control_id      text NOT NULL REFERENCES public.m365_posture_controls(control_id),
    status          text NOT NULL CHECK (status IN ('pass', 'warn', 'fail', 'error', 'skipped')),
    score           integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    details         jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_message   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (snapshot_id, control_id)
);
CREATE INDEX IF NOT EXISTS idx_m365_posture_findings_snapshot
    ON public.m365_posture_findings(snapshot_id);

ALTER TABLE public.m365_posture_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY m365_posture_findings_select ON public.m365_posture_findings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.m365_posture_snapshots s
             WHERE s.id = snapshot_id
               AND (
                       public.is_super_admin(auth.uid())
                    OR public.is_member_of_org(auth.uid(), s.organization_id)
                    OR public.is_partner_admin_of_org(auth.uid(), s.organization_id)
                   )
        )
    );

-- 4. Claude-generated advice (optional, on-demand) -------------------------
CREATE TABLE IF NOT EXISTS public.m365_posture_advice (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id     uuid NOT NULL UNIQUE REFERENCES public.m365_posture_snapshots(id) ON DELETE CASCADE,
    generated_at    timestamptz NOT NULL DEFAULT now(),
    model           text,
    cost_cents      integer,
    latency_ms      integer,
    -- The structured response: { summary, top_actions: [{control_id, why, steps, est_minutes}], shoutouts: [...] }
    payload         jsonb NOT NULL,
    requested_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.m365_posture_advice ENABLE ROW LEVEL SECURITY;
CREATE POLICY m365_posture_advice_select ON public.m365_posture_advice
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.m365_posture_snapshots s
             WHERE s.id = snapshot_id
               AND (
                       public.is_super_admin(auth.uid())
                    OR public.is_member_of_org(auth.uid(), s.organization_id)
                    OR public.is_partner_admin_of_org(auth.uid(), s.organization_id)
                   )
        )
    );

-- 5. RPC: latest snapshot + findings for an org ----------------------------
CREATE OR REPLACE FUNCTION public.get_latest_m365_posture(_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    snap   public.m365_posture_snapshots%ROWTYPE;
    out    jsonb;
BEGIN
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_member_of_org(auth.uid(), _organization_id)
            OR public.is_partner_admin_of_org(auth.uid(), _organization_id)) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT * INTO snap
      FROM public.m365_posture_snapshots
     WHERE organization_id = _organization_id
     ORDER BY scanned_at DESC
     LIMIT 1;

    IF snap.id IS NULL THEN
        RETURN jsonb_build_object('snapshot', NULL, 'findings', '[]'::jsonb, 'advice', NULL);
    END IF;

    out := jsonb_build_object(
        'snapshot', to_jsonb(snap),
        'findings', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'finding',  to_jsonb(f),
                    'control',  to_jsonb(c)
                )
                ORDER BY c.weight DESC, f.score ASC
            ), '[]'::jsonb)
              FROM public.m365_posture_findings f
              JOIN public.m365_posture_controls c ON c.control_id = f.control_id
             WHERE f.snapshot_id = snap.id
        ),
        'advice', (SELECT to_jsonb(a) FROM public.m365_posture_advice a WHERE a.snapshot_id = snap.id)
    );

    RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_latest_m365_posture(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_m365_posture(uuid) TO authenticated, service_role;

-- 6. RPC: trend of overall scores over time -------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_posture_trend(_organization_id uuid, _days integer DEFAULT 30)
RETURNS TABLE (
    scanned_at    timestamptz,
    overall_score integer,
    secure_score  integer,
    fail_count    integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_member_of_org(auth.uid(), _organization_id)
            OR public.is_partner_admin_of_org(auth.uid(), _organization_id)) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    IF _days IS NULL OR _days <= 0 OR _days > 365 THEN _days := 30; END IF;

    RETURN QUERY
    SELECT s.scanned_at, s.overall_score, s.secure_score, s.fail_count
      FROM public.m365_posture_snapshots s
     WHERE s.organization_id = _organization_id
       AND s.scanned_at > now() - (_days || ' days')::interval
     ORDER BY s.scanned_at ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_m365_posture_trend(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_m365_posture_trend(uuid, integer) TO authenticated, service_role;
