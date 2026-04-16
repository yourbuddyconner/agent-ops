# Sandbox JWT Secret Isolation

**Date:** 2026-04-07
**Status:** Implemented (2026-04-15)

## Problem

The worker's `ENCRYPTION_KEY` is passed verbatim to every sandbox as `JWT_SECRET`. This key is the root of trust for all credential encryption (AES-GCM for OAuth tokens, Slack tokens, GitHub App config, org API keys). A compromised sandbox could use it to decrypt any org's stored credentials.

The sandbox only needs the key for two things:
1. Verifying client JWTs on the auth gateway (port 9000)
2. Minting tunnel-access JWTs inside OpenCode tools

Neither requires the actual encryption key.

## Design

Derive a per-session signing key using HMAC:

```
sandboxJwtSecret = hex(HMAC-SHA256(ENCRYPTION_KEY, sessionId))
```

The worker passes this derived key instead of `ENCRYPTION_KEY`. The derived key is:
- **Unique per session** — compromising one sandbox reveals nothing about another's key
- **Irreversible** — cannot recover `ENCRYPTION_KEY` from the derived key
- **Deterministic** — the worker can recompute it from the session ID without storing anything
- **Compatible** — same HMAC-SHA256 algorithm the gateway already uses; no sandbox-side changes

## Changes

### 1. New derivation function — `packages/worker/src/lib/jwt.ts`

```ts
export async function deriveSandboxJwtSecret(
  encryptionKey: string,
  sessionId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(encryptionKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(sessionId),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### 2. Spawn requests — every call site that builds a `spawnRequest`

Three call sites pass `jwtSecret` to the Modal backend. All switch from `env.ENCRYPTION_KEY` to the derived key:

- `packages/worker/src/services/sessions.ts` — regular session spawn
- `packages/worker/src/services/orchestrator.ts` — orchestrator session spawn
- `packages/worker/src/durable-objects/workflow-executor.ts` — workflow-triggered session spawn

Before:
```ts
jwtSecret: env.ENCRYPTION_KEY,
```

After:
```ts
jwtSecret: await deriveSandboxJwtSecret(env.ENCRYPTION_KEY, sessionId),
```

### 3. Token issuance — `packages/worker/src/services/sessions.ts` (~line 537)

`issueSandboxToken()` currently signs with `env.ENCRYPTION_KEY`. Change to:

```ts
const secret = await deriveSandboxJwtSecret(env.ENCRYPTION_KEY, sessionId);
const token = await signJWT({ sub: userId, sid: sessionId }, secret, 15 * 60);
```

### 4. No sandbox-side changes

The gateway (`packages/runner/src/gateway.ts`) and tunnel tool (`docker/opencode/tools/write_tunnel_env.ts`) read `process.env.JWT_SECRET` and verify/sign with whatever value they receive. They work identically with a derived key.

## Existing sessions

Already-running sandboxes have the raw `ENCRYPTION_KEY` as their `JWT_SECRET`. After deploy, the worker will derive a different key for token signing, so gateway auth will fail for those sessions. This is acceptable:
- Orchestrator sessions auto-restart
- Regular sessions can be woken fresh (hibernate/wake cycle)
- No data loss — session state is in D1/DO, not the sandbox

## Not in scope

- Rotating `ENCRYPTION_KEY` itself
- Asymmetric signing (unnecessary for this threat model)
- Re-encrypting stored credentials
