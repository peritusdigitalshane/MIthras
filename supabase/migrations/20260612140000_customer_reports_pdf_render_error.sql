-- =============================================================================
-- customer_reports.pdf_render_error
--
-- PDF rendering errors in generate-customer-report were caught and only
-- console.error'd, never persisted (see processQueuedRow line ~430 — the
-- `catch (pdfErr)` block sets pdfBytes/pdfPath to null and moves on). Result:
-- rows landed at status='ready' with pdf_storage_path=NULL and no audit trail
-- of why the PDF was missing. The retry-send cron and the operator dashboard
-- both have no signal that PDF generation actually failed; the row looks like
-- "succeeded, but no recipients" — indistinguishable from a config issue.
--
-- This column captures the render/upload error so operators can see what
-- went wrong without grepping function logs.
-- =============================================================================

ALTER TABLE public.customer_reports
    ADD COLUMN IF NOT EXISTS pdf_render_error text;

COMMENT ON COLUMN public.customer_reports.pdf_render_error IS
    'PDF rendering or storage upload error message. Null if PDF succeeded or no PDF was attempted (site reports are HTML-only).';
