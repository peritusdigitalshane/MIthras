-- Step 1: Remove existing duplicate event logs, keeping only the earliest inserted row
DELETE FROM public.endpoint_event_logs
WHERE id NOT IN (
  SELECT DISTINCT ON (endpoint_id, event_id, event_time) id
  FROM public.endpoint_event_logs
  ORDER BY endpoint_id, event_id, event_time, created_at ASC
);

-- Step 2: Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX idx_endpoint_event_logs_dedup 
ON public.endpoint_event_logs (endpoint_id, event_id, event_time);
