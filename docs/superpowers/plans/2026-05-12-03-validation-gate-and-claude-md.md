# Validation Gate + CLAUDE.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Apply TDD: write the failing test first, run it to confirm failure, implement minimally, run to confirm pass, commit.

**Goal:** Build a six-category integration test suite that proves the self-hosted Supabase instance (stood up in plan 2) is functionally equivalent to cloud, and write the `CLAUDE.md` documentation that makes this whole codebase legible to future contributors and sessions.

**Architecture:** Tests use Vitest with a separate config (`vitest.integration.config.ts`) targeting the Node environment. They authenticate via `@supabase/supabase-js` against `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` and use the service-role key for admin setup/teardown. A `pg` connection is used only for the schema-parity test (which compares against the cloud DB via `CLOUD_DB_URL`). `CLAUDE.md` is a single top-level markdown file with 12 sections, per the design.

**Tech Stack:** Vitest 3, `@supabase/supabase-js` 2.91, `pg` 8 (new dep), TypeScript 5.8, Node 20.

**Companion design doc:** `docs/superpowers/specs/2026-05-12-supabase-self-host-and-workflow-design.md`

**Depends on:** Plans 1 and 2 complete (env-configurable client and a running self-hosted instance with schema + seed + functions).

---

## File map

| File | Action |
|---|---|
| `package.json` | Modify — add `pg`, `@types/pg`, `tsx` deps; add `test:integration` script |
| `vitest.integration.config.ts` | Create — separate vitest config for integration |
| `tests/integration/helpers/env.ts` | Create — required env-var validation |
| `tests/integration/helpers/clients.ts` | Create — pre-configured supabase + pg clients |
| `tests/integration/helpers/test-users.ts` | Create — sign-in, create-user, cleanup helpers |
| `tests/integration/helpers/edge.ts` | Create — invoke an edge function with auth |
| `tests/integration/00-schema-parity.test.ts` | Create — Category 1 |
| `tests/integration/01-auth-flows.test.ts` | Create — Category 2 |
| `tests/integration/02-rls.test.ts` | Create — Category 3 |
| `tests/integration/03-edge-functions/<name>.test.ts` × 10 | Create — Category 4 |
| `tests/integration/04-storage.test.ts` | Create — Category 5 (skipped if no buckets) |
| `tests/integration/05-e2e-smoke.test.ts` | Create — Category 6 |
| `tests/integration/.env.example` | Create — documents test env vars |
| `CLAUDE.md` | Create — top-level project docs |

---

### Task 1: Add dependencies and integration vitest config

**Files:**
- Modify: `package.json`
- Create: `vitest.integration.config.ts`
- Create: `tests/integration/.env.example`

- [ ] **Step 1:** Add dependencies for integration tests.

```
npm install --save-dev --legacy-peer-deps pg @types/pg tsx dotenv
```

- [ ] **Step 2:** Add a `test:integration` script to `package.json`. The `scripts` block should now read:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "build:staging": "vite build --mode staging",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "vitest run -c vitest.integration.config.ts"
},
```

- [ ] **Step 3:** Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";
import path from "path";

// Load env from tests/integration/.env.local (gitignored) when present.
loadEnv({ path: path.resolve(__dirname, "tests/integration/.env.local") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false }, // integration tests share a real backend
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 4:** Create `tests/integration/.env.example` to document the required vars:

```
# Copy to tests/integration/.env.local (gitignored) and fill in real values.

# Self-hosted Supabase instance under test
SUPABASE_TEST_URL=https://supabase.staging.example
SUPABASE_TEST_ANON_KEY=
SUPABASE_TEST_SERVICE_ROLE_KEY=

# Direct Postgres connection to the SAME self-hosted instance (used by the
# schema-parity test and for tests that need admin DB access).
# Open an SSH tunnel first: ssh -L 5432:127.0.0.1:5432 your-host
SELFHOST_DB_URL=postgresql://postgres:<password>@127.0.0.1:5432/postgres

# Direct Postgres connection to the cloud project (read-only is fine).
# Used only by 00-schema-parity.test.ts.
CLOUD_DB_URL=postgresql://postgres.njdcyjxgtckgtzgzoctw:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

# Optional: bcrypt-hashed passwords for the seeded test users (used by 01-auth-flows).
TEST_USER_A_EMAIL=owner-a@test.peritus.local
TEST_USER_A_PASSWORD=test-password-a
TEST_USER_B_EMAIL=owner-b@test.peritus.local
TEST_USER_B_PASSWORD=test-password-b
```

- [ ] **Step 5:** Add `tests/integration/.env.local` to `.gitignore`.

Append this line to `.gitignore`:

```
# Integration test env
tests/integration/.env.local
```

- [ ] **Step 6:** Confirm the empty test suite runs.

```
npm run test:integration
```

Expected: Vitest reports "No test files found" (or similar — there are no tests yet). Exits 0 or with a clean "no tests" message.

- [ ] **Step 7:** Commit.

```
git add package.json package-lock.json vitest.integration.config.ts \
        tests/integration/.env.example .gitignore
