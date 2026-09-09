-- First, delete duplicate endpoint_threats keeping only the most recent entry per endpoint_id+threat_id
DELETE FROM endpoint_threats
WHERE id NOT IN (
  SELECT DISTINCT ON (endpoint_id, threat_id) id
  FROM endpoint_threats
  ORDER BY endpoint_id, threat_id, created_at DESC
);

-- Add a unique constraint to prevent future duplicates
ALTER TABLE endpoint_threats
ADD CONSTRAINT endpoint_threats_endpoint_id_threat_id_unique 
UNIQUE (endpoint_id, threat_id);