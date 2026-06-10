-- Followup to rec #7: endpoint_microseg_enforce uses ON CONFLICT DO NOTHING
-- to make re-Enforce idempotent, but firewall_service_rules has no unique
-- constraint on the natural identity (policy_id, endpoint_group_id, port,
-- protocol, direction). The result: every Enforce call duplicated the rule
-- set (verified in PoC test 3 — 173 rules became 346 on the second call).
--
-- Add a unique index over the natural identity so ON CONFLICT actually
-- short-circuits the duplicate insert. Existing duplicates are de-duped
-- first (keep the oldest row per group).

-- 1. Dedup existing rows. Keep the oldest row per natural-identity bucket.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY policy_id, endpoint_group_id, port, lower(protocol), direction
               ORDER BY created_at ASC, id ASC
           ) AS rn
      FROM public.firewall_service_rules
)
DELETE FROM public.firewall_service_rules fsr
 USING ranked r
 WHERE fsr.id = r.id
   AND r.rn > 1;

-- 2. Natural unique. Partial (excludes the synthetic id PK) but global across
--    modes — block + allow on the same port shouldn't co-exist in one rule set.
CREATE UNIQUE INDEX IF NOT EXISTS uq_firewall_service_rules_natural
    ON public.firewall_service_rules (policy_id, endpoint_group_id, port, lower(protocol), direction);

COMMENT ON INDEX public.uq_firewall_service_rules_natural IS
'Natural identity for a firewall rule: same policy + group + port + protocol + direction = same rule. Enables ON CONFLICT DO NOTHING in microseg enforce.';
