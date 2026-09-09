-- Add mode column to wdac_rule_sets (defaults to audit for safety)
ALTER TABLE public.wdac_rule_sets 
ADD COLUMN mode text NOT NULL DEFAULT 'audit' 
CHECK (mode IN ('audit', 'enforced'));