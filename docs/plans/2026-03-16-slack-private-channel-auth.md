# Slack Private Channel Authorization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce private channel membership checks so agent Slack actions and inbound webhooks respect the session owner's actual channel access.

**Architecture:** A `checkPrivateChannelAccess()` helper in the Slack plugin calls `conversations.info` + `conversations.members` to verify the owner's linked Slack identity is a member before allowing access. Each channel-targeting action calls it. The inbound webhook handler calls it for non-DM mentions. No caching, no new DB tables.

**Tech Stack:** TypeScript, Slack Web API (`conversations.info`, `conversations.members`), vitest

**Spec:** `docs/specs/2026-03-16-slack-private-channel-auth-design.md`

---

## Chunk 1: Membership check helper + action enforcement

### Task 1: Create `checkPrivateChannelAccess` helper

**Files:**
- Create: `packages/plugin-slack/src/actions/channel-access.ts`
- Test: `packages/plugin-slack/src/actions/channel-access.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/plugin-slack/src/actions/channel-access.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const slackGetMock = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ slackGet: slackGetMock }));

import { checkPrivateChannelAccess } from './channel-access.js';

function mockSlackResponse(data: Record<string, unknown>) {
  return { ok: true, json: () => Promise.resolve({ ok: true, ...data }) };
}

function mockSlackError(error: string) {
  return { ok: true, json: () => Promise.resolve({ ok: false, error }) };
}

describe('checkPrivateChannelAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows public channels without membership check', async () => {
    slackGetMock.mockResolvedValueOnce(
      mockSlackResponse({ channel: { id: 'C123', is_private: false, is_im: false, is_mpim: false } }),
    );

    const result = await checkPrivateChannelAccess('xoxb-token', 'C123', 'U999');
    expect(result).toEqual({ allowed: true, isPrivate: false });
    // Should NOT call conversations.members
    expect(slackGetMock).toHaveBeenCalledTimes(1);
    expect(slackGetMock).toHaveBeenCalledWith('conversations.info', 'xoxb-token', { channel: 'C123' });
  });

  it('allows DMs (is_im) without membership check', async () => {
    slackGetMock.mockResolvedValueOnce(
      mockSlackResponse({ channel: { id: 'D123', is_private: false, is_im: true, is_mpim: false } }),
    );

    const result = await checkPrivateChannelAccess('xoxb-token', 'D123', 'U999');
    expect(result).toEqual({ allowed: true, isPrivate: false });
    expect(slackGetMock).toHaveBeenCalledTimes(1);
  });

  it('allows group DMs (is_mpim) without membership check', async () => {
    slackGetMock.mockResolvedValueOnce(
      mockSlackResponse({ channel: { id: 'G123', is_private: false, is_im: false, is_mpim: true } }),
    );

    const result = await checkPrivateChannelAccess('xoxb-token', 'G123', 'U999');
    expect(result).toEqual({ allowed: true, isPrivate: false });
    expect(slackGetMock).toHaveBeenCalledTimes(1);
  });

  it('denies private channels when ownerSlackUserId is undefined', async () => {
    slackGetMock.mockResolvedValueOnce(
      mockSlackResponse({ channel: { id: 'C123', is_private: true, is_im: false, is_mpim: false } }),
    );

    const result = await checkPrivateChannelAccess('xoxb-token', 'C123', undefined);
    expect(result).toEqual({
      allowed: false,
      isPrivate: true,
      error: 'Owner has not linked their Slack identity. Link it in Settings > Integrations > Slack.',
    });
    expect(slackGetMock).toHaveBeenCalledTimes(1);
  });

  it('allows private channels when owner is a member', async () => {
    slackGetMock
      .mockResolvedValueOnce(
        mockSlackResponse({ channel: { id: 'C123', is_private: true, is_im: false, is_mpim: false } }),
      )
      .mockResolvedValueOnce(
        mockSlackResponse({ members: ['U001', 'U999', 'U002'], response_metadata: {} }),
      );

    const result = await checkPrivateChannelAccess('xoxb-token', 'C123', 'U999');
    expect(result).toEqual({ allowed: true, isPrivate: true });
  });

  it('denies private channels when owner is not a member', async () => {
    slackGetMock
      .mockResolvedValueOnce(
        mockSlackResponse({ channel: { id: 'C123', is_private: true, is_im: false, is_mpim: false } }),
      )
      .mockResolvedValueOnce(
        mockSlackResponse({ members: ['U001', 'U002'], response_metadata: {} }),
      );

    const result = await checkPrivateChannelAccess('xoxb-token', 'C123', 'U999');
    expect(result).toEqual({
      allowed: false,
      isPrivate: true,
      error: 'Access denied: you are not a member of this private channel',
    });
  });

  it('paginates conversations.members to find owner', async () => {
    slackGetMock
      .mockResolvedValueOnce(
        mockSlackResponse({ channel: { id: 'C123', is_private: true, is_im: false, is_mpim: false } }),
      )
      .mockResolvedValueOnce(
        mockSlackResponse({ members: ['U001', 'U002'], response_metadata: { next_cursor: 'cursor1' } }),
      )
      .mockResolvedValueOnce(
        mockSlackResponse({ members: ['U999', 'U003'], response_metadata: {} }),
      );

    const result = await checkPrivateChannelAccess('xoxb-token', 'C123', 'U999');
    expect(result).toEqual({ allowed: true, isPrivate: true });
    expect(slackGetMock).toHaveBeenCalledTimes(3);
  });

  it('handles conversations.info API error gracefully', async () => {
    slackGetMock.mockResolvedValueOnce(mockSlackError('channel_not_found'));

    const result = await checkPrivateChannelAccess('xoxb-token', 'C123', 'U999');
    expect(result).toEqual({
      allowed: false,
      isPrivate: false,
      error: 'Slack API error checking channel: channel_not_found',
    });
  });

  it('handles conversations.members API error gracefully', async () => {
    slackGetMock
      .mockResolvedValueOnce(
        mockSlackResponse({ channel: { id: 'C123', is_private: true, is_im: false, is_mpim: false } }),
      )
      .mockResolvedValueOnce(mockSlackError('not_in_channel'));

    const result = await checkPrivateChannelAccess('xoxb-token', 'C123', 'U999');
    expect(result).toEqual({
      allowed: false,
      isPrivate: true,
      error: 'Slack API error checking membership: not_in_channel',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/plugin-slack && npx vitest run src/actions/channel-access.test.ts`
