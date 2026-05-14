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
| `X-Signature`  | Hex signature                               |

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
| `secret`    | `POST` | `/x`             | `1700000000`  | `{}`        | `(compute and pin during phase 2 implementation)`                  |
| `secret`    | `GET`  | `/agent-version-check` | `1700000000` | (empty)   | `(compute and pin during phase 2 implementation)`                  |

These vectors will be generated and pinned into `hmac.test.ts` as part of phase 2 implementation work — at that point both runtimes must match them byte-for-byte.
