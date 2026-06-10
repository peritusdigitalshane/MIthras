-- One row per (endpoint, CVE, software) to make the AI scan upsert idempotent.
-- The combination is the natural key for a "this endpoint has this CVE in this
-- software" finding; multiple scans should refresh the existing row, not pile
-- new ones up.

-- First clean up any pre-existing duplicates (just in case the legacy
-- vulnerability-scan ever produced them) so the unique index can be created.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY endpoint_id, cve_id, affected_software
             ORDER BY created_at DESC
           ) AS rn
    FROM public.vulnerability_findings
)
DELETE FROM public.vulnerability_findings
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vuln_findings_endpoint_cve_software
    ON public.vulnerability_findings (endpoint_id, cve_id, affected_software);

COMMENT ON INDEX public.uq_vuln_findings_endpoint_cve_software IS
'Natural key for vulnerability_findings; used by cve-auto-scan upsert onConflict.';