Expected: FAIL — `channel-access.js` does not exist

- [ ] **Step 3: Implement the helper**

```typescript
// packages/plugin-slack/src/actions/channel-access.ts
import { slackGet } from './api.js';

export interface ChannelAccessResult {
  allowed: boolean;
  isPrivate: boolean;
  error?: string;
}

/**
 * Check if a user has access to a Slack channel.
 * Public channels, DMs, and group DMs are always allowed.
 * Private channels require the user to be a member (via conversations.members).
 *
 * NOTE: Org orchestrators may need an exemption here in the future,
 * since they aren't tied to a single user.
 */
export async function checkPrivateChannelAccess(
  token: string,
  channelId: string,
  ownerSlackUserId: string | undefined,
): Promise<ChannelAccessResult> {
  // 1. Get channel info
  const infoRes = await slackGet('conversations.info', token, { channel: channelId });
  const infoData = (await infoRes.json()) as {
    ok: boolean;
    error?: string;
    channel?: { is_private?: boolean; is_im?: boolean; is_mpim?: boolean };
  };

  if (!infoData.ok) {
    return { allowed: false, isPrivate: false, error: `Slack API error checking channel: ${infoData.error}` };
  }

  const channel = infoData.channel;
  if (!channel) {
    return { allowed: false, isPrivate: false, error: 'Slack API error checking channel: no channel data' };
  }

  // 2. DMs and group DMs are always allowed
  if (channel.is_im || channel.is_mpim) {
    return { allowed: true, isPrivate: false };
  }

  // 3. Public channels are always allowed
  if (!channel.is_private) {
    return { allowed: true, isPrivate: false };
  }

  // 4. Private channel — need owner's Slack identity
  if (!ownerSlackUserId) {
    return {
      allowed: false,
      isPrivate: true,
      error: 'Owner has not linked their Slack identity. Link it in Settings > Integrations > Slack.',
    };
  }

  // 5. Check membership via paginated conversations.members
  let cursor: string | undefined;
  do {
    const params: Record<string, unknown> = { channel: channelId, limit: 200 };
    if (cursor) params.cursor = cursor;

    const membersRes = await slackGet('conversations.members', token, params);
    const membersData = (await membersRes.json()) as {
      ok: boolean;
      error?: string;
      members?: string[];
      response_metadata?: { next_cursor?: string };
    };

    if (!membersData.ok) {
      return { allowed: false, isPrivate: true, error: `Slack API error checking membership: ${membersData.error}` };
    }

    if (membersData.members?.includes(ownerSlackUserId)) {
      return { allowed: true, isPrivate: true };
    }

    cursor = membersData.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return {
    allowed: false,
    isPrivate: true,
    error: 'Access denied: you are not a member of this private channel',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/plugin-slack && npx vitest run src/actions/channel-access.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-slack/src/actions/channel-access.ts packages/plugin-slack/src/actions/channel-access.test.ts
git commit -m "feat: add checkPrivateChannelAccess helper for Slack channel membership verification"
```

