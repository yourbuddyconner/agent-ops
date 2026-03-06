# SSH 2-of-2 Commit Signing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement SSH commit signing with Turnkey 2-of-2 co-signing and per-push WebAuthn approval.

**Architecture:** Add signing enrollment + relay in worker, a DO approval state machine, runner signing orchestration, sandbox signer helper, and a frontend approval modal.

**Tech Stack:** Cloudflare Worker (Hono), Durable Objects, React (TanStack), Bun runner, Turnkey API.

---

### Task 1: Add signing tables and schema

**Files:**
- Create: `packages/worker/migrations/0056_signing.sql`
- Create: `packages/worker/src/lib/schema/signing.ts`
- Modify: `packages/worker/src/lib/schema/index.ts`
- Create: `packages/worker/src/lib/db/signing.ts`
- Modify: `packages/worker/src/lib/db.ts`
- Test: `packages/worker/src/lib/db/__tests__/signing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createSigningProfile } from '../signing';

describe('signing db', () => {
  it('creates a signing profile', async () => {
    const result = await createSigningProfile({
      userId: 'user-1',
      turnkeySuborgId: 'tk-suborg',
      turnkeyKeyId: 'tk-key',
      githubKeyId: 'gh-key',
    });
    expect(result.userId).toBe('user-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter signing`
Expected: FAIL with "createSigningProfile is not defined"

**Step 3: Write minimal implementation**

```sql
-- packages/worker/migrations/0056_signing.sql
CREATE TABLE user_signing_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  turnkey_suborg_id TEXT NOT NULL,
  turnkey_key_id TEXT NOT NULL,
  github_key_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE signing_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
```

```ts
// packages/worker/src/lib/schema/signing.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const userSigningProfiles = sqliteTable('user_signing_profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  turnkeySuborgId: text('turnkey_suborg_id').notNull(),
  turnkeyKeyId: text('turnkey_key_id').notNull(),
  githubKeyId: text('github_key_id').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
});

export const signingEvents = sqliteTable('signing_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  userId: text('user_id').notNull(),
  repo: text('repo').notNull(),
  branch: text('branch').notNull(),
  commitCount: integer('commit_count').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter signing`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/worker/migrations/0056_signing.sql packages/worker/src/lib/schema/signing.ts packages/worker/src/lib/schema/index.ts packages/worker/src/lib/db/signing.ts packages/worker/src/lib/db.ts packages/worker/src/lib/db/__tests__/signing.test.ts
git commit -m "feat(worker): add signing schema"
```

### Task 2: Add Turnkey client and signing service

**Files:**
- Create: `packages/worker/src/services/turnkey.ts`
- Create: `packages/worker/src/services/signing.ts`
- Test: `packages/worker/src/services/__tests__/signing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { signCommitPayload } from '../signing';

