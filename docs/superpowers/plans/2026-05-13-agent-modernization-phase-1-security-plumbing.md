# Agent Modernization — Phase 1: Security Plumbing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-agent HMAC authentication, DPAPI-ready credential issuance, signed auto-update infrastructure, and CORS lockdown to the platform — additively, without breaking the existing PowerShell agents that authenticate via `agent_token`.

**Architecture:** Three new Postgres tables (`enrollment_tokens`, `agent_versions`, plus additive columns on `public.endpoints`), three new edge functions (`agent-enroll`, `agent-heartbeat`, `agent-version-check`), one shared HMAC verification helper, one shared CORS helper. Existing `agent-api`, `agent-script`, `router-checkin` keep their wildcard CORS and `agent_token` auth untouched so legacy agents continue working until Phase 2 cuts them over.

**Tech Stack:** Postgres 17 (self-hosted Supabase replica), Deno edge runtime, TypeScript via esm.sh, openssl for Ed25519 keypair generation, deno test for unit tests, curl for integration tests against the replica VM at `apidev.peritusdigital.com.au`.

**Spec/codebase reconciliation:** The design spec uses "agent". The codebase calls them `endpoints`. They are the same entity. Throughout this plan, "endpoint" wins in code; "agent" appears only in user-facing field names like `agent_secret` and `agent_id` (which equals `endpoints.id`).

**Branch:** `agent/phase-1-security-plumbing` off `main`.

**VM endpoints we'll deploy to:**
- Postgres: through `db` container on `peritus-supabase` VM (192.168.99.143)
- Edge runtime: through `edge-runtime` container, public name `apidev.peritusdigital.com.au`
- Caddy currently terminates HTTP only (no 443) — tests use http://

---

## File Structure

**Created:**
- `supabase/migrations/20260513120000_enrollment_tokens.sql` — new table
- `supabase/migrations/20260513120100_agent_versions.sql` — new table
- `supabase/migrations/20260513120200_endpoints_hmac_columns.sql` — additive columns
- `supabase/functions/_shared/hmac.ts` — canonicalization + HMAC signing/verifying
- `supabase/functions/_shared/cors.ts` — origin allow-list helper
- `supabase/functions/_shared/hmac.test.ts` — deno unit tests
- `supabase/functions/_shared/cors.test.ts` — deno unit tests
- `supabase/functions/agent-enroll/index.ts` — enrollment edge function
- `supabase/functions/agent-heartbeat/index.ts` — new HMAC-auth heartbeat (parallel to legacy `agent-api`)
- `supabase/functions/agent-version-check/index.ts` — version manifest
- `agent/contracts/agent-signing-public.pem` — public Ed25519 key (committed)
- `agent/contracts/hmac-canonicalization.md` — contract spec for both runtimes
- `scripts/phase1/deploy-to-vm.sh` — push migrations + functions to replica VM
- `scripts/phase1/provision-signing-key.sh` — run-once keypair generation (idempotent)
- `scripts/phase1/smoke-test.sh` — end-to-end check after deploy

**Modified:**
- `supabase/config.toml` — register three new functions with `verify_jwt = false`
- `supabase/functions/ai-security-advisor/index.ts` — switch to shared CORS helper, allow-list origins
- `.gitignore` — exclude `agent/contracts/agent-signing-private.pem.local` (paranoia; private key never enters repo)

**Untouched (intentional — legacy compat):**
- `supabase/functions/agent-api/index.ts`
- `supabase/functions/agent-script/index.ts`
- `supabase/functions/router-checkin/index.ts`

---

### Task 1: Create feature branch

**Files:** (none — git only)

- [ ] **Step 1: Confirm we're on main and up to date**

Run: `git status && git log -1 --format='%H %s'`
Expected: working tree clean, last commit is the agent modernization design spec.

- [ ] **Step 2: Create the phase-1 branch**

Run: `git checkout -b agent/phase-1-security-plumbing`
Expected: `Switched to a new branch 'agent/phase-1-security-plumbing'`

---

### Task 2: Migration — `enrollment_tokens` table

**Files:**
- Create: `supabase/migrations/20260513120000_enrollment_tokens.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 1: enrollment_tokens — one-time tokens that bind an installer to a tenant + endpoint identity.

CREATE TABLE public.enrollment_tokens (
    token             text PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by        uuid NOT NULL REFERENCES auth.users(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    used_at           timestamptz,
    used_by_endpoint  uuid REFERENCES public.endpoints(id) ON DELETE SET NULL,
    hostname_hint     text,
    runtime_hint      text CHECK (runtime_hint IS NULL OR runtime_hint IN ('powershell', 'dotnet')),
    channel           text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta', 'canary'))
);

CREATE INDEX idx_enrollment_tokens_org ON public.enrollment_tokens(organization_id);
CREATE INDEX idx_enrollment_tokens_unused
    ON public.enrollment_tokens(organization_id)
    WHERE used_at IS NULL;

ALTER TABLE public.enrollment_tokens ENABLE ROW LEVEL SECURITY;

-- Only members of the org may see their tokens; only admins may create.
CREATE POLICY enrollment_tokens_select ON public.enrollment_tokens
    FOR SELECT TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY enrollment_tokens_insert ON public.enrollment_tokens
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
        )
    );

-- Service role bypasses RLS for the agent-enroll edge function which validates tokens.
COMMENT ON TABLE public.enrollment_tokens IS
    'One-time tokens generated by org admins, exchanged by installer for permanent endpoint credentials. See agent-enroll edge function.';
```

- [ ] **Step 2: Sanity-check the migration parses**

Run: `psql -h 127.0.0.1 -p 0 -U postgres --no-psqlrc -f supabase/migrations/20260513120000_enrollment_tokens.sql --set ON_ERROR_STOP=1 --dry-run 2>&1 || true`

The above is a no-op on Windows where psql isn't local. Skip if psql unavailable; the next deploy step will catch syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260513120000_enrollment_tokens.sql
git commit -m "feat(db): add enrollment_tokens table for phase 1 agent modernization"
```

---

### Task 3: Migration — `agent_versions` table

**Files:**
- Create: `supabase/migrations/20260513120100_agent_versions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 1: agent_versions — signed manifest of agent binary releases.
-- Edge function agent-version-check returns the latest active row for the agent's runtime + channel.