---

### Task 2: Add membership checks to channel-targeting actions

**Files:**
- Modify: `packages/plugin-slack/src/actions/actions.ts`

The `executeAction` function needs to call `checkPrivateChannelAccess` before executing `post_message`, `read_history`, `read_thread`, and `add_reaction`. For `list_channels`, filter private channels from results.

- [ ] **Step 1: Add guard to `post_message`, `read_history`, `read_thread`, `add_reaction`**

In `packages/plugin-slack/src/actions/actions.ts`, add the import at the top:

```typescript
import { checkPrivateChannelAccess } from './channel-access.js';
```

Then add a reusable helper inside the file (after the `slackError` function):

```typescript
/** Guard that checks private channel membership. Returns an error ActionResult if denied, or null if allowed. */
async function guardPrivateChannel(token: string, channelId: string, ctx: ActionContext): Promise<ActionResult | null> {
  const result = await checkPrivateChannelAccess(token, channelId, ctx.credentials.owner_slack_user_id);
  if (!result.allowed) {
    return { success: false, error: result.error || 'Access denied' };
  }
  return null;
}
```

Then add the guard call at the start of each relevant case in the switch statement.

**`slack.post_message`** — after resolving `channel`, before building the body. Note: `post_message` accepts channel names (e.g. `"general"`) in addition to IDs. Slack's `conversations.info` only accepts IDs (`C...`/`G...`), so skip the guard when the value doesn't look like a channel ID — name-resolved channels are public by definition:
```typescript
// Only check channels identified by ID (C.../G...) — names resolve to public channels only
const isChannelId = /^[CG]/.test(channel);
if (isChannelId) {
  const denied = await guardPrivateChannel(token, channel, ctx);
  if (denied) return denied;
}
```

**`slack.read_history`** — after parsing params, before the API call:
```typescript
const denied = await guardPrivateChannel(token, p.channel, ctx);
if (denied) return denied;
```

**`slack.read_thread`** — after parsing params, before the API call:
```typescript
const denied = await guardPrivateChannel(token, p.channel, ctx);
if (denied) return denied;
```

**`slack.add_reaction`** — after parsing params, before the API call:
```typescript
const denied = await guardPrivateChannel(token, p.channel, ctx);
if (denied) return denied;
```

- [ ] **Step 2: Add private channel filtering to `list_channels`**

In the `slack.list_channels` case, after `let channels = allChannels.map(slimChannel);` and after the prefix filter, add:

```typescript
// Filter out private channels the owner doesn't have access to
const ownerSlackUserId = ctx.credentials.owner_slack_user_id;
if (ownerSlackUserId) {
  const privateChannels = channels.filter((ch) => ch.is_private === true);
  if (privateChannels.length > 0) {
    const accessChecks = await Promise.all(
      privateChannels.map(async (ch) => {
        const result = await checkPrivateChannelAccess(token, ch.id as string, ownerSlackUserId);
        return { id: ch.id, allowed: result.allowed };
      }),
    );
    const deniedIds = new Set(accessChecks.filter((c) => !c.allowed).map((c) => c.id));
    channels = channels.filter((ch) => !deniedIds.has(ch.id));
  }
} else {
  // No linked identity — filter out all private channels
  channels = channels.filter((ch) => ch.is_private !== true);
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/plugin-slack && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-slack/src/actions/actions.ts
git commit -m "feat: enforce private channel membership checks on Slack actions"
```

---

## Chunk 2: Inbound webhook enforcement

### Task 3: Add membership check to inbound Slack events

**Files:**
- Modify: `packages/worker/src/routes/slack-events.ts`
- Test: `packages/worker/src/routes/slack-events.test.ts`

