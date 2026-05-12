# Lovable Detachment + Env-Configurable Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all Lovable-specific tooling and references from the repo, and make the frontend's Supabase target build-time configurable via env vars, without changing functional behaviour for the existing cloud-pointed production build.

**Architecture:** Replace the `lovable-tagger` Vite plugin with stock Vite. Replace hardcoded Supabase URL/anon key in `src/integrations/supabase/client.ts` with `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Introduce a "staging" build mode (`vite build --mode staging`) that reads `.env.staging` so the same source produces a self-hosted-pointed bundle. Cloud values move from source code into a committed `.env.production`.

**Tech Stack:** Vite 5.4, TypeScript 5.8, React 18.3, npm, Docker.

**Companion design doc:** `docs/superpowers/specs/2026-05-12-supabase-self-host-and-workflow-design.md`

**Related plans (run order):**
1. *This plan* — repo-side detach + env-config
2. `2026-05-12-02-selfhosted-supabase-standup.md` — stand up the self-hosted instance on Linux
3. `2026-05-12-03-validation-gate-and-claude-md.md` — integration tests + CLAUDE.md

---

## File map

| File | Action | Why |
|---|---|---|
| `.gitignore` | Modify | Ignore `.env.staging` and `.env.local`, keep `.env.production` tracked |
| `.env.example` | Create | Documents all env vars |
| `.env.production` | Create | Cloud values, committed (same exposure as previously hardcoded) |
| `.env.staging.example` | Create | Template for self-hosted; user copies to `.env.staging` |
| `package.json` | Modify | Remove `lovable-tagger`, add `build:staging` script |
| `vite.config.ts` | Modify | Remove `componentTagger` plugin |
| `src/integrations/supabase/client.ts` | Modify | Read URL/key from env, throw on missing |
| `src/vite-env.d.ts` | Verify/Create | Ensure `vite/client` types are referenced |
| `README.md` | Modify | Full rewrite without Lovable refs |
| `Dockerfile` | Modify | Accept `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `BUILD_MODE` as build args |
| `docker-compose.yml` | Modify | Add staging service on `:9989` behind a Compose profile |

---

### Task 0: Disconnect Lovable's GitHub integration (manual, user-only)

The assistant cannot do this — it requires Lovable account access. **This must happen before any of the changes in this plan are pushed**, otherwise Lovable may re-push automatic edits that re-introduce removed code.

- [ ] **Step 1:** Open the Lovable project for this repo.
- [ ] **Step 2:** Project Settings → Integrations → GitHub → Disconnect.
- [ ] **Step 3:** In GitHub at `peritusdigitalshane/peritus-endpoint-guardian` → Settings → Integrations / GitHub Apps, confirm the Lovable app no longer has push access.
- [ ] **Step 4:** Tell the agent it's safe to proceed.

---

### Task 1: Baseline build (verify "before" state)

Confirms the repo builds successfully against cloud as-is. Any later breakage must be from our changes, not pre-existing.

**Files:** none

- [ ] **Step 1:** Verify clean tree.

```
git status
```

Expected: `nothing to commit, working tree clean`. (The design-doc commit `75f1114` should be the latest on `main`.)

- [ ] **Step 2:** Install dependencies.

```
npm install --legacy-peer-deps
```

Expected: completes without errors. The `--legacy-peer-deps` flag matches the project's `Dockerfile`.

- [ ] **Step 3:** Run baseline build.

```
npm run build
```

Expected: succeeds; `dist/index.html` exists.

- [ ] **Step 4:** Confirm the cloud URL is in the baseline bundle.

```
grep -l "njdcyjxgtckgtzgzoctw" dist/assets/*.js
```

Expected: at least one file listed.

No commit — this is a verification gate.

---

### Task 2: Update `.gitignore` for env files

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1:** Append env-file rules to the bottom of `.gitignore`:

```
# Env files
.env
.env.local
.env.*.local
.env.staging
```

`.env.production` is intentionally NOT ignored — it contains values previously hardcoded in source.

- [ ] **Step 2:** Verify.

```
git check-ignore -v .env.staging .env.local 2>&1
```

Expected: both reported as matched by `.gitignore`.

- [ ] **Step 3:** Commit.

```
git add .gitignore
git commit -m "chore: gitignore .env files except .env.production"
```

---

### Task 3: Create `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1:** Create `.env.example` with this content:

```
# Frontend env vars (Vite — baked into the bundle at build time)
# Copy this file to .env.local for dev, .env.staging for self-hosted builds.
# .env.production is checked in with cloud values.

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# --- Edge function secrets (NOT loaded by Vite) ----------------------------
# These are configured on the Supabase backend via `supabase secrets set` or
# the self-hosted stack's compose `.env`. Listed here for discoverability.
#
# OPENAI_API_KEY=
# VIRUSTOTAL_API_KEY=
```

- [ ] **Step 2:** Commit.

```
git add .env.example
git commit -m "chore: add .env.example documenting required vars"
```

---

### Task 4: Create `.env.production`

**Files:**
- Create: `.env.production`

- [ ] **Step 1:** Create `.env.production` with the cloud values previously hardcoded in `src/integrations/supabase/client.ts`:

```
VITE_SUPABASE_URL=https://njdcyjxgtckgtzgzoctw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qZGN5anhndGNrZ3R6Z3pvY3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMDc0NzgsImV4cCI6MjA4NDU4MzQ3OH0.Dgzlv9Wk_Mxb8I8OYttjspVimEGSWswBnWBFhlt-jBw
```

These are identical to the constants currently at `src/integrations/supabase/client.ts:5-6`, so committing them is not a new exposure — they ship to every browser already.

- [ ] **Step 2:** Commit.

```
git add .env.production
git commit -m "chore: add .env.production with current cloud values"
```

---

### Task 5: Create `.env.staging.example`

**Files:**
- Create: `.env.staging.example`

- [ ] **Step 1:** Create the template file:

```
# Copy to .env.staging and fill in your self-hosted Supabase details before
# running `npm run build:staging`. .env.staging is gitignored.
# The actual self-hosted values come from plan 2 (selfhosted-supabase-standup).

VITE_SUPABASE_URL=https://supabase.staging.example
VITE_SUPABASE_ANON_KEY=replace-with-self-hosted-anon-key
```

- [ ] **Step 2:** Commit.

```
git add .env.staging.example
git commit -m "chore: add .env.staging.example template"
```

---

### Task 6: Remove `lovable-tagger` from `package.json` + add `build:staging` script

**Files:**
- Modify: `package.json`

- [ ] **Step 1:** In `package.json`, remove this line from `devDependencies`:

```
"lovable-tagger": "^1.1.13",
```

- [ ] **Step 2:** In `package.json`, add `"build:staging"` to the `scripts` block so it reads exactly:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "build:staging": "vite build --mode staging",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

- [ ] **Step 3:** Verify no other `lovable` references in `package.json`.

```
grep -i lovable package.json
```

Expected: no output.

- [ ] **Step 4:** Update `package-lock.json`.

```
npm install --legacy-peer-deps
```

Expected: completes; the `lovable-tagger` entry should be removed from `package-lock.json`.

- [ ] **Step 5:** Confirm `lovable-tagger` is gone from the lockfile.

```
grep lovable-tagger package-lock.json
```

Expected: no output.

- [ ] **Step 6:** Commit.

```
git add package.json package-lock.json
git commit -m "build: remove lovable-tagger devDep, add build:staging script"
```

---

### Task 7: Remove `componentTagger` from `vite.config.ts`

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1:** Replace the contents of `vite.config.ts` with:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
```

Changes from the previous version:
- Removed `import { componentTagger } from "lovable-tagger"`
- Removed `mode === "development" && componentTagger()` from `plugins`
- Removed the now-unused `mode` parameter
- Removed the `.filter(Boolean)` (no conditional plugins left)

- [ ] **Step 2:** Run typecheck.

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3:** Start the dev server briefly.

```
npm run dev
```

Expected: starts and prints `Local: http://localhost:8080/`. Press Ctrl-C to stop. No need to load it in a browser yet — `client.ts` is still hardcoded at this point.

- [ ] **Step 4:** Commit.

```
git add vite.config.ts
git commit -m "build: remove lovable-tagger plugin from vite config"
```

---

### Task 8: Refactor `src/integrations/supabase/client.ts` to use env vars

**Files:**
- Modify: `src/integrations/supabase/client.ts`
- Verify/Create: `src/vite-env.d.ts`

- [ ] **Step 1:** Replace the contents of `src/integrations/supabase/client.ts` with:

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local for dev, or check your build mode .env file.'
  );
}