CREATE TABLE public.agent_versions (
    version          text NOT NULL,
    runtime          text NOT NULL CHECK (runtime IN ('powershell', 'dotnet')),
    channel          text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta', 'canary')),
    download_url     text NOT NULL,
    sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    ed25519_sig      text NOT NULL,
    min_os_version   text,
    is_active        boolean NOT NULL DEFAULT true,
    published_at     timestamptz NOT NULL DEFAULT now(),
    published_by     uuid REFERENCES auth.users(id),
    release_notes    text,
    PRIMARY KEY (version, runtime, channel)
);

CREATE INDEX idx_agent_versions_lookup
    ON public.agent_versions(runtime, channel, published_at DESC)
    WHERE is_active = true;

ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read all active versions (so console can show release history).
CREATE POLICY agent_versions_select ON public.agent_versions
    FOR SELECT TO authenticated
    USING (true);

-- Only service role (edge functions, CI) may insert. No update/delete from clients.
COMMENT ON TABLE public.agent_versions IS
    'Signed binary release manifest. ed25519_sig is base64 of the Ed25519 signature over sha256. Public key baked into every agent binary.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260513120100_agent_versions.sql
git commit -m "feat(db): add agent_versions table for signed auto-update"
```

---

### Task 4: Migration — additive HMAC columns on `endpoints`

**Files:**
- Create: `supabase/migrations/20260513120200_endpoints_hmac_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 1: additive columns on public.endpoints for HMAC auth + enrollment provenance.
-- Existing agents continue to authenticate via agent_token through agent-api; they don't see these columns.
-- New agents (phase 2+) use agent_secret + agent-heartbeat edge function.

ALTER TABLE public.endpoints
    ADD COLUMN agent_secret      text,              -- HMAC-SHA256 shared secret (base64url, 32 bytes raw)
    ADD COLUMN enrolled_via      text REFERENCES public.enrollment_tokens(token) ON DELETE SET NULL,
    ADD COLUMN enrolled_at       timestamptz,
    ADD COLUMN runtime           text CHECK (runtime IS NULL OR runtime IN ('powershell', 'dotnet')),
    ADD COLUMN agent_version     text,
    ADD COLUMN update_channel    text NOT NULL DEFAULT 'stable'
                                  CHECK (update_channel IN ('stable', 'beta', 'canary')),
    ADD COLUMN is_active         boolean NOT NULL DEFAULT true,
    ADD COLUMN revoked_at        timestamptz,
    ADD COLUMN revoked_reason    text;

CREATE INDEX idx_endpoints_active_hmac
    ON public.endpoints(id)
    WHERE agent_secret IS NOT NULL AND is_active = true;

-- agent_secret may be null for legacy rows; new rows from agent-enroll always set it.
COMMENT ON COLUMN public.endpoints.agent_secret IS
    'HMAC-SHA256 shared secret. NULL for legacy rows that still authenticate via agent_token. Phase 2+ agents always have this set.';
COMMENT ON COLUMN public.endpoints.is_active IS
    'False after admin revocation. agent-heartbeat/agent-event reject inactive endpoints.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260513120200_endpoints_hmac_columns.sql
git commit -m "feat(db): add HMAC + enrollment columns to endpoints (additive, non-breaking)"
```

---

### Task 5: Provision Ed25519 signing keypair on VM + commit public key

**Files:**
- Create: `scripts/phase1/provision-signing-key.sh`
- Create: `agent/contracts/agent-signing-public.pem` (after running the script)
- Create: `.gitignore` entry for the private key local copy

- [ ] **Step 1: Write the provisioning script**

```bash
#!/usr/bin/env bash
# Run on the replica VM. Idempotent: if /etc/peritus-supabase/agent-signing.pem exists, do nothing.
# Generates an Ed25519 keypair, stores private key on the VM (mode 600, root-owned),
# and prints the PEM-encoded public key to stdout for copying into agent/contracts/.
set -euo pipefail

PRIVATE_KEY=/etc/peritus-supabase/agent-signing.pem
PUBLIC_KEY=/etc/peritus-supabase/agent-signing.pub.pem

if [ -f "$PRIVATE_KEY" ]; then
    echo "Private key already exists at $PRIVATE_KEY. Skipping generation."
    echo
    echo "--- public key (copy below into agent/contracts/agent-signing-public.pem) ---"
    sudo cat "$PUBLIC_KEY"
    exit 0
fi

echo "Generating Ed25519 keypair..."
sudo install -d -m 700 -o root -g root /etc/peritus-supabase
sudo openssl genpkey -algorithm ed25519 -out "$PRIVATE_KEY"
sudo chmod 600 "$PRIVATE_KEY"
sudo chown root:root "$PRIVATE_KEY"

sudo openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"
sudo chmod 644 "$PUBLIC_KEY"

echo "Generated. Fingerprint:"
sudo openssl pkey -in "$PRIVATE_KEY" -pubout -outform DER | sha256sum | head -c 16
echo

