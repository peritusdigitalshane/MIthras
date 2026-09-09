
-- Track router state changes for uptime/downtime calculation
CREATE TABLE public.router_uptime_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  router_id UUID NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('online', 'offline')),
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_router_uptime_logs_router ON public.router_uptime_logs(router_id, event_time DESC);
CREATE INDEX idx_router_uptime_logs_org ON public.router_uptime_logs(organization_id);

ALTER TABLE public.router_uptime_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view router uptime logs"
ON public.router_uptime_logs FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "System can insert router uptime logs"
ON public.router_uptime_logs FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
);

-- Function to automatically log state changes when router is_online changes
CREATE OR REPLACE FUNCTION public.log_router_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.is_online IS DISTINCT FROM NEW.is_online THEN
    INSERT INTO public.router_uptime_logs (router_id, organization_id, event_type, event_time)
    VALUES (NEW.id, NEW.organization_id, CASE WHEN NEW.is_online THEN 'online' ELSE 'offline' END, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_router_state_change
AFTER UPDATE OF is_online ON public.routers
FOR EACH ROW
EXECUTE FUNCTION public.log_router_state_change();

-- Also log initial state on router creation
CREATE OR REPLACE FUNCTION public.log_router_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.router_uptime_logs (router_id, organization_id, event_type, event_time)
  VALUES (NEW.id, NEW.organization_id, CASE WHEN NEW.is_online THEN 'online' ELSE 'offline' END, now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_router_initial_state
AFTER INSERT ON public.routers
FOR EACH ROW
EXECUTE FUNCTION public.log_router_initial_state();

-- DB function to calculate uptime stats for a router over last N days
CREATE OR REPLACE FUNCTION public.get_router_uptime_stats(
  _router_id UUID,
  _days INTEGER DEFAULT 30
)
RETURNS TABLE(
  uptime_percent NUMERIC,
  total_downtime_minutes BIGINT,
  last_offline_at TIMESTAMPTZ,
  last_online_at TIMESTAMPTZ,
  current_session_start TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  period_start TIMESTAMPTZ;
  period_end TIMESTAMPTZ;
  total_minutes NUMERIC;
  online_minutes NUMERIC := 0;
  prev_event_type TEXT;
  prev_event_time TIMESTAMPTZ;
  cur_event RECORD;
  _last_offline TIMESTAMPTZ;
  _last_online TIMESTAMPTZ;
  _session_start TIMESTAMPTZ;
  _is_online BOOLEAN;
BEGIN
  period_start := now() - (_days || ' days')::INTERVAL;
  period_end := now();
  total_minutes := EXTRACT(EPOCH FROM (period_end - period_start)) / 60.0;

  -- Get current router state
  SELECT r.is_online INTO _is_online FROM public.routers r WHERE r.id = _router_id;

  -- Find the state at period_start by looking at the last event before it
  SELECT event_type, event_time INTO prev_event_type, prev_event_time
  FROM public.router_uptime_logs
  WHERE router_id = _router_id AND event_time <= period_start
  ORDER BY event_time DESC LIMIT 1;

  -- If no event before period, assume offline from start
  IF prev_event_type IS NULL THEN
    prev_event_type := 'offline';
    prev_event_time := period_start;
  ELSE
    prev_event_time := period_start;
  END IF;

  -- Walk through events in the period
  FOR cur_event IN
    SELECT event_type, event_time
    FROM public.router_uptime_logs
    WHERE router_id = _router_id AND event_time > period_start AND event_time <= period_end
    ORDER BY event_time
  LOOP
    IF prev_event_type = 'online' THEN
      online_minutes := online_minutes + EXTRACT(EPOCH FROM (cur_event.event_time - prev_event_time)) / 60.0;
    END IF;
    prev_event_type := cur_event.event_type;
    prev_event_time := cur_event.event_time;
  END LOOP;

  -- Account for time from last event to now
  IF prev_event_type = 'online' THEN
    online_minutes := online_minutes + EXTRACT(EPOCH FROM (period_end - prev_event_time)) / 60.0;
  END IF;

  -- Get last offline/online times
  SELECT event_time INTO _last_offline
  FROM public.router_uptime_logs
  WHERE router_id = _router_id AND event_type = 'offline'
  ORDER BY event_time DESC LIMIT 1;

  SELECT event_time INTO _last_online
  FROM public.router_uptime_logs
  WHERE router_id = _router_id AND event_type = 'online'
  ORDER BY event_time DESC LIMIT 1;

  -- Current session start (last online event if currently online)
  IF _is_online THEN
    _session_start := _last_online;
  ELSE
    _session_start := NULL;
  END IF;

  RETURN QUERY SELECT
    ROUND((online_minutes / NULLIF(total_minutes, 0)) * 100, 2),
    ((total_minutes - online_minutes)::BIGINT),
    _last_offline,
    _last_online,
    _session_start;
END;
$$;
