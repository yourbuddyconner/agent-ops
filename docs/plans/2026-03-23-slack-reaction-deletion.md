# Slack Reaction-Based Message Deletion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to delete their bot's Slack messages by reacting with ❌, with ownership verified via Slack message metadata.

**Architecture:** Attach `metadata: { event_type: "valet_bot_message", event_payload: { userId } }` to every `chat.postMessage` call. Handle `reaction_added` events in the existing Slack events route — fetch the message, verify ownership via metadata, call `chat.delete`, and send an ephemeral confirmation.

**Tech Stack:** Hono routes, Slack Web API (`chat.postMessage`, `conversations.history`, `chat.delete`, `chat.postEphemeral`), Vitest

**Spec:** `docs/specs/2026-03-23-slack-reaction-deletion-design.md`

---

### Task 1: Attach ownership metadata to outbound Slack messages

**Files:**
- Modify: `packages/plugin-slack/src/channels/transport.ts:440-477` (`sendMessage` method)

- [ ] **Step 1: Add metadata to the `chat.postMessage` body**

In `sendMessage()`, after the persona overrides block (after line 468) and before the `slackApiCall` (line 471), add the metadata field to `body`:

```typescript
// Ownership metadata for reaction-based deletion
if (ctx.userId) {
  body.metadata = {
    event_type: 'valet_bot_message',
    event_payload: { userId: ctx.userId },
  };
}
```

Note: Since `slackApiCall` sends the body as `application/json` via `JSON.stringify(body)`, the `metadata` field must be a nested object — Slack handles the serialization. Do NOT pre-stringify it.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/plugin-slack && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-slack/src/channels/transport.ts
git commit -m "feat(slack): attach ownership metadata to outbound bot messages"
```

---

### Task 2: Add `handleReactionDeletion` service function

**Files:**
- Modify: `packages/worker/src/services/slack.ts` (add new function at end of file)

- [ ] **Step 1: Write the `handleReactionDeletion` function**

Add to the end of `packages/worker/src/services/slack.ts`:

```typescript
// ─── Reaction-Based Message Deletion ─────────────────────────────────────────

export interface ReactionDeletionResult {
  deleted: boolean;
  reason?: string;
}

/**
 * Handle a reaction_added event for message deletion.
 * Fetches the reacted-to message, checks ownership metadata, deletes if authorized.
 */
export async function handleReactionDeletion(
  botToken: string,
  channel: string,
  messageTs: string,
  reactingSlackUserId: string,
  env: Env,
): Promise<ReactionDeletionResult> {
  const appDb = getDb(env.DB);

  // 1. Resolve reacting Slack user → Valet user
  const valetUserId = await db.resolveUserByExternalId(appDb, 'slack', reactingSlackUserId);
  if (!valetUserId) {
    return { deleted: false, reason: 'not_valet_user' };
  }

  // 2. Fetch the message to read its metadata
  const historyResp = await fetch(`${SLACK_API}/conversations.history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      channel,
      latest: messageTs,
      limit: 1,
      inclusive: true,
    }),
  });

  if (!historyResp.ok) {
    return { deleted: false, reason: 'history_fetch_failed' };
  }

  const historyData = (await historyResp.json()) as {
    ok: boolean;
    messages?: Array<{
      ts: string;
      metadata?: { event_type: string; event_payload: { userId?: string } };
    }>;
  };

  if (!historyData.ok || !historyData.messages?.length) {
    return { deleted: false, reason: 'message_not_found' };
  }

  const message = historyData.messages[0];

  // 3. Check metadata ownership
  if (message.metadata?.event_type !== 'valet_bot_message') {
    return { deleted: false, reason: 'not_valet_message' };
  }

  const messageOwnerId = message.metadata.event_payload?.userId;
  if (messageOwnerId !== valetUserId) {
    return { deleted: false, reason: 'not_owner' };
  }

  // 4. Delete the message
  const deleteResp = await fetch(`${SLACK_API}/chat.delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, ts: messageTs }),
  });

  const deleteData = (await deleteResp.json()) as { ok: boolean; error?: string };
  if (!deleteData.ok) {
    console.error(`[Slack] chat.delete failed: ${deleteData.error}`);
    return { deleted: false, reason: 'delete_failed' };
  }

  // 5. Send ephemeral confirmation
  await fetch(`${SLACK_API}/chat.postEphemeral`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      channel,
      user: reactingSlackUserId,
      text: 'Message deleted.',
    }),
  });

  return { deleted: true };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/worker && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/services/slack.ts
git commit -m "feat(slack): add handleReactionDeletion service function"
```

---

### Task 3: Handle `reaction_added` events in the Slack events route

**Files:**
- Modify: `packages/worker/src/routes/slack-events.ts:98-110` (add early return for reaction events)

- [ ] **Step 1: Add the reaction handler import**

At the top of `slack-events.ts`, add `handleReactionDeletion` to the import from `../services/slack.js`:

```typescript
import { getSlackUserInfo, getSlackBotInfo, handleReactionDeletion } from '../services/slack.js';
```

- [ ] **Step 2: Add the `reaction_added` handler**

After extracting `eventType` (line 100) and before the `slackUserId` extraction (line 105), add the early return for reaction events:

```typescript
  // ─── Reaction-based message deletion ────────────────────────────────
  if (eventType === 'reaction_added') {
    const reaction = event?.reaction as string | undefined;
    if (reaction === 'x') {
      const item = event?.item as { channel?: string; ts?: string } | undefined;
      const reactingUser = event?.user as string | undefined;
      if (item?.channel && item?.ts && reactingUser) {
        c.executionCtx.waitUntil(
          handleReactionDeletion(botToken, item.channel, item.ts, reactingUser, c.env)
            .then((result) => {
              if (result.deleted) {
                console.log(`[Slack] Reaction deletion: channel=${item.channel} ts=${item.ts}`);
              } else {
                console.log(`[Slack] Reaction deletion skipped: ${result.reason}`);
              }
            })
            .catch((err) => console.error('[Slack] Reaction deletion error:', err))
        );
      }
    }
    return c.json({ ok: true });
  }