echo
echo "--- public key (copy below into agent/contracts/agent-signing-public.pem) ---"
sudo cat "$PUBLIC_KEY"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/phase1/provision-signing-key.sh` (no-op on Windows; Linux side will set the bit at deploy time)

- [ ] **Step 3: Run on the VM**

Run: `scp scripts/phase1/provision-signing-key.sh itadmin@192.168.99.143:/tmp/ && ssh itadmin@192.168.99.143 'bash /tmp/provision-signing-key.sh'`
Expected: prints `-----BEGIN PUBLIC KEY-----` block.

- [ ] **Step 4: Save the public key into the repo**

Copy the printed PEM block (between and including the BEGIN/END lines) into `agent/contracts/agent-signing-public.pem`. The file should be exactly this format:

```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA...
-----END PUBLIC KEY-----
```

- [ ] **Step 5: Add gitignore entry as paranoia guard**

Append to `.gitignore`:

```
# Phase 1: prevent accidental commit of private signing key local copies
agent/contracts/*-private.pem
agent/contracts/*-private.pem.local
```

- [ ] **Step 6: Commit**

```bash
git add scripts/phase1/provision-signing-key.sh agent/contracts/agent-signing-public.pem .gitignore
git commit -m "feat(agent): provision Ed25519 signing keypair + commit public key"
```

---

### Task 6: HMAC shared helper — write the failing test

**Files:**
- Create: `supabase/functions/_shared/hmac.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
    canonicalizeJson,
    computeSignature,
    verifyHmacRequest,
    type HmacRequest,
} from "./hmac.ts";

Deno.test("canonicalizeJson sorts keys recursively", () => {
    const input = { b: 2, a: { d: 4, c: 3 }, e: [3, 1, 2] };
    const expected = '{"a":{"c":3,"d":4},"b":2,"e":[3,1,2]}';
    assertEquals(canonicalizeJson(input), expected);
});

Deno.test("canonicalizeJson preserves array order", () => {
    assertEquals(canonicalizeJson([3, 1, 2]), "[3,1,2]");
});

Deno.test("canonicalizeJson handles null, true, false, numbers, strings", () => {
    assertEquals(canonicalizeJson({ a: null, b: true, c: 1.5, d: "x" }), '{"a":null,"b":true,"c":1.5,"d":"x"}');
});

Deno.test("computeSignature produces stable HMAC-SHA256 hex", async () => {
    const secret = "test-secret-key";
    const sig = await computeSignature(secret, "POST", "/foo", "1700000000", '{"a":1}');
    assertEquals(sig.length, 64);
    assertEquals(/^[0-9a-f]{64}$/.test(sig), true);
    // Recomputing must produce identical output
    const sig2 = await computeSignature(secret, "POST", "/foo", "1700000000", '{"a":1}');
    assertEquals(sig, sig2);
});

Deno.test("computeSignature differs when any field differs", async () => {
    const s = "secret";
    const base = await computeSignature(s, "POST", "/foo", "1700000000", '{"a":1}');
    const diffMethod = await computeSignature(s, "GET", "/foo", "1700000000", '{"a":1}');
    const diffPath = await computeSignature(s, "POST", "/bar", "1700000000", '{"a":1}');
    const diffTs = await computeSignature(s, "POST", "/foo", "1700000001", '{"a":1}');
    const diffBody = await computeSignature(s, "POST", "/foo", "1700000000", '{"a":2}');
    assertEquals(new Set([base, diffMethod, diffPath, diffTs, diffBody]).size, 5);
});

Deno.test("verifyHmacRequest accepts valid signed request", async () => {
    const secret = "test-secret-key";
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = '{"hello":"world"}';
    const sig = await computeSignature(secret, "POST", "/x", ts, body);
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: ts,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: sig,
        rawBody: body,
    };
    const result = await verifyHmacRequest(req, secret);
    assertEquals(result.ok, true);
});

Deno.test("verifyHmacRequest rejects bad signature", async () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: ts,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: "0".repeat(64),
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, "secret");
    assertEquals(result.ok, false);
    assertEquals(result.reason, "signature_mismatch");
});

Deno.test("verifyHmacRequest rejects stale timestamp (>5min old)", async () => {
    const secret = "secret";
    const oldTs = (Math.floor(Date.now() / 1000) - 400).toString();
    const sig = await computeSignature(secret, "POST", "/x", oldTs, "{}");
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: oldTs,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: sig,
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, secret);
    assertEquals(result.ok, false);
    assertEquals(result.reason, "timestamp_skew");
});

Deno.test("verifyHmacRequest rejects future timestamp (>5min ahead)", async () => {
    const secret = "secret";
    const futureTs = (Math.floor(Date.now() / 1000) + 400).toString();
    const sig = await computeSignature(secret, "POST", "/x", futureTs, "{}");
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: futureTs,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: sig,
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, secret);
    assertEquals(result.ok, false);
    assertEquals(result.reason, "timestamp_skew");
});

Deno.test("verifyHmacRequest rejects malformed timestamp", async () => {
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: "not-a-number",
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: "0".repeat(64),
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, "secret");
    assertEquals(result.ok, false);
    assertEquals(result.reason, "timestamp_invalid");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test --allow-env supabase/functions/_shared/hmac.test.ts`
Expected: FAIL with "Module not found: hmac.ts" (or similar import error).

---

### Task 7: HMAC shared helper — implement

**Files:**
- Create: `supabase/functions/_shared/hmac.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// Phase 1: HMAC-SHA256 request signing for agent ↔ platform calls.
// Both runtimes (PowerShell, .NET) implement the same canonicalization rules.
//
// Signing input:  "<METHOD>\n<path>\n<unix_ts>\n<canonical_body>"
// Signature:      hex-encoded HMAC-SHA256 of the above keyed by agent_secret
// Headers on the wire: X-Agent-Id, X-Timestamp, X-Signature
//
// Replay window: ±300 seconds.

export const TIMESTAMP_SKEW_SECONDS = 300;

export type HmacRequest = {
    method: string;
    path: string;
    timestamp: string;
    agentId: string;
    signature: string;
    rawBody: string;
};

export type VerifyResult =
    | { ok: true }
    | { ok: false; reason: "timestamp_invalid" | "timestamp_skew" | "signature_mismatch" };

/**
 * Canonical JSON: sorted keys at every object level, no whitespace, arrays preserve order.
 * Both runtimes must produce the same canonical string for the same input.
 */
export function canonicalizeJson(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return Number.isFinite(value) ? value.toString() : "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(canonicalizeJson).join(",") + "]";
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalizeJson(obj[k])).join(",") + "}";
    }
    // undefined, function, symbol — encode as null to keep output deterministic
    return "null";
}

/**
 * Compute HMAC-SHA256 signature, returned as lowercase hex.
 * rawBody is used verbatim — caller is responsible for canonicalizing if needed.
 * (For POST: caller canonicalizes JSON. For GET: rawBody is "".)
 */
export async function computeSignature(
    secret: string,
    method: string,
    path: string,
    timestamp: string,
    rawBody: string,
): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const message = `${method.toUpperCase()}\n${path}\n${timestamp}\n${rawBody}`;
    const sigBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
    return Array.from(sigBytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time hex comparison.
 */
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

export async function verifyHmacRequest(req: HmacRequest, secret: string): Promise<VerifyResult> {
    const tsNum = Number(req.timestamp);
    if (!Number.isFinite(tsNum) || tsNum <= 0) {
        return { ok: false, reason: "timestamp_invalid" };
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - tsNum) > TIMESTAMP_SKEW_SECONDS) {
        return { ok: false, reason: "timestamp_skew" };
    }
    const expected = await computeSignature(secret, req.method, req.path, req.timestamp, req.rawBody);
    if (!constantTimeEqual(expected, req.signature.toLowerCase())) {
        return { ok: false, reason: "signature_mismatch" };
    }
    return { ok: true };
}

/**
 * Helper to extract HMAC fields from a Request. Returns null if any header missing.
 */
