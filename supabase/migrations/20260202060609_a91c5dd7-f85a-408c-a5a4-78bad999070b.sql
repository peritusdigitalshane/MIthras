-- Add agent_version column to track which version of the agent each endpoint is running
ALTER TABLE public.endpoints ADD COLUMN agent_version TEXT;