```

This uses `waitUntil` so the 200 response goes back to Slack immediately (avoiding retries), while the deletion runs in the background.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/worker && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/routes/slack-events.ts
git commit -m "feat(slack): handle reaction_added events for message deletion"
```

---

### Task 4: Write tests for `reaction_added` handling

**Files:**
- Modify: `packages/worker/src/routes/slack-events.test.ts` (add new `describe` block)

- [ ] **Step 1: Add `handleReactionDeletion` mock**

In the existing `vi.mock('../services/slack.js', ...)` block (line 69), add the mock:

```typescript
vi.mock('../services/slack.js', () => ({
  getSlackUserInfo: vi.fn(),
  getSlackBotInfo: vi.fn(),
  handleReactionDeletion: handleReactionDeletionMock,
}));
```

And add to the `vi.hoisted` block (line 17):

```typescript
handleReactionDeletionMock: vi.fn(),
```

- [ ] **Step 2: Write test for successful reaction deletion**

Add a new `describe('reaction_added events', ...)` block with tests:

```typescript
describe('reaction_added events', () => {
  const envBindings = {
    DB: {},
    ENCRYPTION_KEY: 'test-key',
    SLACK_SIGNING_SECRET: 'fallback-secret',
  } as any;

  beforeEach(() => {
    getOrgSlackInstallMock.mockResolvedValue({
      botToken: 'xoxb-test',
      signingSecret: 'test-secret',
      teamId: 'T123',
    });
    verifySlackSignatureMock.mockResolvedValue(true);
    handleReactionDeletionMock.mockResolvedValue({ deleted: true });
  });

  function buildReactionRequest(payload: Record<string, unknown>) {
    return new Request('http://localhost/channels/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('dispatches handleReactionDeletion for :x: reaction', async () => {
    const app = buildApp();
    const waitUntil = vi.fn((p: Promise<unknown>) => p);
    const payload = {
      type: 'event_callback',
      team_id: 'T123',
      event: {
        type: 'reaction_added',
        reaction: 'x',
        user: 'U_REACTOR',
        item: { type: 'message', channel: 'C_CHAN', ts: '1234567890.123456' },
      },
    };

    const resp = await app.fetch(
      buildReactionRequest(payload),
      envBindings,
      { waitUntil } as any,
    );

    expect(resp.status).toBe(200);
    // waitUntil captures the background promise — await it to flush
    await Promise.all(waitUntil.mock.calls.map(([p]) => p));
    expect(handleReactionDeletionMock).toHaveBeenCalledWith(
      'xoxb-test',
      'C_CHAN',
      '1234567890.123456',
      'U_REACTOR',
      expect.anything(),
    );
  });

  it('ignores non-:x: reactions', async () => {
    const app = buildApp();
    const payload = {
      type: 'event_callback',
      team_id: 'T123',
      event: {
        type: 'reaction_added',
        reaction: 'thumbsup',
        user: 'U_REACTOR',
        item: { type: 'message', channel: 'C_CHAN', ts: '1234567890.123456' },
      },
    };

    const resp = await app.fetch(
      buildReactionRequest(payload),
      envBindings,
      { waitUntil: vi.fn() } as any,
    );

    expect(resp.status).toBe(200);
    expect(handleReactionDeletionMock).not.toHaveBeenCalled();
  });

  it('returns 200 even without item data', async () => {
    const app = buildApp();
    const payload = {
      type: 'event_callback',
      team_id: 'T123',
      event: {
        type: 'reaction_added',
        reaction: 'x',
        user: 'U_REACTOR',
        // missing item
      },
    };

    const resp = await app.fetch(
      buildReactionRequest(payload),
      envBindings,
      { waitUntil: vi.fn() } as any,
    );

    expect(resp.status).toBe(200);
    expect(handleReactionDeletionMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/worker && pnpm vitest run src/routes/slack-events.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/routes/slack-events.test.ts
git commit -m "test(slack): add reaction_added event handling tests"
```

---

### Task 5: Verify end-to-end and update Slack app config

**Files:** None (configuration + manual verification)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors across all packages

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 3: Document Slack app config requirement**

The Slack app must subscribe to `reaction_added` events. This is configured in the Slack App dashboard under **Event Subscriptions → Subscribe to bot events**. Add `reaction_added` to the list.

Add a note to the spec's "Changes required" table confirming this is a manual step:

> **Slack App dashboard:** Add `reaction_added` to bot event subscriptions. This is a one-time manual step in the Slack API dashboard.

- [ ] **Step 4: Final commit**

```bash
git add docs/specs/2026-03-23-slack-reaction-deletion-design.md
git commit -m "docs: note Slack app config requirement for reaction_added events"
```