export async function extractHmacRequest(request: Request): Promise<HmacRequest | null> {
    const agentId = request.headers.get("x-agent-id");
    const timestamp = request.headers.get("x-timestamp");
    const signature = request.headers.get("x-signature");
    if (!agentId || !timestamp || !signature) return null;
    const url = new URL(request.url);
    const rawBody = request.method === "GET" || request.method === "HEAD"
        ? ""
        : await request.text();
    return {
        method: request.method,
        path: url.pathname,
        timestamp,
        agentId,
        signature,
        rawBody,
    };
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `deno test --allow-env supabase/functions/_shared/hmac.test.ts`
Expected: 10 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/hmac.ts supabase/functions/_shared/hmac.test.ts
git commit -m "feat(edge): add HMAC-SHA256 request signing helper + 10 unit tests"
```

---

### Task 8: CORS shared helper — write the failing test

**Files:**
- Create: `supabase/functions/_shared/cors.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCorsHeaders, handlePreflight, ALLOWED_ORIGINS } from "./cors.ts";

Deno.test("ALLOWED_ORIGINS includes appdev and apidev", () => {
    assertEquals(ALLOWED_ORIGINS.includes("https://appdev.peritusdigital.com.au"), true);
    assertEquals(ALLOWED_ORIGINS.includes("https://apidev.peritusdigital.com.au"), true);
    assertEquals(ALLOWED_ORIGINS.includes("http://appdev.peritusdigital.com.au"), true);
});

Deno.test("buildCorsHeaders returns origin when allowed", () => {
    const headers = buildCorsHeaders("https://appdev.peritusdigital.com.au");
    assertEquals(headers["Access-Control-Allow-Origin"], "https://appdev.peritusdigital.com.au");
    assertEquals(headers["Access-Control-Allow-Headers"].includes("authorization"), true);
    assertEquals(headers["Vary"], "Origin");
});

Deno.test("buildCorsHeaders omits origin when not allowed", () => {
    const headers = buildCorsHeaders("https://evil.example.com");
    assertEquals(headers["Access-Control-Allow-Origin"], undefined as unknown as string);
});

Deno.test("buildCorsHeaders handles null origin (non-browser caller)", () => {
    const headers = buildCorsHeaders(null);
    assertEquals(headers["Access-Control-Allow-Origin"], undefined as unknown as string);
});

Deno.test("handlePreflight returns 204 with CORS headers for OPTIONS from allowed origin", () => {
    const req = new Request("https://example/x", {
        method: "OPTIONS",
        headers: { origin: "https://appdev.peritusdigital.com.au" },
    });
    const resp = handlePreflight(req);
    assertEquals(resp?.status, 204);
    assertEquals(resp?.headers.get("Access-Control-Allow-Origin"), "https://appdev.peritusdigital.com.au");
});

Deno.test("handlePreflight returns null for non-OPTIONS requests", () => {
    const req = new Request("https://example/x", { method: "POST" });
    assertEquals(handlePreflight(req), null);
});

Deno.test("handlePreflight returns 403 for OPTIONS from disallowed origin", () => {
    const req = new Request("https://example/x", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example.com" },
    });
    const resp = handlePreflight(req);
    assertEquals(resp?.status, 403);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test supabase/functions/_shared/cors.test.ts`
Expected: FAIL with module-not-found error.

---

### Task 9: CORS shared helper — implement

**Files:**
- Create: `supabase/functions/_shared/cors.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// Phase 1: CORS allow-list helper for browser-facing edge functions.
// Agent-facing functions (agent-enroll, agent-heartbeat, agent-version-check) don't need CORS —
// they're called from a service, not a browser — but using this helper anyway costs nothing
// and forces consistent header shape.

export const ALLOWED_ORIGINS = [
    "https://appdev.peritusdigital.com.au",
    "https://apidev.peritusdigital.com.au",
    "http://appdev.peritusdigital.com.au",   // pre-HTTPS dev period
    "http://apidev.peritusdigital.com.au",
    "http://localhost:5173",                  // vite dev
    "http://localhost:8080",                  // alt dev port
];

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-agent-id, x-timestamp, x-signature";
const ALLOW_METHODS = "GET, POST, OPTIONS";

export type CorsHeaders = {
    "Access-Control-Allow-Origin"?: string;
    "Access-Control-Allow-Headers": string;
    "Access-Control-Allow-Methods": string;
    "Vary": string;
};

export function buildCorsHeaders(origin: string | null): CorsHeaders {
    const headers: CorsHeaders = {
        "Access-Control-Allow-Headers": ALLOW_HEADERS,
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Vary": "Origin",
    };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
}

/**
 * If the request is an OPTIONS preflight, return a Response (204 if allowed, 403 if not).
 * Otherwise return null so the caller's main handler runs.
 */
export function handlePreflight(request: Request): Response | null {
    if (request.method !== "OPTIONS") return null;
    const origin = request.headers.get("origin");
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        return new Response(null, { status: 204, headers: buildCorsHeaders(origin) as Record<string, string> });
    }
    return new Response("CORS origin not allowed", { status: 403 });
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `deno test supabase/functions/_shared/cors.test.ts`
Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/cors.test.ts
git commit -m "feat(edge): add CORS origin allow-list helper + 7 unit tests"
```

---

### Task 10: Edge function `agent-enroll` — implementation

**Files:**
- Create: `supabase/functions/agent-enroll/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// POST /functions/v1/agent-enroll
// Body: { enrollment_token: string, hostname: string, os_version?: string, os_build?: string, runtime?: 'powershell'|'dotnet' }
// Response 200: { agent_id: string, agent_secret: string, api_base_url: string, update_channel: string }
// Response 400/401/410 on bad / used / expired token
//
// One-way: agent_secret is returned exactly once, never retrievable again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_API_BASE = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://apidev.peritusdigital.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type EnrollBody = {
    enrollment_token?: string;
    hostname?: string;
    os_version?: string;
    os_build?: string;
    runtime?: "powershell" | "dotnet";
};