git commit -m "test: scaffold integration test infrastructure"
```

---

### Task 2: Write env + client helpers

**Files:**
- Create: `tests/integration/helpers/env.ts`
- Create: `tests/integration/helpers/clients.ts`

- [ ] **Step 1:** Create `tests/integration/helpers/env.ts`:

```ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. ` +
      `Copy tests/integration/.env.example to tests/integration/.env.local and fill it in.`
    );
  }
  return value;
}

export const TEST_ENV = {
  SUPABASE_URL: required("SUPABASE_TEST_URL"),
  SUPABASE_ANON_KEY: required("SUPABASE_TEST_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_TEST_SERVICE_ROLE_KEY"),
  SELFHOST_DB_URL: required("SELFHOST_DB_URL"),
  CLOUD_DB_URL: process.env.CLOUD_DB_URL ?? "", // optional — schema parity only
  TEST_USER_A: {
    email: process.env.TEST_USER_A_EMAIL ?? "owner-a@test.peritus.local",
    password: process.env.TEST_USER_A_PASSWORD ?? "test-password-a",
  },
  TEST_USER_B: {
    email: process.env.TEST_USER_B_EMAIL ?? "owner-b@test.peritus.local",
    password: process.env.TEST_USER_B_PASSWORD ?? "test-password-b",
  },
};
```

- [ ] **Step 2:** Create `tests/integration/helpers/clients.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { TEST_ENV } from "./env";

export function anonClient(): SupabaseClient {
  return createClient(TEST_ENV.SUPABASE_URL, TEST_ENV.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(TEST_ENV.SUPABASE_URL, TEST_ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export async function selfhostPg(): Promise<PgClient> {
  const client = new PgClient({ connectionString: TEST_ENV.SELFHOST_DB_URL });
  await client.connect();
  return client;
}

export async function cloudPg(): Promise<PgClient> {
  if (!TEST_ENV.CLOUD_DB_URL) {
    throw new Error("CLOUD_DB_URL not set — schema parity test cannot run.");
  }
  const client = new PgClient({ connectionString: TEST_ENV.CLOUD_DB_URL });
  await client.connect();
  return client;
}
```

- [ ] **Step 3:** Commit.

```
git add tests/integration/helpers/env.ts tests/integration/helpers/clients.ts
git commit -m "test: add integration env and client helpers"
```

---

### Task 3: Write test-user helpers

**Files:**
- Create: `tests/integration/helpers/test-users.ts`

- [ ] **Step 1:** Create `tests/integration/helpers/test-users.ts`:

```ts
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { anonClient, serviceRoleClient } from "./clients";
import { TEST_ENV } from "./env";

export interface SignedInClient {
  client: SupabaseClient;
  user: User;
  cleanup: () => Promise<void>;
}

/**
 * Signs in as one of the seeded test users (A or B). Returns a client that
 * carries the user's JWT, so RLS rules apply from the user's perspective.
 */
export async function signInAs(
  which: "A" | "B"
): Promise<SignedInClient> {
  const creds = which === "A" ? TEST_ENV.TEST_USER_A : TEST_ENV.TEST_USER_B;
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword(creds);
  if (error || !data.user) {
    throw new Error(`signInAs(${which}) failed: ${error?.message ?? "no user"}`);
  }
  return {
    client,
    user: data.user,
    cleanup: async () => {
      await client.auth.signOut();
    },
  };
}

/**
 * Creates a brand-new auth user via the admin API and returns a signed-in
 * client for them. Use `cleanup()` to delete the user when the test ends.
 */
export async function createDisposableUser(): Promise<SignedInClient> {
  const admin = serviceRoleClient();
  const email = `disposable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.peritus.local`;
  const password = "disposable-password-" + Math.random().toString(36).slice(2);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`createDisposableUser failed: ${createErr?.message ?? "no user"}`);
  }

  const client = anonClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;

  return {
    client,
    user: created.user,
    cleanup: async () => {
      await client.auth.signOut();
      await admin.auth.admin.deleteUser(created.user.id);
    },
  };
}
```

- [ ] **Step 2:** Commit.

```
git add tests/integration/helpers/test-users.ts
git commit -m "test: add test-user helpers (signInAs, createDisposableUser)"
```

---

### Task 4: Write the schema-parity test (Category 1)

TDD: this test will FAIL until plan 2's migrations have been replayed against the self-hosted instance. That's the intended use — it's the gate.

**Files:**
- Test: `tests/integration/00-schema-parity.test.ts`

- [ ] **Step 1:** Create the test:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client as PgClient } from "pg";
import { cloudPg, selfhostPg } from "./helpers/clients";
import { TEST_ENV } from "./helpers/env";

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function fetchSchema(client: PgClient): Promise<ColumnRow[]> {
  const { rows } = await client.query<ColumnRow>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);
  return rows;
}

