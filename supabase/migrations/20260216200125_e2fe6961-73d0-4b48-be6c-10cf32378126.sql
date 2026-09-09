
-- Seed initial uptime log for routers that exist but have no uptime logs
INSERT INTO public.router_uptime_logs (router_id, organization_id, event_type, event_time)
SELECT r.id, r.organization_id, 
  CASE WHEN r.is_online THEN 'online' ELSE 'offline' END,
  COALESCE(r.last_seen_at, r.created_at)
FROM routers r
LEFT JOIN router_uptime_logs ul ON ul.router_id = r.id
WHERE ul.id IS NULL;

-- Drop and recreate the function
DROP FUNCTION IF EXISTS public.get_router_uptime_stats(uuid, integer);

CREATE FUNCTION public.get_router_uptime_stats(_router_id uuid, _days integer DEFAULT 30)
RETURNS TABLE(
  uptime_percent numeric,
  total_downtime_minutes numeric,
  last_offline_at timestamptz,
  last_online_at timestamptz,
  current_session_start timestamptz
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _window_start timestamptz := now() - (_days || ' days')::interval;
  _now          timestamptz := now();
  _total_mins   numeric     := _days * 1440;
  _down_mins    numeric     := 0;
  _prev_time    timestamptz;
  _prev_type    text;
  _is_online    boolean;
  _last_off     timestamptz;
  _last_on      timestamptz;
  _sess_start   timestamptz;
  _rec          record;
  _has_logs     boolean     := false;
BEGIN
  SELECT r.is_online INTO _is_online FROM routers r WHERE r.id = _router_id;

  FOR _rec IN
    SELECT event_type, event_time
    FROM router_uptime_logs
    WHERE router_id = _router_id AND event_time >= _window_start
    ORDER BY event_time
  LOOP
    _has_logs := true;
    IF _prev_time IS NULL THEN
      IF _rec.event_type = 'online' THEN
        _down_mins := _down_mins + EXTRACT(EPOCH FROM (_rec.event_time - _window_start)) / 60;
      END IF;
    ELSE
      IF _rec.event_type = 'online' AND _prev_type = 'offline' THEN
        _down_mins := _down_mins + EXTRACT(EPOCH FROM (_rec.event_time - _prev_time)) / 60;
      END IF;
    END IF;
    IF _rec.event_type = 'offline' THEN _last_off := _rec.event_time; END IF;
    IF _rec.event_type = 'online'  THEN _last_on  := _rec.event_time; END IF;
    _prev_time := _rec.event_time;
    _prev_type := _rec.event_type;
  END LOOP;

  IF NOT _has_logs THEN
    IF _is_online THEN _down_mins := 0; ELSE _down_mins := _total_mins; END IF;
  ELSE
    IF _prev_type = 'offline' THEN
      _down_mins := _down_mins + EXTRACT(EPOCH FROM (_now - _prev_time)) / 60;
    END IF;
  END IF;

  IF _is_online THEN
    SELECT event_time INTO _sess_start
    FROM router_uptime_logs
    WHERE router_id = _router_id AND event_type = 'online'
    ORDER BY event_time DESC LIMIT 1;
  END IF;

  uptime_percent       := ROUND(GREATEST(0, (_total_mins - _down_mins) / _total_mins * 100), 2);
  total_downtime_minutes := ROUND(GREATEST(0, _down_mins), 0);
  last_offline_at      := _last_off;
  last_online_at       := _last_on;
  current_session_start := _sess_start;
  RETURN NEXT;
END;
$$;