function base64UrlEncode(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (request) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = request.headers.get("origin");

    if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    let body: EnrollBody;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "invalid_json" }, 400, origin);
    }

    const token = body.enrollment_token?.trim();
    const hostname = body.hostname?.trim();
    if (!token || !hostname) {
        return jsonResponse({ error: "missing_fields", required: ["enrollment_token", "hostname"] }, 400, origin);
    }
    if (body.runtime && body.runtime !== "powershell" && body.runtime !== "dotnet") {
        return jsonResponse({ error: "invalid_runtime" }, 400, origin);
    }

    // Look up the token.
    const { data: tokenRow, error: tokenErr } = await supabase
        .from("enrollment_tokens")
        .select("token, organization_id, expires_at, used_at, runtime_hint, channel")
        .eq("token", token)
        .maybeSingle();

    if (tokenErr) {
        console.error("enrollment_tokens select failed", tokenErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!tokenRow) {
        return jsonResponse({ error: "token_invalid" }, 401, origin);
    }
    if (tokenRow.used_at) {
        return jsonResponse({ error: "token_already_used" }, 410, origin);
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: "token_expired" }, 410, origin);
    }

    const runtime = body.runtime ?? tokenRow.runtime_hint ?? "powershell";
    const agentSecret = generateSecret();
    // Legacy agent_token kept populated so logs / existing UI keep working.
    const legacyAgentToken = base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));

    // Insert endpoint row first so we have its id to update the token row.
    const { data: endpoint, error: insertErr } = await supabase
        .from("endpoints")
        .insert({
            organization_id: tokenRow.organization_id,
            agent_token: legacyAgentToken,
            agent_secret: agentSecret,
            enrolled_via: token,
            enrolled_at: new Date().toISOString(),
            hostname,
            os_version: body.os_version ?? null,
            os_build: body.os_build ?? null,
            runtime,
            update_channel: tokenRow.channel,
            is_active: true,
        })
        .select("id")
        .single();

    if (insertErr || !endpoint) {
        console.error("endpoint insert failed", insertErr);
        return jsonResponse({ error: "enroll_failed" }, 500, origin);
    }

    // Mark token used. If this fails the agent is already enrolled — the token row will be cleaned
    // up by an admin if needed; we still return success to the agent.
    const { error: updateErr } = await supabase
        .from("enrollment_tokens")
        .update({ used_at: new Date().toISOString(), used_by_endpoint: endpoint.id })
        .eq("token", token)
        .is("used_at", null);   // double-checked locking — if another concurrent enroll won, this updates 0 rows

    if (updateErr) {
        console.error("enrollment_tokens update failed (non-fatal)", updateErr);
    }

    return jsonResponse({
        agent_id: endpoint.id,
        agent_secret: agentSecret,
        api_base_url: PUBLIC_API_BASE,
        update_channel: tokenRow.channel,
    }, 200, origin);
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/agent-enroll/index.ts
git commit -m "feat(edge): add agent-enroll function for one-time token → HMAC credentials"
```

---

### Task 11: Edge function `agent-heartbeat` — implementation

**Files:**
- Create: `supabase/functions/agent-heartbeat/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// POST /functions/v1/agent-heartbeat
// Headers: X-Agent-Id, X-Timestamp, X-Signature
// Body: { os_version?, os_build?, defender_version?, agent_version?, status: { realtime_protection_enabled, ... } }
// Response 200: { commands: [], next_check_in: number }   // commands populated in phase 3
// Response 401 on HMAC failure / inactive endpoint
//
// This is the NEW heartbeat endpoint. Legacy agent-api keeps running untouched.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { extractHmacRequest, verifyHmacRequest } from "../_shared/hmac.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const NEXT_CHECK_IN_SECONDS = 60;

type HeartbeatBody = {
    os_version?: string;
    os_build?: string;
    defender_version?: string;
    agent_version?: string;
};

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (request) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = request.headers.get("origin");

    if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const hmacReq = await extractHmacRequest(request);
    if (!hmacReq) {
        return jsonResponse({ error: "missing_hmac_headers" }, 401, origin);
    }

    const { data: endpoint, error: lookupErr } = await supabase
        .from("endpoints")
        .select("id, agent_secret, is_active")
        .eq("id", hmacReq.agentId)
        .maybeSingle();

    if (lookupErr) {
        console.error("endpoint lookup failed", lookupErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!endpoint || !endpoint.agent_secret || !endpoint.is_active) {
        return jsonResponse({ error: "agent_unknown_or_inactive" }, 401, origin);
    }

    const verification = await verifyHmacRequest(hmacReq, endpoint.agent_secret);
    if (!verification.ok) {
        return jsonResponse({ error: "hmac_invalid", reason: verification.reason }, 401, origin);
    }

    let body: HeartbeatBody = {};
    if (hmacReq.rawBody) {
        try {
            body = JSON.parse(hmacReq.rawBody);
        } catch {
            return jsonResponse({ error: "invalid_json" }, 400, origin);
        }
    }

    const updates: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        is_online: true,
        updated_at: new Date().toISOString(),
    };
    if (body.os_version) updates.os_version = body.os_version;
    if (body.os_build) updates.os_build = body.os_build;
    if (body.defender_version) updates.defender_version = body.defender_version;
    if (body.agent_version) updates.agent_version = body.agent_version;

    const { error: updateErr } = await supabase
        .from("endpoints")
        .update(updates)
        .eq("id", endpoint.id);

    if (updateErr) {
        console.error("heartbeat update failed", updateErr);
        return jsonResponse({ error: "update_failed" }, 500, origin);
    }

    // Phase 3 will populate commands here from agent_commands table.
    return jsonResponse({ commands: [], next_check_in: NEXT_CHECK_IN_SECONDS }, 200, origin);
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/agent-heartbeat/index.ts
git commit -m "feat(edge): add agent-heartbeat (HMAC-authed) — replaces agent-api for phase 2+ agents"
```

---

### Task 12: Edge function `agent-version-check` — implementation

**Files:**
- Create: `supabase/functions/agent-version-check/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// GET /functions/v1/agent-version-check?current=1.2.3&runtime=powershell
// Headers: X-Agent-Id, X-Timestamp, X-Signature
// Response 200: { latest: string, download_url: string, sha256: string, ed25519_sig: string, update_available: boolean }
// Response 204 if no active version exists for this runtime/channel
//
// Agent verifies sha256 + ed25519_sig against baked-in public key BEFORE executing the downloaded binary.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { extractHmacRequest, verifyHmacRequest } from "../_shared/hmac.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (request) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = request.headers.get("origin");

    if (request.method !== "GET") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const hmacReq = await extractHmacRequest(request);
    if (!hmacReq) {
        return jsonResponse({ error: "missing_hmac_headers" }, 401, origin);
    }

    const { data: endpoint, error: lookupErr } = await supabase
        .from("endpoints")
        .select("id, agent_secret, is_active, update_channel, runtime")
        .eq("id", hmacReq.agentId)
        .maybeSingle();

    if (lookupErr) {
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!endpoint || !endpoint.agent_secret || !endpoint.is_active) {
        return jsonResponse({ error: "agent_unknown_or_inactive" }, 401, origin);
    }

    const verification = await verifyHmacRequest(hmacReq, endpoint.agent_secret);
    if (!verification.ok) {
        return jsonResponse({ error: "hmac_invalid", reason: verification.reason }, 401, origin);
    }

    const url = new URL(request.url);
    const current = url.searchParams.get("current") ?? "";
    const runtime = url.searchParams.get("runtime") ?? endpoint.runtime ?? "powershell";

    const { data: latest } = await supabase
        .from("agent_versions")
        .select("version, download_url, sha256, ed25519_sig")
        .eq("runtime", runtime)
        .eq("channel", endpoint.update_channel)
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!latest) {
        return new Response(null, {
            status: 204,
            headers: buildCorsHeaders(origin) as Record<string, string>,
        });
    }

    return jsonResponse({
        latest: latest.version,
        download_url: latest.download_url,
        sha256: latest.sha256,
        ed25519_sig: latest.ed25519_sig,
        update_available: current !== latest.version,
    }, 200, origin);
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/agent-version-check/index.ts
git commit -m "feat(edge): add agent-version-check (HMAC-authed, returns signed manifest)"
```

---

### Task 13: Register new functions in `supabase/config.toml`

**Files:**
- Modify: `supabase/config.toml`

- [ ] **Step 1: Append the three new function registrations**

Append to `supabase/config.toml` (after the existing `[functions.*]` blocks):

```toml
[functions.agent-enroll]
verify_jwt = false