The check goes after identity resolution (line 189) and after the routing decision identifies a non-DM mention. The `checkPrivateChannelAccess` function lives in the plugin package, but the worker already imports from `@valet/plugin-slack/channels`. We need to also import from the actions side, or replicate the check. Since the worker already depends on `@valet/plugin-slack`, importing from `@valet/plugin-slack/actions` is clean.

However, the current `package.json` exports are `./actions` and `./channels`. The worker's `package.json` already has `@valet/plugin-slack` as a dependency. We need to check if the export path works.

Actually — `checkPrivateChannelAccess` uses `slackGet` from the Slack plugin's `api.ts`, which makes raw `fetch` calls. This works fine in the Worker environment. The import path would be:

```typescript
import { checkPrivateChannelAccess } from '@valet/plugin-slack/actions';
```

But we need to re-export it from the actions index.

- [ ] **Step 1: Export `checkPrivateChannelAccess` from the actions barrel**

In `packages/plugin-slack/src/actions/index.ts`, add:

```typescript
export { checkPrivateChannelAccess } from './channel-access.js';
```

- [ ] **Step 2: Write the failing test for inbound private channel denial**

Add to `packages/worker/src/routes/slack-events.test.ts`.

First, add the `checkPrivateChannelAccess` mock alongside existing hoisted mocks at the top:

```typescript
const {
  // ... existing mocks ...
  checkPrivateChannelAccessMock,
} = vi.hoisted(() => ({
  // ... existing mocks ...
  checkPrivateChannelAccessMock: vi.fn(),
}));
```

Add additional DB mocks needed for the `/slack/events` flow (the existing test file only mocks DB functions used by `/slack/interactive`):

```typescript
const {
  getOrgSlackInstallMock,
  resolveUserByExternalIdMock,
  getInvocationMock,
  getSessionMock,
  decryptStringMock,
  verifySlackSignatureMock,
  checkPrivateChannelAccessMock,
  dispatchOrchestratorPromptMock,
  getChannelBindingByScopeKeyMock,
  getOrchestratorSessionMock,
  getOrCreateChannelThreadMock,
  getChannelThreadMappingMock,
} = vi.hoisted(() => ({
  getOrgSlackInstallMock: vi.fn(),
  resolveUserByExternalIdMock: vi.fn(),
  getInvocationMock: vi.fn(),
  getSessionMock: vi.fn(),
  decryptStringMock: vi.fn(),
  verifySlackSignatureMock: vi.fn(),
  checkPrivateChannelAccessMock: vi.fn(),
  dispatchOrchestratorPromptMock: vi.fn(),
  getChannelBindingByScopeKeyMock: vi.fn(),
  getOrchestratorSessionMock: vi.fn(),
  getOrCreateChannelThreadMock: vi.fn(),
  getChannelThreadMappingMock: vi.fn(),
}));
```

Update the `../lib/db.js` mock to include all functions called by the events handler:

```typescript
vi.mock('../lib/db.js', () => ({
  getOrgSlackInstall: getOrgSlackInstallMock,
  resolveUserByExternalId: resolveUserByExternalIdMock,
  getInvocation: getInvocationMock,
  getSession: getSessionMock,
  getChannelBindingByScopeKey: getChannelBindingByScopeKeyMock,
  deleteChannelBinding: vi.fn(),
  getOrchestratorSession: getOrchestratorSessionMock,
  getOrCreateChannelThread: getOrCreateChannelThreadMock,
  getChannelThreadMapping: getChannelThreadMappingMock,
}));
```

Note: This **replaces** the existing `vi.mock('../lib/db.js', ...)` block — it adds the new DB functions (`getChannelBindingByScopeKey`, `deleteChannelBinding`, `getOrchestratorSession`, `getOrCreateChannelThread`, `getChannelThreadMapping`) while preserving the originals (`getOrgSlackInstall`, `resolveUserByExternalId`, `getInvocation`, `getSession`).

Add the new mocks:

```typescript
vi.mock('@valet/plugin-slack/actions', () => ({
  checkPrivateChannelAccess: checkPrivateChannelAccessMock,
}));

vi.mock('../lib/workflow-runtime.js', () => ({
  dispatchOrchestratorPrompt: dispatchOrchestratorPromptMock,
}));
```

Add the `channelRegistry` mock — the events handler calls `channelRegistry.getTransport('slack')` and the test must provide a transport that returns a parsed message:

```typescript
vi.mock('../channels/registry.js', () => ({
  channelRegistry: {
    getTransport: vi.fn(() => ({
      parseInbound: vi.fn(async () => ({
        channelType: 'slack',
        channelId: 'C_PRIVATE',
        senderId: 'UMENTIONER',
        senderName: 'Test User',
        text: '@Bot hello',
        attachments: [],
        messageId: '1234567890.123456',
        metadata: {
          teamId: 'T123',
          slackEventType: 'app_mention',
          slackChannelType: 'group',
        },
      })),
      scopeKeyParts: vi.fn(() => ({ channelType: 'slack', channelId: 'T123:C_PRIVATE' })),
      sendMessage: vi.fn(),
      setThreadStatus: vi.fn(),
    })),
  },
}));
```

Then add the test helper and describe block:

```typescript
function buildMentionEventRequest(channelId: string, channelType: string, userId: string) {
  return new Request('http://localhost/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-signature': 'v0=test',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify({
      type: 'event_callback',
      team_id: 'T123',
      event: {
        type: 'app_mention',
        user: userId,
        text: '<@UBOTID> hello',
        channel: channelId,
        channel_type: channelType,
        ts: '1234567890.123456',
      },
    }),
  });
}

describe('private channel access control on inbound mentions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrgSlackInstallMock.mockResolvedValue({
      encryptedSigningSecret: 'enc-signing',
      encryptedBotToken: 'enc-bot',
    });
    decryptStringMock.mockResolvedValue('decrypted-token');
    verifySlackSignatureMock.mockReturnValue(true);
    resolveUserByExternalIdMock.mockResolvedValue('user-1');
  });

  it('silently ignores app_mention from a private channel when user is not a member', async () => {
    checkPrivateChannelAccessMock.mockResolvedValue({
      allowed: false,
      isPrivate: true,
      error: 'Access denied: you are not a member of this private channel',
    });

    const app = buildApp();
    const res = await app.fetch(
      buildMentionEventRequest('C_PRIVATE', 'group', 'UMENTIONER'),
      { DB: {}, ENCRYPTION_KEY: 'k', SLACK_SIGNING_SECRET: 's' } as any,
      { waitUntil: vi.fn() } as any,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Should NOT have dispatched to orchestrator
    expect(dispatchOrchestratorPromptMock).not.toHaveBeenCalled();
  });

  it('allows app_mention from a private channel when user is a member', async () => {
    checkPrivateChannelAccessMock.mockResolvedValue({ allowed: true, isPrivate: true });
    dispatchOrchestratorPromptMock.mockResolvedValue({ dispatched: true });
    getOrchestratorSessionMock.mockResolvedValue({ id: 'orchestrator:user-1' });
    getOrCreateChannelThreadMock.mockResolvedValue('thread-uuid-1');

    const app = buildApp();
    const res = await app.fetch(
      buildMentionEventRequest('C_PRIVATE', 'group', 'UMENTIONER'),
      { DB: {}, ENCRYPTION_KEY: 'k', SLACK_SIGNING_SECRET: 's' } as any,
      { waitUntil: vi.fn() } as any,
    );

    expect(res.status).toBe(200);
    expect(dispatchOrchestratorPromptMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/worker && npx vitest run src/routes/slack-events.test.ts`
Expected: FAIL — `checkPrivateChannelAccess` is not imported/used in slack-events.ts yet

- [ ] **Step 4: Add the membership check to `slack-events.ts`**

In `packages/worker/src/routes/slack-events.ts`, add the import:

```typescript
import { checkPrivateChannelAccess } from '@valet/plugin-slack/actions';
```

Then after the identity resolution block (after the `if (!userId) { ... return c.json({ ok: true }); }` block, before the binding/routing logic), add:

```typescript
  // ─── Private channel access check (defense in depth) ─────────────────
  // Slack prevents non-members from posting in private channels, but we
  // verify membership explicitly to guard against edge cases (e.g., user
  // removed between posting and our processing).
  if (isMention && !isDm) {
    const access = await checkPrivateChannelAccess(botToken, message.channelId, slackUserId!);
    if (!access.allowed && access.isPrivate) {
      console.log(`[Slack] Private channel access denied: channel=${message.channelId} user=${slackUserId} error=${access.error}`);
      return c.json({ ok: true });
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/worker && npx vitest run src/routes/slack-events.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run typecheck across affected packages**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-slack/src/actions/index.ts packages/worker/src/routes/slack-events.ts packages/worker/src/routes/slack-events.test.ts
git commit -m "feat: enforce private channel membership check on inbound Slack mentions"
```