// Import as: import { supabase } from "@/integrations/supabase/client";
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
```

Changes:
- Removed `"This file is automatically generated. Do not edit it directly."` comment (no longer auto-generated)
- Replaced hardcoded constants with `import.meta.env.*`
- Added a runtime guard with a clear error message
- Renamed `SUPABASE_PUBLISHABLE_KEY` to `SUPABASE_ANON_KEY` (matches Supabase's standard naming and the env var)

- [ ] **Step 2:** Ensure `src/vite-env.d.ts` contains the Vite client type reference.

```
cat src/vite-env.d.ts
```

If the file exists and contains `/// <reference types="vite/client" />`, skip to Step 3.
If it exists but lacks that line, add it at the top.
If it doesn't exist, create it with this content:

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 3:** Run typecheck.

```
npx tsc --noEmit
```

Expected: no errors. (`import.meta.env.VITE_*` is typed by `vite/client`.)

- [ ] **Step 4:** Verify no remaining hardcoded cloud references in source.

```
grep -r "njdcyjxgtckgtzgzoctw" src/
```

Expected: no output.

- [ ] **Step 5:** Commit.

```
git add src/integrations/supabase/client.ts src/vite-env.d.ts
git commit -m "refactor(supabase): read URL and anon key from env vars"
```

---

### Task 9: Verify production build still works against cloud

This is the critical check. The bundle must be functionally equivalent to baseline, just sourcing its config from `.env.production`.

**Files:** none

- [ ] **Step 1:** Clean and build.

```
rm -rf dist
npm run build
```

Expected: succeeds; `dist/index.html` exists.

- [ ] **Step 2:** Confirm the cloud URL is in the bundle (sourced from `.env.production`).

```
grep -l "njdcyjxgtckgtzgzoctw.supabase.co" dist/assets/*.js
```

Expected: at least one file listed.

- [ ] **Step 3:** Confirm no `lovable-tagger` artefacts in the bundle.

```
grep -r "lovable-tagger\|data-lov-id\|data-component-name" dist/ | head
```

Expected: no output.

- [ ] **Step 4:** Spot-check the running app.

```
npm run preview
```

Open `http://localhost:4173`. Confirm in DevTools:
- App loads without console errors
- A network request to `njdcyjxgtckgtzgzoctw.supabase.co` appears

Press Ctrl-C to stop.

No commit — verification only.

---

### Task 10: Rewrite `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Replace the contents of `README.md` with:

````markdown
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

The staging service requires `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` in the host environment or a `.env` file alongside `docker-compose.yml`.

## Tests

- `npm run test` — unit tests (Vitest)
- `npm run test:integration` — integration tests against `SUPABASE_TEST_URL` (added in plan 3)

## Documentation

See [`CLAUDE.md`](./CLAUDE.md) for architecture, workflows, and development conventions.
Design specs live under [`docs/superpowers/specs/`](./docs/superpowers/specs/).
Implementation plans live under [`docs/superpowers/plans/`](./docs/superpowers/plans/).
````

- [ ] **Step 2:** Verify no Lovable references remain.

```
grep -i lovable README.md
```

Expected: no output.

- [ ] **Step 3:** Commit.

```
git add README.md
git commit -m "docs: rewrite README without Lovable references"
```

---

### Task 11: Update `Dockerfile` for build-arg env vars

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1:** Replace the contents of `Dockerfile` with:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies - copy package.json first, lock file is optional
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build args (passed via docker-compose / docker build --build-arg)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG BUILD_MODE=production

# Surface them as ENV so Vite picks them up at build time
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Build the application in the requested mode (production or staging)
RUN npm run build -- --mode $BUILD_MODE

# Production stage
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
```

Changes:
- Added `ARG VITE_SUPABASE_URL` / `ARG VITE_SUPABASE_ANON_KEY` / `ARG BUILD_MODE=production`
- Added matching `ENV` lines for the Vite vars (Vite reads from process env)
- `RUN npm run build` now passes `--mode $BUILD_MODE` so the same image recipe builds either `production` or `staging`

- [ ] **Step 2:** Test the prod-mode docker build.

```
docker build \
  --build-arg VITE_SUPABASE_URL=https://njdcyjxgtckgtzgzoctw.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY="$(grep VITE_SUPABASE_ANON_KEY .env.production | cut -d= -f2-)" \
  -t peritus-secure:test .
```

Expected: image builds successfully.

- [ ] **Step 3:** Confirm the cloud URL ended up in the served bundle.

```
docker run --rm peritus-secure:test sh -c "grep -r njdcyjxgtckgtzgzoctw /usr/share/nginx/html/assets/ | head -1"
```

Expected: at least one hit.

- [ ] **Step 4:** Clean up the test image.

```
docker rmi peritus-secure:test
```

- [ ] **Step 5:** Commit.

```
git add Dockerfile
git commit -m "build(docker): accept Supabase URL/key and build mode as args"
```

---

### Task 12: Add staging service to `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1:** Replace the contents of `docker-compose.yml` with:

```yaml
version: '3.8'

services:
  peritus-secure:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        VITE_SUPABASE_URL: ${VITE_SUPABASE_URL:-https://njdcyjxgtckgtzgzoctw.supabase.co}
        VITE_SUPABASE_ANON_KEY: ${VITE_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qZGN5anhndGNrZ3R6Z3pvY3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMDc0NzgsImV4cCI6MjA4NDU4MzQ3OH0.Dgzlv9Wk_Mxb8I8OYttjspVimEGSWswBnWBFhlt-jBw}
        BUILD_MODE: production
    container_name: peritus-secure
    ports:
      - "9988:80"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    labels:
      - "app.name=peritus-threat-defence"
      - "app.description=Peritus Threat Defence - Windows Defender Management Platform"

  peritus-secure-staging:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        VITE_SUPABASE_URL: ${STAGING_SUPABASE_URL}
        VITE_SUPABASE_ANON_KEY: ${STAGING_SUPABASE_ANON_KEY}
        BUILD_MODE: staging
    container_name: peritus-secure-staging
    profiles: ["staging"]
    ports:
      - "9989:80"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    labels:
      - "app.name=peritus-threat-defence-staging"
      - "app.description=Peritus Threat Defence (staging, self-hosted Supabase)"

  # Optional: Add Traefik for HTTPS (uncomment if needed)
  # traefik:
  #   image: traefik:v2.10
  #   container_name: traefik
  #   command:
  #     - "--api.insecure=true"
  #     - "--providers.docker=true"
  #     - "--entrypoints.web.address=:80"
  #     - "--entrypoints.websecure.address=:443"
  #     - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
  #     - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
  #     - "--certificatesresolvers.letsencrypt.acme.email=your-email@example.com"
  #     - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
  #   ports:
  #     - "80:80"
  #     - "443:443"
  #   volumes:
  #     - "/var/run/docker.sock:/var/run/docker.sock:ro"
  #     - "./letsencrypt:/letsencrypt"
```

Notes:
- The prod service preserves prior defaults via `${VAR:-default}` so plain `docker compose up` is unchanged
- The staging service is gated by a Compose `profile`, so `docker compose up -d` won't accidentally start it. Start it with `docker compose --profile staging up -d peritus-secure-staging`
- `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` are read from the host env / a sidecar `.env` file at deploy time (plan 2 supplies the real values)

- [ ] **Step 2:** Verify the YAML resolves.

```
docker compose config
```

Expected: prints the resolved config. Warnings about unset `STAGING_*` variables are OK — staging isn't runnable until plan 2 lands.

- [ ] **Step 3:** Commit.

```
git add docker-compose.yml
git commit -m "build(docker): add staging service on :9989 behind staging profile"
```

---

### Task 13: Final no-Lovable check and push

**Files:** none

- [ ] **Step 1:** Grep the repo for any remaining Lovable references in non-doc files.

```
grep -ri "lovable" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude=*.md
```

Expected: no output. (Markdown is excluded — design docs and historical references in `docs/` are intentional.)

- [ ] **Step 2:** Confirm Markdown hits are only contextual, not instructional.

```
grep -ri "lovable" docs/ README.md 2>/dev/null
```

Expected: only the design doc and historical references; no instructions telling future developers to use Lovable.

- [ ] **Step 3:** Verify the final build still works.

```
rm -rf dist
npm run build
grep -l "njdcyjxgtckgtzgzoctw" dist/assets/*.js
```

Expected: build succeeds, cloud URL present in the bundle.

- [ ] **Step 4:** Verify the staging build is wired up using the example as a temporary stand-in.

```
cp .env.staging.example .env.staging
npm run build:staging
rm .env.staging
```

Expected: build succeeds using dummy values. Confirms staging mode is correctly resolving `.env.staging`.

- [ ] **Step 5:** Review the commit log for plan 1.

```
git log --oneline -15
```

Expected: ~12 new commits since `75f1114` (the design-doc commit).

- [ ] **Step 6:** Push (only after confirming Task 0 is complete).

```
git push
```

If the user hasn't confirmed Task 0 (Lovable GitHub disconnection), STOP and ask before pushing — Lovable may otherwise re-push unwanted changes.

---

## Plan 1 done

The repo is Lovable-free, the cloud build is unchanged, and the staging build path exists. Proceed to plan 2 to stand up the self-hosted Supabase instance that the staging build will point at.