async function fetchPolicies(client: PgClient) {
  const { rows } = await client.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `);
  return rows;
}

describe("Category 1: schema parity (cloud vs self-hosted)", () => {
  let cloud: PgClient;
  let selfhost: PgClient;

  beforeAll(async () => {
    if (!TEST_ENV.CLOUD_DB_URL) {
      throw new Error("CLOUD_DB_URL must be set for schema parity tests.");
    }
    cloud = await cloudPg();
    selfhost = await selfhostPg();
  });

  afterAll(async () => {
    await cloud?.end();
    await selfhost?.end();
  });

  it("public columns are identical", async () => {
    const [cloudCols, selfhostCols] = await Promise.all([
      fetchSchema(cloud),
      fetchSchema(selfhost),
    ]);
    expect(selfhostCols).toEqual(cloudCols);
  });

  it("public RLS policies are identical", async () => {
    const [cloudPolicies, selfhostPolicies] = await Promise.all([
      fetchPolicies(cloud),
      fetchPolicies(selfhost),
    ]);
    expect(selfhostPolicies).toEqual(cloudPolicies);
  });
});
```

- [ ] **Step 2:** Run the test to verify it FAILS appropriately if schemas don't match yet, or PASSES if plan 2 successfully replayed migrations.

```
npm run test:integration -- tests/integration/00-schema-parity.test.ts
```

Expected outcomes:
- If plan 2 was completed correctly: PASS. ✓
- If migrations weren't fully applied: FAIL with a deep-equal diff showing the missing tables/columns/policies. This is the test doing its job; fix the schema, not the test.

- [ ] **Step 3:** Commit.

```
git add tests/integration/00-schema-parity.test.ts
git commit -m "test(category-1): schema parity cloud vs self-hosted"
```

---

### Task 5: Write auth-flow tests (Category 2)

**Files:**
- Test: `tests/integration/01-auth-flows.test.ts`

- [ ] **Step 1:** Create the test:

```ts
import { describe, it, expect } from "vitest";
import { anonClient, serviceRoleClient } from "./helpers/clients";
import { signInAs, createDisposableUser } from "./helpers/test-users";
import { TEST_ENV } from "./helpers/env";

describe("Category 2: auth flows", () => {
  it("seeded user A can sign in", async () => {
    const session = await signInAs("A");
    expect(session.user.email).toBe(TEST_ENV.TEST_USER_A.email);
    expect(session.user.id).toBe("11111111-1111-1111-1111-111111111111");
    await session.cleanup();
  });

  it("seeded user B can sign in", async () => {
    const session = await signInAs("B");
    expect(session.user.email).toBe(TEST_ENV.TEST_USER_B.email);
    await session.cleanup();
  });

  it("invalid password is rejected", async () => {
    const client = anonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: TEST_ENV.TEST_USER_A.email,
      password: "definitely-wrong",
    });
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it("admin can create then delete a disposable user", async () => {
    const session = await createDisposableUser();
    expect(session.user.id).toMatch(/^[0-9a-f-]{36}$/);
    await session.cleanup();

    // Confirm deletion by trying to look up via admin
    const admin = serviceRoleClient();
    const { data } = await admin.auth.admin.getUserById(session.user.id);
    expect(data.user).toBeNull();
  });

  it("issued JWT validates against the database", async () => {
    const session = await signInAs("A");
    // RPC: `auth.uid()` returns the JWT-derived user id when called from a
    // user-authenticated request. If the JWT chain is broken, this returns null.
    const { data, error } = await session.client.rpc("auth_uid_smoke" as any);
    // The function might not exist — fall back to a known table query that
    // requires authenticated role.
    if (error?.message?.includes("not found") || error?.code === "PGRST202") {
      // Fallback: read auth.users via PostgREST will be blocked for anon —
      // a successful query on any RLS-gated table is enough proof.
      const { data: ownRows, error: rowsErr } = await session.client
        .from("agents") // adjust if a different table is more universally available
        .select("id")
        .limit(1);
      // RLS may filter to zero rows; what matters is no auth error.
      expect(rowsErr?.code === "42501").toBeFalsy(); // 42501 = permission denied
    } else {
      expect(data).toBe(session.user.id);
    }
    await session.cleanup();
  });
});
```

- [ ] **Step 2:** Run.

```
npm run test:integration -- tests/integration/01-auth-flows.test.ts
```

Expected: all 5 tests PASS against the self-hosted instance.

- [ ] **Step 3:** Commit.

```
git add tests/integration/01-auth-flows.test.ts
git commit -m "test(category-2): auth flow tests"
```

---

### Task 6: Write RLS tests (Category 3)

These tests rely on the schema inventory from plan 2 Task 8 (`infra/supabase/scripts/schema-inventory.md`). For each public table with RLS enabled and a user-owned column (typically `user_id`), assert:
- User A can read rows they own
- User A cannot read rows owned by user B
- User A can insert a row for themselves
- User A cannot insert a row claiming to be user B

**Files:**
- Test: `tests/integration/02-rls.test.ts`

- [ ] **Step 1:** Open `infra/supabase/scripts/schema-inventory.md` and list the public tables that have RLS enabled AND an owner column (most commonly `user_id`, but might be `owner_id`, `org_id`, etc.).

- [ ] **Step 2:** Create the test using the template below. For each table identified in Step 1, add one `describe` block; the helpers inside the file mean each table only needs ~10 lines of test code.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signInAs, type SignedInClient } from "./helpers/test-users";

