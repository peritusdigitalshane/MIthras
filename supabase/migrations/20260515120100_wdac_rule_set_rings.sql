-- 20260515120100_wdac_rule_set_rings.sql
-- Per-(rule_set, endpoint_group) mode override. Allows ring-by-ring promotion
-- from audit → enforce without affecting the whole rule set at once.

CREATE TABLE IF NOT EXISTS public.wdac_rule_set_rings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id uuid NOT NULL REFERENCES public.wdac_rule_sets(id)    ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.endpoint_groups(id)   ON DELETE CASCADE,
  mode        text NOT NULL CHECK (mode IN ('audit','enforce','off')),
  ring_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_wdac_rule_set_rings_rule_set ON public.wdac_rule_set_rings(rule_set_id);
CREATE INDEX IF NOT EXISTS idx_wdac_rule_set_rings_group    ON public.wdac_rule_set_rings(group_id);

ALTER TABLE public.wdac_rule_set_rings ENABLE ROW LEVEL SECURITY;

-- Members of the org can read rings for their org's rule sets.
CREATE POLICY "Members read rings"
  ON public.wdac_rule_set_rings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.wdac_rule_sets rs
    WHERE rs.id = wdac_rule_set_rings.rule_set_id
      AND public.is_member_of_org(auth.uid(), rs.organization_id)
  ));

-- Admins can manage rings.
CREATE POLICY "Admins manage rings"
  ON public.wdac_rule_set_rings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.wdac_rule_sets rs
    WHERE rs.id = wdac_rule_set_rings.rule_set_id
      AND public.is_admin_of_org(auth.uid(), rs.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.wdac_rule_sets rs
    WHERE rs.id = wdac_rule_set_rings.rule_set_id
      AND public.is_admin_of_org(auth.uid(), rs.organization_id)
  ));

-- Super admins have full access.
CREATE POLICY "Super admins manage rings"
  ON public.wdac_rule_set_rings FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