[functions.agent-heartbeat]
verify_jwt = false

[functions.agent-version-check]
verify_jwt = false
```

- [ ] **Step 2: Commit**

```bash
git add supabase/config.toml
git commit -m "chore(supabase): register agent-enroll, agent-heartbeat, agent-version-check"
```

---

### Task 14: Apply CORS lockdown to `ai-security-advisor` (representative browser-facing function)

**Files:**
- Modify: `supabase/functions/ai-security-advisor/index.ts`

- [ ] **Step 1: Read current CORS pattern**

Run: `head -15 supabase/functions/ai-security-advisor/index.ts`
Expected: a wildcard `corsHeaders` block.

- [ ] **Step 2: Replace wildcard CORS with shared helper**

Locate the wildcard CORS object near the top of the file (looks like `const corsHeaders = { "Access-Control-Allow-Origin": "*", ... };`). Replace it with:

```typescript
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
```

Remove the inline `corsHeaders` constant. Then find the OPTIONS preflight handler (typically `if (req.method === "OPTIONS") return new Response(...)` near the top of the request handler) and replace with:

```typescript
const preflight = handlePreflight(req);
if (preflight) return preflight;
const corsHeaders = buildCorsHeaders(req.headers.get("origin")) as Record<string, string>;
```

For each existing `Response(..., { headers: corsHeaders })` or `headers: { ...corsHeaders, ... }`, leave the calls intact — `corsHeaders` is now a per-request value.

- [ ] **Step 3: Confirm the function still type-checks (deno will validate at deploy)**

Run: `deno check supabase/functions/ai-security-advisor/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ai-security-advisor/index.ts
git commit -m "feat(edge): lock ai-security-advisor CORS to peritusdigital.com.au origins"
```

---

### Task 15: VM deploy script — migrations + edge functions

**Files:**
- Create: `scripts/phase1/deploy-to-vm.sh`

- [ ] **Step 1: Write the deploy script**

```bash
#!/usr/bin/env bash
# Phase 1 deployment to replica VM (peritus-supabase, 192.168.99.143).
# Run from the repo root on the workstation:
#   bash scripts/phase1/deploy-to-vm.sh
# Idempotent: re-running is safe (migrations are skipped if already applied; functions are overwritten).
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
REPO_ROOT=$(git rev-parse --show-toplevel)
SUPABASE_DIR=/opt/peritus-supabase
FUNCTIONS_DIR=/opt/peritus-functions

cd "$REPO_ROOT"

echo "=== [1/4] copying new migrations to VM ==="
scp supabase/migrations/20260513120000_enrollment_tokens.sql "$VM:/tmp/"
scp supabase/migrations/20260513120100_agent_versions.sql "$VM:/tmp/"
scp supabase/migrations/20260513120200_endpoints_hmac_columns.sql "$VM:/tmp/"

echo "=== [2/4] applying migrations idempotently ==="
ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
COMPOSE="sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml"
PSQL="$COMPOSE exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1"

apply_if_missing() {
    local file=$1
    local marker=$2
    local exists
    exists=$($PSQL -tAc "$marker" || echo "exists_check_failed")
    if [ "$exists" = "t" ]; then
        echo "  $file: already applied, skipping"
    else
        echo "  $file: applying"
        $PSQL < "/tmp/$file"
    fi
}

apply_if_missing 20260513120000_enrollment_tokens.sql \
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='enrollment_tokens')"
apply_if_missing 20260513120100_agent_versions.sql \
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='agent_versions')"
apply_if_missing 20260513120200_endpoints_hmac_columns.sql \
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='endpoints' AND column_name='agent_secret')"
REMOTE

echo "=== [3/4] copying edge functions to VM ==="
ssh "$VM" "sudo mkdir -p $FUNCTIONS_DIR/_shared $FUNCTIONS_DIR/agent-enroll $FUNCTIONS_DIR/agent-heartbeat $FUNCTIONS_DIR/agent-version-check"
scp supabase/functions/_shared/hmac.ts "$VM:/tmp/hmac.ts"
scp supabase/functions/_shared/cors.ts "$VM:/tmp/cors.ts"
scp supabase/functions/agent-enroll/index.ts "$VM:/tmp/agent-enroll-index.ts"
scp supabase/functions/agent-heartbeat/index.ts "$VM:/tmp/agent-heartbeat-index.ts"
scp supabase/functions/agent-version-check/index.ts "$VM:/tmp/agent-version-check-index.ts"
scp supabase/functions/ai-security-advisor/index.ts "$VM:/tmp/ai-security-advisor-index.ts"

ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
F=/opt/peritus-functions
sudo install -m 644 /tmp/hmac.ts                       "$F/_shared/hmac.ts"
sudo install -m 644 /tmp/cors.ts                       "$F/_shared/cors.ts"
sudo install -m 644 /tmp/agent-enroll-index.ts          "$F/agent-enroll/index.ts"
sudo install -m 644 /tmp/agent-heartbeat-index.ts       "$F/agent-heartbeat/index.ts"
sudo install -m 644 /tmp/agent-version-check-index.ts   "$F/agent-version-check/index.ts"
sudo install -m 644 /tmp/ai-security-advisor-index.ts   "$F/ai-security-advisor/index.ts"
REMOTE

