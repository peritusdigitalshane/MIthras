# Mithras AI SOC Orchestration Worker

A tiny Deno process that polls Postgres for un-orchestrated alerts and runs
the multi-agent SOC chain to completion. Replaces the `ai-soc-orchestrate-pending`
pg_cron job whose pg_net calls were being cut short by the Supabase
edge-functions runtime mid-chain (Triage's verdict landed, but Verification +
Adversarial + Comms never ran).

## Why a separate container

The worker has to be able to keep an HTTP connection to the orchestrator open
for the full duration of the multi-agent chain — 30–90s depending on agent
mix. pg_net + Supabase edge runtime on this build cuts it at ~5s, killing the
orchestrator isolate before it completes. A standalone container with plain
`fetch()` doesn't hit that constraint.

## Topology

```
+---------------+         +---------------+        +-----------+
| supabase-db   |<--+     |  worker       |        |  edge     |
|  pg + cron    |   +---->| (this image)  |+------>| functions |
|               |     polls               |  POST  | (orch)    |
+---------------+     alerts              | wait=true         |
                       +-----------------+        +-----------+
```

All three containers live in the `supabase_default` docker network so the
worker resolves `supabase-edge-functions:9000` and `supabase-rest:3000`
directly (no Kong, no pg_net).

## Setup (on docker02)

The deploy script `deploy.sh` handles everything:

```bash
cd /opt/peritus-ai-soc-worker
./deploy.sh
```

That:

1. Copies `.env` template if missing and prompts for the three required
   values (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_SOC_POLL_SECRET).
2. `docker compose build`
3. `docker compose up -d`
4. Tails logs for 10 seconds so you can see the first poll cycle.

## Environment knobs

| Variable                     | Default                                                  | Notes                                                          |
|------------------------------|----------------------------------------------------------|----------------------------------------------------------------|
| `SUPABASE_URL`               | (required)                                               | Use `http://supabase-kong:8000` inside the docker network.     |
| `SUPABASE_SERVICE_ROLE_KEY`  | (required)                                               | Read-only access to alerts + ai_triage_decisions is enough.    |
| `AI_SOC_POLL_SECRET`         | (required)                                               | Must match `platform_settings.ai_soc_poll_secret`.             |
| `ORCH_URL`                   | `http://supabase-kong:8000/functions/v1/ai-soc-orchestrate` | Path to the orchestrator via Kong (port 9000 direct path is flaky on this build). |
| `POLL_INTERVAL_MS`           | `15000`                                                  | Time between cycles.                                           |
| `MAX_PER_CYCLE`              | `3`                                                      | Max alerts to orchestrate per cycle (cost cap).                |
| `ORCH_TIMEOUT_MS`            | `180000`                                                 | Per-alert orchestrator HTTP timeout. Three LLM agents = ~30s.  |
| `ALERT_LOOKBACK_MIN`         | `60`                                                     | Only orchestrate alerts created within this window.            |

## Operations

```bash
# tail logs
docker compose logs -f --tail 50

# restart (graceful — finishes the current in-flight cycle first)
docker compose restart

# stop + remove the container
docker compose down

# force re-run by deleting an alert's ai_triage_decisions row
# (the worker will pick it up on the next cycle within the lookback window)
```

## What can go wrong

| Symptom                                                | Likely cause                                                      | Fix                                                                      |
|--------------------------------------------------------|-------------------------------------------------------------------|--------------------------------------------------------------------------|
| Worker logs `FATAL: SUPABASE_URL + ...`                | Missing env in `.env`                                              | Copy `.env.example` → `.env`, fill the three required values, restart.   |
| Worker logs `findPending: <error>`                     | Service-role key is wrong or expired                              | Verify with `select * from organizations limit 1` using the same JWT.    |
| `alert <id> -> 403`                                    | `AI_SOC_POLL_SECRET` doesn't match `platform_settings`            | Sync the value.                                                          |
| `alert <id> -> 500 InvalidWorkerCreation`              | One of the edge function isolates is broken (separate issue)      | Restart `supabase-edge-functions` container.                             |
| `alert <id> fetch failed: timeout`                     | Orchestrator hung for >`ORCH_TIMEOUT_MS`                          | Bump the env var, or investigate the slow agent in `ai_llm_calls`.       |
