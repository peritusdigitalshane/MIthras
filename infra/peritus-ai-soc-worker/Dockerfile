FROM denoland/deno:alpine-2.0.0

WORKDIR /app
COPY worker.ts /app/worker.ts

# Pre-cache the dependency graph so the container starts fast and runs
# offline (no surprise network fetches at runtime).
RUN deno cache worker.ts

# Run as the unprivileged 'deno' user the base image ships with.
USER deno

# Network access for Postgres + the orchestrator. Env access for the
# config we pass in via docker-compose. No filesystem writes needed.
CMD ["deno", "run", "--allow-net", "--allow-env", "worker.ts"]
