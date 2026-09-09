-- Update existing EICAR test file threats to Low severity (they're test files)
UPDATE endpoint_threats 
SET severity = 'Low' 
WHERE severity = 'Unknown' 
AND LOWER(threat_name) LIKE '%eicar%';

-- Update any virus threats that still show Unknown to High
UPDATE endpoint_threats 
SET severity = 'High' 
WHERE severity = 'Unknown' 
AND LOWER(threat_name) LIKE 'virus:%';

-- Update ransomware/trojan/exploit threats to Severe
UPDATE endpoint_threats 
SET severity = 'Severe' 
WHERE severity = 'Unknown' 
AND (
  LOWER(threat_name) LIKE '%ransom%' 
  OR LOWER(threat_name) LIKE '%trojan%' 
  OR LOWER(threat_name) LIKE '%exploit%'
  OR LOWER(threat_name) LIKE '%backdoor%'
);