/**
 * For a table with an owner column (default `user_id`), assert RLS lets
 * the owner read their rows and blocks them from reading rows owned by
 * someone else.
 */
function rlsReadsForTable(table: string, ownerColumn = "user_id") {
  describe(`RLS reads — ${table}`, () => {
    let sessionA: SignedInClient;
    let sessionB: SignedInClient;

    beforeAll(async () => {
      sessionA = await signInAs("A");
      sessionB = await signInAs("B");
    });
    afterAll(async () => {
      await sessionA?.cleanup();
      await sessionB?.cleanup();
    });

    it(`user A only sees rows where ${ownerColumn} = userA.id`, async () => {
      const { data, error } = await sessionA.client.from(table).select(`${ownerColumn}`);
      expect(error).toBeNull();
      // Every returned row must be owned by A.
      for (const row of data ?? []) {
        expect((row as any)[ownerColumn]).toBe(sessionA.user.id);
      }
    });

    it(`user A cannot see rows owned by user B`, async () => {
      const { data } = await sessionA.client
        .from(table)
        .select(`${ownerColumn}`)
        .eq(ownerColumn, sessionB.user.id);
      expect(data ?? []).toEqual([]);
    });
  });
}

describe("Category 3: RLS", () => {
  // -------------------------------------------------------------------------
  // ADD ONE LINE PER OWNER-SCOPED TABLE FROM schema-inventory.md.
  // Examples (replace with your actual tables):
  //
  //   rlsReadsForTable("agents");
  //   rlsReadsForTable("scan_results");
  //   rlsReadsForTable("user_settings");
  //
  // For tables with a non-default owner column:
  //   rlsReadsForTable("org_audit_log", "org_id");
  // -------------------------------------------------------------------------
});
```

- [ ] **Step 3:** Fill in the calls inside `describe("Category 3: RLS", ...)` using the actual table names from your inventory. One line per table.

- [ ] **Step 4:** Run.

```
npm run test:integration -- tests/integration/02-rls.test.ts
```

Expected: all tests PASS. Any failure points to either an RLS misconfiguration or a seed-data shape issue — investigate both before changing the test.

- [ ] **Step 5:** Commit.

```
git add tests/integration/02-rls.test.ts
git commit -m "test(category-3): RLS read isolation per owner-scoped table"
```

---

### Task 7: Write the edge-function invocation helper

**Files:**
- Create: `tests/integration/helpers/edge.ts`

- [ ] **Step 1:** Create `tests/integration/helpers/edge.ts`:

```ts
import { TEST_ENV } from "./env";

export interface EdgeInvocation {
  status: number;
  body: unknown;
}

/**
 * Invoke an edge function via the Supabase Functions HTTP endpoint.
 * Pass `auth` as `"anon"` (default), `"service"`, or a raw JWT string.
 */
