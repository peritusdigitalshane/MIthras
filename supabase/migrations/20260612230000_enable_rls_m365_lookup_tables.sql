-- =====================================================================
-- Close the two RLS findings flagged by ai-platform-health-scan.
--
-- m365_posture_controls is the global catalogue of Microsoft 365 posture
-- controls (CIS references, weights, remediation steps). It contains no
-- customer data; every authenticated session should be able to read it.
--
-- m365_detection_dedup is a global suppression map keyed by detection
-- fingerprint. Reads are platform-internal; writes are service-role.
-- =====================================================================

ALTER TABLE public.m365_posture_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "m365_posture_controls_authenticated_read"
    ON public.m365_posture_controls
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "m365_posture_controls_service_write"
    ON public.m365_posture_controls
    FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);

ALTER TABLE public.m365_detection_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "m365_detection_dedup_service_only"
    ON public.m365_detection_dedup
    FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);