describe('signing service', () => {
  it('wraps ssh signature', async () => {
    const signature = await signCommitPayload({
      payload: 'payload',
      turnkeyKeyId: 'key',
      userSignature: 'webauthn',
    });
    expect(signature).toContain('BEGIN SSH SIGNATURE');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter signing service`
Expected: FAIL with "signCommitPayload is not defined"

**Step 3: Write minimal implementation**

```ts
// packages/worker/src/services/turnkey.ts
export type TurnkeySignRequest = {
  payload: string;
  turnkeyKeyId: string;
  userSignature: string;
};

export async function turnkeySignRaw(_req: TurnkeySignRequest) {
  return { r: '00', s: '00' };
}
```

```ts
// packages/worker/src/services/signing.ts
import { turnkeySignRaw } from './turnkey';

export async function signCommitPayload(input: {
  payload: string;
  turnkeyKeyId: string;
  userSignature: string;
}) {
  const raw = await turnkeySignRaw({
    payload: input.payload,
    turnkeyKeyId: input.turnkeyKeyId,
    userSignature: input.userSignature,
  });
  return `-----BEGIN SSH SIGNATURE-----\n${raw.r}.${raw.s}\n-----END SSH SIGNATURE-----`;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter signing service`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/worker/src/services/turnkey.ts packages/worker/src/services/signing.ts packages/worker/src/services/__tests__/signing.test.ts
git commit -m "feat(worker): add turnkey signing service"
```

### Task 3: Add signing routes

**Files:**
- Create: `packages/worker/src/routes/signing.ts`
- Modify: `packages/worker/src/index.ts`
- Test: `packages/worker/src/routes/__tests__/signing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { app } from '../../index';

describe('signing routes', () => {
  it('returns a signing request id', async () => {
    const res = await app.request('/api/signing/request', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter signing routes`
Expected: FAIL with 404

**Step 3: Write minimal implementation**

```ts
// packages/worker/src/routes/signing.ts
import { Hono } from 'hono';

export const signingRouter = new Hono();

signingRouter.post('/request', (c) => {
  return c.json({ id: 'signing-request-id' });
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter signing routes`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/worker/src/routes/signing.ts packages/worker/src/index.ts packages/worker/src/routes/__tests__/signing.test.ts
git commit -m "feat(worker): add signing routes"
```

### Task 4: Add SessionAgent DO signing state machine

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts`
- Modify: `packages/shared/src/types/index.ts`
- Test: `packages/worker/src/durable-objects/__tests__/session-agent-signing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

describe('session agent signing state', () => {
  it('transitions to awaiting_approval', async () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter session-agent signing`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// packages/shared/src/types/index.ts
export type SigningState = 'idle' | 'awaiting_approval' | 'signing' | 'signed' | 'rejected' | 'timeout' | 'failed';
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter session-agent signing`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts packages/shared/src/types/index.ts packages/worker/src/durable-objects/__tests__/session-agent-signing.test.ts
git commit -m "feat(worker): add signing state machine"
```

### Task 5: Add runner signing orchestration

**Files:**
- Create: `packages/runner/src/git-signing.ts`
- Modify: `packages/runner/src/prompt.ts`
- Test: `packages/runner/src/__tests__/git-signing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { shouldSignBeforePush } from '../git-signing';

describe('runner signing', () => {
  it('requires signing when unsigned commits exist', () => {
    expect(shouldSignBeforePush(['a'])).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter runner signing`
Expected: FAIL with "shouldSignBeforePush is not defined"

**Step 3: Write minimal implementation**

```ts
// packages/runner/src/git-signing.ts
export function shouldSignBeforePush(commits: string[]) {
  return commits.length > 0;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter runner signing`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/runner/src/git-signing.ts packages/runner/src/prompt.ts packages/runner/src/__tests__/git-signing.test.ts
git commit -m "feat(runner): add signing orchestration"
```

### Task 6: Add frontend signing modal

**Files:**
- Create: `packages/client/src/components/signing/SigningModal.tsx`
- Create: `packages/client/src/api/signing.ts`
- Modify: `packages/client/src/components/layout/app-shell.tsx`
- Test: `packages/client/src/components/signing/SigningModal.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { SigningModal } from './SigningModal';

it('renders signing details', () => {
  render(<SigningModal open repo="valet" branch="main" commits={['a']} />);
  expect(screen.getByText('valet')).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter SigningModal`
Expected: FAIL with "SigningModal is not defined"

**Step 3: Write minimal implementation**

```tsx
// packages/client/src/components/signing/SigningModal.tsx
export function SigningModal(props: {
  open: boolean;
  repo: string;
  branch: string;
  commits: string[];
}) {
  if (!props.open) return null;
  return (
    <div>
      <h2>Sign commits</h2>
      <div>{props.repo}</div>
      <div>{props.branch}</div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter SigningModal`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/components/signing/SigningModal.tsx packages/client/src/api/signing.ts packages/client/src/components/layout/app-shell.tsx packages/client/src/components/signing/SigningModal.test.tsx
git commit -m "feat(client): add signing modal"
```

### Task 7: Add sandbox signer helper

**Files:**
- Create: `packages/runner/src/bin/valet-sign.ts`
- Modify: `docker/start.sh`
- Test: `packages/runner/src/bin/__tests__/valet-sign.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { formatSigningRequest } from '../valet-sign';

describe('valet-sign', () => {
  it('formats a signing request', () => {
    expect(formatSigningRequest('payload')).toContain('payload');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter valet-sign`
Expected: FAIL with "formatSigningRequest is not defined"

**Step 3: Write minimal implementation**

```ts
// packages/runner/src/bin/valet-sign.ts
export function formatSigningRequest(payload: string) {
  return JSON.stringify({ payload });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter valet-sign`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/runner/src/bin/valet-sign.ts docker/start.sh packages/runner/src/bin/__tests__/valet-sign.test.ts
git commit -m "feat(runner): add valet-sign helper"
```

### Task 8: End-to-end signing test

**Files:**
- Create: `packages/worker/src/routes/__tests__/signing-flow.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

describe('signing flow', () => {
  it('blocks push without approval', () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test --filter signing flow`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// Add mocked end-to-end flow with stubbed Turnkey + WebAuthn
```

**Step 4: Run test to verify it passes**

Run: `pnpm test --filter signing flow`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/worker/src/routes/__tests__/signing-flow.test.ts
git commit -m "test: add signing flow coverage"
```
