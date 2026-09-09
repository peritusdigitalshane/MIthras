-- 20260617010000_email_campaign_grouping.sql
--
-- Cross-mailbox sweep on detection (closes a Tier-1 Abnormal gap).
--
-- Campaign-style phishing blasts the same message to many mailboxes in a
-- tenant. Without grouping, the operator has to quarantine each of the 50
-- mailbox-specific threat rows by hand, and any mailbox that received the
-- blast but the operator hasn't looked at yet stays delivered.
--
-- This migration links sibling threats so a single operator action (or AI
-- auto-action) can quarantine every copy of the same message tenant-wide.
--
-- Grouping key is `(m365_tenant_id, internet_message_id)`:
--   * internet_message_id  — the RFC 5322 Message-ID header. Identical
--                            across every mailbox that received the same
--                            send. Set by the sender's outbound MTA;
--                            spammers can fake it but real campaigns
--                            don't bother.
--   * m365_tenant_id       — never sweep across tenants (RLS would block
--                            anyway, but explicit scope is clearer).
--
-- parent_threat_id is set on every SIBLING threat after a sweep — points
-- back to the originating threat the operator (or AI) actioned. The
-- origin row's campaign_swept_at marks when the sweep ran.

ALTER TABLE public.email_threats
    ADD COLUMN IF NOT EXISTS internet_message_id text,
    ADD COLUMN IF NOT EXISTS parent_threat_id    uuid REFERENCES public.email_threats(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS campaign_swept_at   timestamptz;

COMMENT ON COLUMN public.email_threats.internet_message_id IS
    'RFC 5322 Message-ID header, shared across every recipient mailbox of the same outbound send. Used to find sibling threats during cross-mailbox sweep.';
COMMENT ON COLUMN public.email_threats.parent_threat_id IS
    'When this row was quarantined as part of a cross-mailbox sweep, points to the originating threat the operator/AI actioned. NULL on origin rows and on solo threats.';
COMMENT ON COLUMN public.email_threats.campaign_swept_at IS
    'Timestamp of the cross-mailbox sweep that quarantined this row. Set on both the origin and every sibling so the UI can render a "Campaign — N inboxes" badge.';

-- Fast lookup: given a tenant + message-id, find every sibling. Used on
-- every quarantine action.
CREATE INDEX IF NOT EXISTS idx_email_threats_tenant_msgid
    ON public.email_threats (m365_tenant_id, internet_message_id)
    WHERE internet_message_id IS NOT NULL;

-- Inverse lookup for the UI: count children of a campaign origin.
CREATE INDEX IF NOT EXISTS idx_email_threats_parent
    ON public.email_threats (parent_threat_id)
    WHERE parent_threat_id IS NOT NULL;