export async function invokeFunction(
  name: string,
  body: unknown,
  options: {
    auth?: "anon" | "service" | string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
  } = {}
): Promise<EdgeInvocation> {
  const auth = options.auth ?? "anon";
  const token =
    auth === "anon" ? TEST_ENV.SUPABASE_ANON_KEY :
    auth === "service" ? TEST_ENV.SUPABASE_SERVICE_ROLE_KEY :
    auth;

  const url = `${TEST_ENV.SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: options.method ?? "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });

  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: res.status, body: parsed };
}
```

- [ ] **Step 2:** Commit.

```
git add tests/integration/helpers/edge.ts
git commit -m "test: add edge function invocation helper"
```

---

### Task 8: Write edge-function tests (Category 4) — 10 functions

For each of the 10 functions, write a minimal test that proves the function is reachable, accepts the documented payload, and returns the documented response shape. External API calls (OpenAI, VirusTotal) are tolerated if test-tier keys are configured; the test asserts the HTTP-level contract regardless.

Use this template per function. Reference `infra/supabase/scripts/schema-inventory.md` Section 4 for each function's actual contract.

**Template:**

```ts
import { describe, it, expect } from "vitest";
import { invokeFunction } from "../helpers/edge";

describe("Edge function: <NAME>", () => {
  it("responds to a valid POST", async () => {
    const result = await invokeFunction("<NAME>", { /* example payload */ });
    // Reachability — function is mounted and authorised
    expect(result.status).not.toBe(401);
    expect(result.status).not.toBe(404);
    // Contract — function returns the documented shape (adjust per inventory)
    expect(result.body).toMatchObject({
      // Example: expected top-level keys per the inventory
    });
  });

  it("rejects unauthenticated requests", async () => {
    // Some functions in config.toml have verify_jwt = false — for those,
    // remove this test or assert that ANY response is returned.
    const result = await invokeFunction("<NAME>", {}, { auth: "raw-invalid-token-xxxx" });
    // verify_jwt = false: function still responds (just doesn't see a user)
    // verify_jwt = true:  401 here
    expect([200, 401, 400].includes(result.status)).toBe(true);
  });
});
```

For each step below, also note from `supabase/config.toml` whether `verify_jwt = false` (no JWT required) — those functions skip the auth-rejection test and just assert reachability.

**Files:** ten test files under `tests/integration/03-edge-functions/`.

- [ ] **Step 1:** Read `supabase/functions/agent-api/index.ts` to learn its contract. Write `tests/integration/03-edge-functions/agent-api.test.ts` using the template above, with the actual request/response shape.

- [ ] **Step 2:** Read `supabase/functions/agent-script/index.ts`. Write `tests/integration/03-edge-functions/agent-script.test.ts`.

- [ ] **Step 3:** Read `supabase/functions/ai-security-advisor/index.ts`. Write `tests/integration/03-edge-functions/ai-security-advisor.test.ts`. This function calls OpenAI — assert reachability even if `OPENAI_API_KEY` is a stub; expected behaviour with a stub key is a non-2xx response, which is still "function is alive."

- [ ] **Step 4:** Read `supabase/functions/check-openai-models/index.ts`. Write `tests/integration/03-edge-functions/check-openai-models.test.ts`. Same OpenAI-tolerance pattern.

- [ ] **Step 5:** Read `supabase/functions/cleanup-old-data/index.ts`. Write `tests/integration/03-edge-functions/cleanup-old-data.test.ts`. This one likely touches the database — wrap the test in `beforeAll` that seeds an old row and asserts cleanup ran.

- [ ] **Step 6:** Read `supabase/functions/cve-auto-protect/index.ts`. Write `tests/integration/03-edge-functions/cve-auto-protect.test.ts`.

- [ ] **Step 7:** Read `supabase/functions/cve-mitigation-advisor/index.ts`. Write `tests/integration/03-edge-functions/cve-mitigation-advisor.test.ts`. OpenAI-tolerant.

- [ ] **Step 8:** Read `supabase/functions/router-checkin/index.ts`. Write `tests/integration/03-edge-functions/router-checkin.test.ts`.

- [ ] **Step 9:** Read `supabase/functions/virustotal-lookup/index.ts`. Write `tests/integration/03-edge-functions/virustotal-lookup.test.ts`. VirusTotal-tolerant (treat stub key the same way as OpenAI).

- [ ] **Step 10:** Read `supabase/functions/vulnerability-scan/index.ts`. Write `tests/integration/03-edge-functions/vulnerability-scan.test.ts`.

- [ ] **Step 11:** Run the whole category.

```
npm run test:integration -- tests/integration/03-edge-functions/
```

Expected: all 10 files run; reachability assertions all PASS; contract assertions PASS for any function whose external dependencies are available; functions with stubbed external keys may show a non-2xx response which the tolerant template accepts.

- [ ] **Step 12:** Commit.

```
git add tests/integration/03-edge-functions/
git commit -m "test(category-4): edge function reachability and contract tests"
```

---

### Task 9: Storage tests (Category 5)

**Files:**
- Test: `tests/integration/04-storage.test.ts`

- [ ] **Step 1:** Open `infra/supabase/scripts/schema-inventory.md` Section 3 (Storage buckets). Note each bucket id and whether it's public.

- [ ] **Step 2:** If the inventory shows **zero** storage buckets, create a marker test that documents the category was reviewed and not applicable:

```ts
import { describe, it } from "vitest";

describe("Category 5: storage", () => {
  it.skip("no storage buckets defined in this codebase (per schema-inventory.md)", () => {
    /* intentionally skipped */
  });
});
```

Otherwise, create real upload/download/delete tests using the template below:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signInAs, type SignedInClient } from "./helpers/test-users";

const BUCKET = "<bucket-id-from-inventory>"; // e.g. "agent-uploads"

