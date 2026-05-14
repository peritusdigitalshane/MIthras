-- Phase 1: agent_versions — signed manifest of agent binary releases.
-- Edge function agent-version-check returns the latest active row for the agent's runtime + channel.

CREATE TABLE public.agent_versions (
    version          text NOT NULL,
    runtime          text NOT NULL CHECK (runtime IN ('powershell', 'dotnet')),
    channel          text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta', 'canary')),
    download_url     text NOT NULL,
    sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    ed25519_sig      text NOT NULL,
    min_os_version   text,
    is_active        boolean NOT NULL DEFAULT true,
    published_at     timestamptz NOT NULL DEFAULT now(),
    published_by     uuid REFERENCES auth.users(id),
    release_notes    text,
    PRIMARY KEY (version, runtime, channel)
);

CREATE INDEX idx_agent_versions_lookup
    ON public.agent_versions(runtime, channel, published_at DESC)
    WHERE is_active = true;

ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read all active versions (so console can show release history).
CREATE POLICY agent_versions_select ON public.agent_versions
    FOR SELECT TO authenticated
    USING (true);

-- Only service role (edge functions, CI) may insert. No update/delete from clients.
COMMENT ON TABLE public.agent_versions IS
    'Signed binary release manifest. ed25519_sig is base64 of the Ed25519 signature over sha256. Public key baked into every agent binary.';
