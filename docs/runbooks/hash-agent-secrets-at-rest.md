# Hash agent secrets at rest — migration plan (deferred)

## Why this is deferred

The schema already has `endpoints.token_hash` and `endpoints.client_secret_hash`,
which suggests a previous attempt to migrate started but didn't complete.

Migrating tokens on **already-deployed agents** is high-risk: any window
where the agent sends `agent_token=X` and the server compares against
`sha256(X)` will break heartbeats fleet-wide. The safe path needs a planned
rollout, not an inline edit during a security pass.

## What's currently true

- `endpoints.agent_token` (text) — plaintext, used by legacy agents
- `endpoints.agent_secret` (text) — plaintext, used by Phase 1 HMAC agents
- `endpoints.token_hash` (text) — exists but unused
- `endpoints.client_secret_hash` (text) — exists but unused
- `enrollment_tokens.token` (text PK) — plaintext

Threat model:
- A Postgres dump (intentional or stolen backup) exposes every active
  bearer token + HMAC secret in plaintext
- An RLS hole on `endpoints` or `enrollment_tokens` is the same risk
- A super-admin with read-only DB access can impersonate any agent

## Safe rollout (~3 days)

### Day 1 — write side

1. Add a trigger on `endpoints` INSERT / UPDATE that, when `agent_token`
   changes, populates `token_hash = encode(sha256(agent_token), 'hex')`.
2. Back-fill `token_hash` for every existing row (one-time UPDATE).
3. Do the same for `agent_secret` ↔ `client_secret_hash`.
4. For `enrollment_tokens`, add `token_hash` column + back-fill.

At this point hashes exist alongside plaintext. No validation change yet.

### Day 2 — read side, fall-through

1. In `agent-api` validateAgentToken: try matching by `token_hash` first;
   on miss, fall back to matching by plaintext `agent_token` and bump a
   metric. Same for `agent_secret`.
2. In `agent-enroll`: hash incoming enrollment token, look up by hash.

Deploy. Watch the "matched via plaintext" metric. As long as agents check in
they'll be matched by either column.

### Day 3 — flip

1. After 14 days of zero plaintext-fallback hits (i.e. every active agent
   has heartbeated and been matched by hash), drop the plaintext columns.
2. NULL the columns in a single transaction. Take a backup first.

If at any point the metric isn't approaching zero, identify the stragglers
and force-update them. Don't drop until the floor.

## Why not do this in the Phase B session

Touching token validation under time pressure is how production incidents
happen. The right move is to schedule this as a discrete week of work with:
- A runbook (above)
- A canary endpoint (CMW-TS1) that opts in first
- A metrics dashboard for the fallback counter
- A planned operator window to deploy + monitor + flip

The existing RLS lock on `endpoints` (super-admin-only or own-org member,
service-role for agent-side writes) is the load-bearing mitigation today.
Phase B already locked down Docker-bypass UFW, the LLM column injection,
report-render XSS, and added rate limits — the residual risk after those
is dominated by other items in the production-readiness review.