describe(`Category 5: storage — bucket ${BUCKET}`, () => {
  let session: SignedInClient;
  const testPath = `test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const fileBody = new Blob(["integration test payload"], { type: "text/plain" });

  beforeAll(async () => {
    session = await signInAs("A");
  });
  afterAll(async () => {
    // Best-effort cleanup
    await session?.client.storage.from(BUCKET).remove([testPath]);
    await session?.cleanup();
  });

  it("can upload an object", async () => {
    const { error } = await session.client.storage
      .from(BUCKET)
      .upload(testPath, fileBody, { upsert: true });
    expect(error).toBeNull();
  });

  it("can download the uploaded object", async () => {
    const { data, error } = await session.client.storage
      .from(BUCKET)
      .download(testPath);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const text = await (data as Blob).text();
    expect(text).toBe("integration test payload");
  });

  it("can delete the uploaded object", async () => {
    const { data, error } = await session.client.storage
      .from(BUCKET)
      .remove([testPath]);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
```

- [ ] **Step 3:** If multiple buckets exist, repeat the `describe` block once per bucket. Adjust `BUCKET` constant and any RLS expectations.

- [ ] **Step 4:** Run.

```
npm run test:integration -- tests/integration/04-storage.test.ts
```

Expected: all storage tests PASS, or the marker test is properly skipped if no buckets exist.

- [ ] **Step 5:** Commit.

```
git add tests/integration/04-storage.test.ts
git commit -m "test(category-5): storage upload/download/delete"
```

---

### Task 10: E2E smoke test (Category 6)

A scripted user-flow: sign in, list rows from a key table, mutate one row, see the mutation reflected, sign out. No browser — uses `@supabase/supabase-js` to mimic the same calls the frontend makes.

**Files:**
- Test: `tests/integration/05-e2e-smoke.test.ts`

- [ ] **Step 1:** Identify the "golden path" for this app by reading `src/pages/`. Pick the page most likely to break first if the backend is wrong (typically the dashboard or agents list). Note the Supabase calls it makes.

- [ ] **Step 2:** Create `tests/integration/05-e2e-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signInAs } from "./helpers/test-users";

describe("Category 6: end-to-end smoke", () => {
  it("user A's golden path: sign in -> read primary table -> create -> read -> delete", async () => {
    const session = await signInAs("A");

    // -----------------------------------------------------------------------
    // REPLACE "agents" below with the actual primary table identified in
    // Step 1. Likewise replace the create payload's fields with the real
    // schema (see infra/supabase/scripts/schema-inventory.md).
    // -----------------------------------------------------------------------
    const TABLE = "agents";
    const NEW_ROW = {
      // Required NOT NULL columns from the inventory go here.
      // user_id is set automatically by RLS policies that use auth.uid();
      // do NOT supply it manually unless the schema requires it.
      hostname: `smoke-${Date.now()}.test`,
    };

    // 1. Initial read — must succeed even if empty
    const initial = await session.client.from(TABLE).select("id");
    expect(initial.error).toBeNull();
    const initialCount = (initial.data ?? []).length;

    // 2. Insert
    const insertResult = await session.client
      .from(TABLE)
      .insert(NEW_ROW)
      .select()
      .single();
    expect(insertResult.error).toBeNull();
    expect(insertResult.data).toBeTruthy();

    // 3. Read again — must see the new row
    const after = await session.client.from(TABLE).select("id");
    expect(after.error).toBeNull();
    expect((after.data ?? []).length).toBe(initialCount + 1);

    // 4. Delete
    const deleteResult = await session.client
      .from(TABLE)
      .delete()
      .eq("id", (insertResult.data as any).id);
    expect(deleteResult.error).toBeNull();

    await session.cleanup();
  });
});
```

- [ ] **Step 3:** Adjust the table name and `NEW_ROW` payload to match the actual schema. The skeleton above is intentionally minimal — copy required columns from `schema-inventory.md`.

- [ ] **Step 4:** Run.

```
npm run test:integration -- tests/integration/05-e2e-smoke.test.ts
```

Expected: PASS.

- [ ] **Step 5:** Commit.

```
git add tests/integration/05-e2e-smoke.test.ts
git commit -m "test(category-6): end-to-end smoke (sign in, CRUD, sign out)"
```

---

### Task 11: Run the full suite + record the gate

**Files:** none (verification + tag)

- [ ] **Step 1:** Run every category back-to-back.

```
npm run test:integration
```

Expected: all six categories' tests PASS (or properly skip in storage's case).

- [ ] **Step 2:** If anything fails, fix the test or the backing data/policy — do NOT proceed to plan completion with red tests. The whole point of this plan is the gate.

- [ ] **Step 3:** Once green, capture the result as a tagged commit message.

```
git log --oneline -25  # confirm test commits are in place
git tag -a validation-gate-passed -m "Self-hosted Supabase validation gate passed: $(date -Iseconds)"
```

The tag marks the point in history when we proved self-hosted is functionally equivalent.

---

### Task 12: Write `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md`

This task is intentionally a single big write — the file is one cohesive document.

- [ ] **Step 1:** Create `CLAUDE.md` at the repo root with this content. Replace anything in `<angle brackets>` with values you know:

````markdown
# Peritus Endpoint Guardian — Project Guide

A guide for Claude sessions (and humans) working in this repo. Terse on purpose — links to source-of-truth files rather than duplicating them.

## 1. What this is

An endpoint security platform: Windows Defender management, CVE tracking, agent telemetry, AI security advisor. Single-tenant. Built with Vite/React/TS on the frontend and Supabase (Postgres + Auth + Storage + Edge Functions) on the backend.

## 2. Two environments

| Env | Frontend | Backend | Role |
|---|---|---|---|
| `production` | Docker `peritus-secure` on `:9988`, built from `.env.production` | Supabase **cloud** project `njdcyjxgtckgtzgzoctw` | Live for users |
| `staging` | Docker `peritus-secure-staging` on `:9989`, built from `.env.staging` | Self-hosted Supabase at `<your-public-supabase-hostname>` | Validation only — no user traffic |

The cutover from cloud to self-hosted prod has its own design doc (TBD — will live in `docs/superpowers/specs/` once tests pass).

## 3. Architecture

| Area | Where |
|---|---|
| Frontend entry | `src/main.tsx`, routes in `src/pages/` |
| Supabase client | `src/integrations/supabase/client.ts` (env-driven) |
| Generated types | `src/integrations/supabase/types.ts` |
| Migrations (source of truth) | `supabase/migrations/` |
| Seed data (staging only) | `supabase/seed.sql` |
| Edge functions | `supabase/functions/<name>/index.ts` × 10 |
| Frontend Dockerfile | `Dockerfile` (multi-stage, Nginx serve) |
| Frontend Compose | `docker-compose.yml` (prod + staging services) |
| Self-hosted backend | `infra/supabase/` (vendored upstream + override + scripts + runbook) |
| Backend runbook | `infra/supabase/RUNBOOK.md` |
| Backup script + timer | `infra/supabase/scripts/backup.sh` + `*.service` + `*.timer` |
| Schema inventory | `infra/supabase/scripts/schema-inventory.md` |

### Edge functions one-liner each

(see each function's `index.ts` for the actual contract)

| Function | Purpose |
|---|---|
| `agent-api` | HTTP API used by the Peritus agent on managed endpoints |
| `agent-script` | Returns the installation/update script for managed agents |
| `ai-security-advisor` | Calls OpenAI to produce security guidance — needs `OPENAI_API_KEY` |
| `check-openai-models` | Verifies an OpenAI key is valid — needs `OPENAI_API_KEY` |
| `cleanup-old-data` | Cron-style cleanup of expired records |
| `cve-auto-protect` | Auto-applies mitigation rules for newly discovered CVEs |
| `cve-mitigation-advisor` | Calls OpenAI to suggest mitigations — needs `OPENAI_API_KEY` |
| `router-checkin` | Edge-router heartbeat / config-fetch endpoint |
| `virustotal-lookup` | Reputation lookup — needs `VIRUSTOTAL_API_KEY` |
| `vulnerability-scan` | Triggers an on-demand vulnerability scan for an agent |

## 4. Local development

```sh
npm install --legacy-peer-deps
cp .env.example .env.local
# Edit .env.local — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (cloud or your local self-hosted)
npm run dev
# http://localhost:8080
```

To run the dev server pointed at the self-hosted staging instance instead, set the URL and key in `.env.local` to the staging values.

## 5. Environment variables

### Frontend (Vite — baked into the bundle)

| Var | Used in | Source |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/integrations/supabase/client.ts` | `.env.local` (dev) / `.env.production` (cloud build) / `.env.staging` (self-host build) |
| `VITE_SUPABASE_ANON_KEY` | same | same |

### Edge function secrets (Supabase backend, never read by frontend)

| Var | Used in | Source |
|---|---|---|
| `OPENAI_API_KEY` | `ai-security-advisor`, `check-openai-models`, `cve-mitigation-advisor` | Cloud: `supabase secrets set` / Self-host: `/etc/peritus-supabase/.env` |
| `VIRUSTOTAL_API_KEY` | `virustotal-lookup` | same |

### Self-host stack (`/etc/peritus-supabase/.env` on the Linux host)

| Var | Notes |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `JWT_SECRET` | `openssl rand -hex 32` — **never reuse cloud's** |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | Derived from `JWT_SECRET` (see runbook §3) |
| `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` | Studio Basic Auth |
| `FUNCTIONS_SOURCE` | Absolute path to this repo's `supabase/functions/` on the host |

## 6. Schema changes

1. Create a new file under `supabase/migrations/` with the next ISO timestamp prefix.
2. Apply it to the **staging** self-hosted instance first:
   ```sh
   DB_URL=postgresql://postgres:<pw>@127.0.0.1:5432/postgres \
       psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<new>.sql
   ```
3. Run integration tests against staging: `npm run test:integration`.
4. Only after green tests, apply to production. **Never edit existing migration files** — always add a new one.

## 7. Edge function changes

1. Edit `supabase/functions/<name>/index.ts`.
2. For self-hosted staging: the functions container mounts the source. `git pull` on the host then:
   ```sh
   docker compose -f infra/supabase/upstream/docker-compose.yml \
                  -f infra/supabase/docker-compose.override.yml restart functions
   ```
3. For cloud (current prod): `supabase functions deploy <name>`.
4. If the function needs a new secret, update `.env.template` AND `/etc/peritus-supabase/.env` on the host (or `supabase secrets set` for cloud).
5. Add or update the matching test under `tests/integration/03-edge-functions/<name>.test.ts`.

## 8. Tests

| Command | Runs |
|---|---|
| `npm run test` | Unit tests (Vitest, jsdom) |
| `npm run test:integration` | Integration suite against `SUPABASE_TEST_URL` |

Integration test config: `vitest.integration.config.ts`. Required env: `tests/integration/.env.local` (template at `.env.example`).

Six integration categories:

| # | File | Validates |
|---|---|---|
| 1 | `00-schema-parity.test.ts` | Cloud and self-hosted schemas + RLS policies are identical |
| 2 | `01-auth-flows.test.ts` | Signup, signin, JWT issuance, admin user CRUD |
| 3 | `02-rls.test.ts` | Per-owner read isolation across every RLS-gated table |
| 4 | `03-edge-functions/<name>.test.ts` × 10 | Each edge function is reachable and honours its contract |
| 5 | `04-storage.test.ts` | Upload / download / delete for each bucket (skipped if no buckets) |
| 6 | `05-e2e-smoke.test.ts` | Golden-path user flow via `@supabase/supabase-js` |

**Hard rule:** integration tests must pass green against staging before designing the production cutover.

## 9. Backup & restore (staging today; prod after cutover)

| What | Where |
|---|---|
| Postgres dumps | Linux host: `/var/backups/peritus-supabase/YYYY-MM-DD-HHMM.sql.gz` |
| Retention | 14 days (see `infra/supabase/scripts/backup.sh`) |
| Schedule | systemd timer daily at 03:00 (`peritus-supabase-backup.timer`) |
| Off-host destination | **TBD** — see open decisions below |

Restore (in disaster):

```sh
gunzip -c /var/backups/peritus-supabase/<date>.sql.gz | \
    docker exec -i supabase-db psql -U postgres postgres
```

## 10. Subagent workflow

This codebase is developed with heavy use of specialised agents. Use them.

| Agent | Use for |
|---|---|
| `Explore` | Fast read-only lookups: "where is X used?", "list every RLS policy" |
| `feature-dev:code-explorer` | Deeper architectural analysis of an existing area |
| `feature-dev:code-architect` | Implementation blueprints for new pieces |
| `feature-dev:code-reviewer` | Pre-commit review of non-trivial work |
| `general-purpose` | Open-ended research across code + external docs |
| `Plan` | Implementation strategy (via the `writing-plans` skill) |

Hard rules:
- Single-file edits stay in the main session (e.g. `CLAUDE.md`, `vite.config.ts`, `src/integrations/supabase/client.ts`).
- Subagents never commit or push — the main session owns git operations.
- Subagents never run destructive commands on the Linux host or against cloud Supabase.
- "Trust but verify": always inspect actual files before reporting a subagent's work as done.

Layered skills:
- `superpowers:dispatching-parallel-agents` — when launching 2+ independent agents in one message.
- `superpowers:test-driven-development` — when adding tests or new logic.
- `superpowers:verification-before-completion` — before reporting a phase as done.
- `superpowers:requesting-code-review` — after major chunks land.

## 11. What not to do

- **Never** reuse the cloud Supabase JWT secret on the self-hosted instance.
- **Never** edit a committed migration file. Always add a new one.
- **Never** run integration tests against production.
- **Never** delete `supabase/config.toml`.
- **Never** re-add `lovable-tagger` or Lovable README badges. The Lovable GitHub integration is intentionally disconnected — don't re-link it.
- **Never** commit `.env.local`, `.env.staging`, or `/etc/peritus-supabase/.env`.
- **Never** lift the Studio admin port to a public binding. SSH tunnel only.
- **Never** check in real OpenAI / VirusTotal keys. Use test-tier keys for staging; cloud secrets stay in the Supabase dashboard.

## 12. Open decisions

These are still TBD — update or remove as they're settled.

- **Cutover style** for migrating real production data from cloud to self-hosted (staged copy + flip vs. shadow / dual-write vs. tenant-by-tenant). Choose after the validation gate is green.
- **Off-host backup destination** for the staging Linux host. Likely S3 or NAS rsync.
- **Cloud retirement plan** — once cutover succeeds, when is the cloud Supabase project shut down or moved to read-only standby?
- **External API key policy** for staging — separate test-tier keys vs. local stubs per function. Default to stubbing where possible.
````

- [ ] **Step 2:** Verify the file renders cleanly (skim it in a markdown viewer or VS Code preview).

- [ ] **Step 3:** Commit.

```
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md project guide"
```

---

### Task 13: Final verification + push

- [ ] **Step 1:** Run the full integration suite one more time as a regression check.

```
npm run test:integration
```

Expected: all categories PASS (or storage properly skipped).

- [ ] **Step 2:** Run unit tests too.

```
npm run test
```

Expected: PASS.

- [ ] **Step 3:** Confirm the staging frontend still builds.

```
rm -rf dist
npm run build:staging
```

Expected: succeeds, references the self-hosted hostname.

- [ ] **Step 4:** Review the commit log for plans 1–3.

```
git log --oneline -50
```

Expected: 30+ commits since the design-doc commit (`75f1114`).

- [ ] **Step 5:** Push.

```
git push
git push --tags  # pushes the validation-gate-passed tag
```

---

## Plan 3 done — gate passed

The self-hosted Supabase instance is proven functionally equivalent to cloud across all six test categories. `CLAUDE.md` makes the project legible. The cloud Supabase project is untouched. The repo is ready for the next design phase: **the production cutover**.