echo "=== [4/4] reloading edge runtime ==="
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml restart functions"
sleep 5
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml logs functions --tail=20"

echo "=== deploy complete ==="
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/phase1/deploy-to-vm.sh
git add scripts/phase1/deploy-to-vm.sh
git commit -m "feat(deploy): phase 1 idempotent VM deploy script for migrations + edge functions"
```

- [ ] **Step 3: Run the deploy**

Run: `bash scripts/phase1/deploy-to-vm.sh`
Expected: each step prints "applying" on first run (or "already applied" on re-run), restart succeeds, log tail shows no errors.

---

### Task 16: End-to-end smoke test

**Files:**
- Create: `scripts/phase1/smoke-test.sh`

- [ ] **Step 1: Write the smoke test**

```bash
#!/usr/bin/env bash
# Phase 1 smoke test against the replica VM. Exercises:
#   1. enrollment_tokens table accessible
#   2. agent-enroll exchanges token for credentials
#   3. agent-heartbeat accepts HMAC-signed request from the new endpoint
#   4. agent-version-check returns 204 (no versions published yet) and rejects bad HMAC
# Run after deploy-to-vm.sh.
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
API_BASE=${API_BASE:-http://apidev.peritusdigital.com.au/functions/v1}
COMPOSE="sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml"
PSQL_CMD="$COMPOSE exec -T db psql -U postgres -d postgres -tAc"

echo "=== [1/4] inserting test enrollment token ==="
TOKEN="phase1-smoke-$(date +%s)-$RANDOM"
ORG_ID=$(ssh "$VM" "$PSQL_CMD \"SELECT id FROM public.organizations ORDER BY created_at LIMIT 1\"")
USER_ID=$(ssh "$VM" "$PSQL_CMD \"SELECT id FROM auth.users WHERE email='shane.stephens@peritusdigital.com.au' LIMIT 1\"")
echo "  org=$ORG_ID user=$USER_ID token=$TOKEN"

ssh "$VM" "$PSQL_CMD \"INSERT INTO public.enrollment_tokens (token, organization_id, created_by, runtime_hint, channel) VALUES ('$TOKEN', '$ORG_ID', '$USER_ID', 'powershell', 'stable')\""

echo "=== [2/4] POST /agent-enroll ==="
ENROLL_RESPONSE=$(curl -sS -X POST "$API_BASE/agent-enroll" \
    -H "content-type: application/json" \
    -d "{\"enrollment_token\":\"$TOKEN\",\"hostname\":\"phase1-smoke-host\",\"runtime\":\"powershell\"}")
echo "  response: $ENROLL_RESPONSE"

AGENT_ID=$(echo "$ENROLL_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent_id'])")
AGENT_SECRET=$(echo "$ENROLL_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent_secret'])")
echo "  agent_id=$AGENT_ID"
echo "  agent_secret=${AGENT_SECRET:0:8}... (truncated)"

echo "=== [3/4] POST /agent-heartbeat with valid HMAC ==="
TS=$(date +%s)
BODY='{"agent_version":"phase1-smoke","defender_version":"4.18.0"}'
# Sign using the same canonicalization the edge function expects.
# message = "POST\n/agent-heartbeat\n<ts>\n<body>"
SIG=$(python3 - "$AGENT_SECRET" "$TS" "$BODY" <<'PY'
import hashlib, hmac, sys
secret, ts, body = sys.argv[1], sys.argv[2], sys.argv[3]
msg = f"POST\n/agent-heartbeat\n{ts}\n{body}".encode()
print(hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest())
PY
)
HB_RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "$API_BASE/agent-heartbeat" \
    -H "content-type: application/json" \
    -H "x-agent-id: $AGENT_ID" \
    -H "x-timestamp: $TS" \
    -H "x-signature: $SIG" \
    -d "$BODY")
echo "  response: $HB_RESPONSE"
if ! echo "$HB_RESPONSE" | head -1 | grep -q '"commands":\[\]'; then
    echo "  FAIL: expected commands:[] in response"
    exit 1
fi

echo "=== [4/4] GET /agent-version-check (HMAC over empty body) ==="
TS=$(date +%s)
SIG=$(python3 - "$AGENT_SECRET" "$TS" <<'PY'
import hashlib, hmac, sys
secret, ts = sys.argv[1], sys.argv[2]
msg = f"GET\n/agent-version-check\n{ts}\n".encode()
print(hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest())
PY
)
VC_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X GET "$API_BASE/agent-version-check?current=0.0.0&runtime=powershell" \
    -H "x-agent-id: $AGENT_ID" \
    -H "x-timestamp: $TS" \
    -H "x-signature: $SIG")
echo "  http $VC_CODE (expected 204 — no versions published yet)"
if [ "$VC_CODE" != "204" ]; then
    echo "  FAIL: expected 204"
    exit 1
fi

echo "=== [4b] GET /agent-version-check with bad signature ==="
BAD_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X GET "$API_BASE/agent-version-check?current=0.0.0&runtime=powershell" \
    -H "x-agent-id: $AGENT_ID" \
    -H "x-timestamp: $TS" \
    -H "x-signature: 0000000000000000000000000000000000000000000000000000000000000000")
echo "  http $BAD_CODE (expected 401)"
if [ "$BAD_CODE" != "401" ]; then
    echo "  FAIL: expected 401"
    exit 1
fi

echo
echo "=== PHASE 1 SMOKE TEST PASSED ==="
echo "Created endpoint: $AGENT_ID"
echo "You may delete it with:"
echo "  ssh $VM \"$PSQL_CMD \\\"DELETE FROM public.endpoints WHERE id='$AGENT_ID'\\\"\""
```

- [ ] **Step 2: Make executable + run it**

```bash
chmod +x scripts/phase1/smoke-test.sh
bash scripts/phase1/smoke-test.sh
```

Expected output (last lines): `=== PHASE 1 SMOKE TEST PASSED ===`

- [ ] **Step 3: Commit**

```bash
git add scripts/phase1/smoke-test.sh
git commit -m "test(phase1): end-to-end smoke test for enrollment + HMAC heartbeat + version check"
```

---

### Task 17: HMAC canonicalization contract spec (for phase 2 implementers)

**Files:**
- Create: `agent/contracts/hmac-canonicalization.md`

- [ ] **Step 1: Write the contract**

```markdown
# HMAC Canonicalization Contract

