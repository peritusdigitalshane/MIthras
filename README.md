# Peritus Endpoint Guardian

Endpoint security platform: Windows Defender management, CVE tracking, agent telemetry, AI security advisor.

## Stack

- **Frontend:** Vite + React + TypeScript + shadcn/ui + Tailwind CSS
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions)
- **Deployment:** Docker + Nginx (frontend); self-hosted Supabase on Linux (backend, in progress)

## Local development

```sh
# 1. Install deps
npm install --legacy-peer-deps

# 2. Configure env
cp .env.example .env.local
# Edit .env.local — fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Run dev server (http://localhost:8080)
npm run dev
```

## Builds

| Command | Mode | Reads | Use |
|---|---|---|---|
| `npm run build` | production | `.env.production` | Cloud-pointed production bundle |
| `npm run build:staging` | staging | `.env.staging` | Self-hosted-pointed bundle |
| `npm run build:dev` | development | `.env.development` (optional) | Dev build (unminified) |

## Docker

```sh
# Production (port 9988, cloud Supabase)
docker compose up -d peritus-secure

# Staging (port 9989, self-hosted Supabase)
docker compose --profile staging up -d peritus-secure-staging
```

The staging service reads `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` from the host environment or a `.env` file alongside `docker-compose.yml`.

## Tests

- `npm run test` — unit tests (Vitest)
- `npm run test:integration` — integration tests against `SUPABASE_TEST_URL` (added in a later plan)

## Documentation

See [`CLAUDE.md`](./CLAUDE.md) for architecture, workflows, and development conventions.
Design specs live under [`docs/superpowers/specs/`](./docs/superpowers/specs/).
Implementation plans live under [`docs/superpowers/plans/`](./docs/superpowers/plans/).