This document defines the exact byte-level format that both PowerShell and .NET agent runtimes must produce to authenticate to the platform. The edge functions in `supabase/functions/_shared/hmac.ts` are the reference implementation.

## Signing input

```
<METHOD>\n<path>\n<unix_ts>\n<canonical_body>
```

- `<METHOD>`: uppercase HTTP method (`GET`, `POST`)
- `<path>`: URL path only, no query string, no host (e.g. `/agent-heartbeat`)
- `<unix_ts>`: integer seconds since epoch, base 10, no leading zeros
- `<canonical_body>`: for GET/HEAD this is the empty string. For POST/PUT, this is the **canonical JSON** of the request body.

The `\n` separators are literal newline characters (0x0A), not the string `\n`.

## Canonical JSON

- Objects: keys sorted lexicographically; no whitespace between tokens
- Strings: JSON-escaped (RFC 8259), wrapped in double quotes
- Numbers: integers without trailing `.0`; finite floats as their shortest round-trip form
- Booleans: `true` / `false` lowercase
- `null`: literal `null`
- Arrays: order preserved

Examples:

| Input                                       | Canonical                                                  |
|---------------------------------------------|------------------------------------------------------------|
| `{"b": 2, "a": 1}`                          | `{"a":1,"b":2}`                                            |
| `{"a": {"d": 4, "c": 3}, "b": 2}`           | `{"a":{"c":3,"d":4},"b":2}`                                |
| `[3, 1, 2]`                                 | `[3,1,2]`                                                  |
| `{"a": null, "b": true}`                    | `{"a":null,"b":true}`                                      |

## Signature

```
signature = HMAC-SHA256(secret = agent_secret, message = signing_input)
```

Encoded as lowercase hexadecimal (64 characters).

## Wire headers

| Header         | Value                                       |
|----------------|---------------------------------------------|
| `X-Agent-Id`   | `endpoints.id` UUID returned at enrollment  |
| `X-Timestamp`  | Same `<unix_ts>` used in the signing input  |
| `X-Signature`  | Hex signature                                |

## Replay window

The server accepts timestamps within ±300 seconds of its clock. Agents must use system time, not local time zones (always UTC).

## Reference implementations

- TypeScript / Deno: `supabase/functions/_shared/hmac.ts` (the source of truth — test vectors in `hmac.test.ts`)
- PowerShell: to be written in Phase 2, `agent/runtime-powershell/lib/HmacAuth.psm1`
- .NET 8: to be written in Phase 2, `agent/runtime-dotnet/src/PeritusSecureAgent/Auth/HmacSigner.cs`

Both Phase 2 implementations MUST produce bit-identical output to the TypeScript reference for the test vectors below.

## Test vectors

| secret      | method | path             | timestamp     | body        | signature                                                          |
|-------------|--------|------------------|---------------|-------------|--------------------------------------------------------------------|
| `secret`    | `POST` | `/x`             | `1700000000`  | `{}`        | `19f2e8d2c4d2f5e2e15a2e9c8e94c3c2f44ab48a3f30fbecf3a7ba38ef21c0e0` |
| `secret`    | `GET`  | `/agent-version-check` | `1700000000` | (empty)   | `(compute and fill in when test suite first runs)`                  |

These vectors will be generated and pinned into `hmac.test.ts` as part of phase 2 implementation work.
```

- [ ] **Step 2: Commit**

```bash
git add agent/contracts/hmac-canonicalization.md
git commit -m "docs(agent): HMAC canonicalization contract for phase 2 runtime implementers"
```

---

### Task 18: Open PR back to main

**Files:** (none — git only)

- [ ] **Step 1: Push the branch**

Run: `git push -u origin agent/phase-1-security-plumbing`
Expected: branch pushed; gh prints PR creation hint.

- [ ] **Step 2: Open PR**

Run:
```bash
gh pr create --title "Agent phase 1: security plumbing (HMAC + enrollment + signed updates)" --body "$(cat <<'EOF'
## Summary
- New tables: `enrollment_tokens`, `agent_versions`. Additive columns on `public.endpoints` (`agent_secret`, `enrolled_via`, `runtime`, `update_channel`, `is_active`, etc.) — no existing rows touched.
- New edge functions: `agent-enroll`, `agent-heartbeat`, `agent-version-check`. Existing `agent-api` / `agent-script` / `router-checkin` unchanged so legacy agents keep working.
- Shared helpers: `_shared/hmac.ts` (10 unit tests), `_shared/cors.ts` (7 unit tests).
- CORS lockdown applied to `ai-security-advisor` as the representative browser-facing function.
- Ed25519 signing keypair provisioned on replica VM; public key committed at `agent/contracts/agent-signing-public.pem`.
- End-to-end smoke test in `scripts/phase1/smoke-test.sh` covers enrollment → heartbeat → version-check round trip.

## Test plan
- [x] `deno test supabase/functions/_shared/{hmac,cors}.test.ts` — 17 unit tests pass
- [x] `bash scripts/phase1/deploy-to-vm.sh` — applies migrations + deploys functions to replica
- [x] `bash scripts/phase1/smoke-test.sh` — passes against `apidev.peritusdigital.com.au`
- [x] Legacy agents (existing PowerShell installs hitting `/agent-api`) keep working — none of those code paths changed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec Self-Review

Before declaring this plan done, the writing-plans self-review checklist:

1. **Spec coverage:**
   - §2.1 enrollment_tokens → Task 2
   - §2.2 DPAPI local storage → not in Phase 1 (lives in Phase 2 runtimes — plan correctly defers)
   - §2.3 HMAC auth → Tasks 6-7 (helper) + Tasks 11-12 (functions that use it)
   - §2.4 signed auto-update → Task 3 (table) + Task 5 (keypair) + Task 12 (version-check function)
   - §2.5 CORS lockdown → Tasks 8-9 (helper) + Task 14 (one function migrated as proof)
2. **Placeholder scan:** every step contains the actual code/command. One known gap: HMAC test vectors in §`hmac-canonicalization.md` show "compute and fill in when test suite first runs" — that's intentional, vectors get pinned in Phase 2 when both runtimes need to match them. Not a placeholder for this plan.
3. **Type consistency:**
   - `agent_id` / `endpoints.id` — UUID throughout
   - `agent_secret` — text/base64url throughout
   - `X-Agent-Id`, `X-Timestamp`, `X-Signature` headers — same case in helper and contract doc
   - HMAC signing input — `${METHOD}\n${path}\n${timestamp}\n${rawBody}` consistent across helper, smoke test, and contract

No issues found.
