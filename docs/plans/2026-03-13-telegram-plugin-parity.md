# Telegram Plugin Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the Telegram channel plugin to feature parity with Slack: owner identity, thread mapping (fixes web UI visibility), group chat support, and interactive prompts.

**Architecture:** Add `ownerTelegramUserId` to Telegram config for owner verification. Wire thread resolution into the generic webhook handler for Telegram messages. Add `sendInteractivePrompt`/`updateInteractivePrompt` to `TelegramTransport` using Telegram inline keyboards. Handle `callback_query` updates in the webhook handler for button click resolution.

**Tech Stack:** Telegram Bot API (inline keyboards, callback queries), D1 SQLite migrations, Drizzle ORM, Cloudflare Workers Hono routes, Vitest, React (TanStack Query)

**Spec:** `docs/plans/2026-03-13-telegram-plugin-parity-design.md`

---

## Chunk 1: Owner Identity

### Task 1: D1 Migration — Add `ownerTelegramUserId` column

**Files:**
- Create: `packages/worker/migrations/0068_telegram_owner.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE user_telegram_config ADD COLUMN owner_telegram_user_id TEXT;
```

- [ ] **Step 2: Verify migration file**

Run: `cat packages/worker/migrations/0068_telegram_owner.sql`
Expected: The ALTER TABLE statement above.

- [ ] **Step 3: Commit**

```bash
git add packages/worker/migrations/0068_telegram_owner.sql
git commit -m "feat: add owner_telegram_user_id column to user_telegram_config (0068)"
```

---

### Task 2: Update Drizzle Schema + Shared Types

**Files:**
- Modify: `packages/worker/src/lib/schema/telegram.ts:1-17`
- Modify: `packages/shared/src/types/index.ts:870-878`

- [ ] **Step 1: Add column to Drizzle schema**

In `packages/worker/src/lib/schema/telegram.ts`, add after the `webhookActive` column:

```typescript
  ownerTelegramUserId: text(),
```

- [ ] **Step 2: Add field to shared type**

In `packages/shared/src/types/index.ts`, add after `webhookActive: boolean;` (line 875):

```typescript
  ownerTelegramUserId?: string;
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/lib/schema/telegram.ts packages/shared/src/types/index.ts
git commit -m "feat: add ownerTelegramUserId to Drizzle schema and shared types"
```

---

### Task 3: Update DB Functions to Read/Write Owner

**Files:**
- Modify: `packages/worker/src/lib/db/telegram.ts`

- [ ] **Step 1: Update getUserTelegramConfig to include ownerTelegramUserId**

In `packages/worker/src/lib/db/telegram.ts`, the `getUserTelegramConfig` function selects specific columns. Add `ownerTelegramUserId` to the select and to the return mapping. Find the select object and add:

```typescript
ownerTelegramUserId: userTelegramConfig.ownerTelegramUserId,
```

And in the return mapping, add:

```typescript
ownerTelegramUserId: row.ownerTelegramUserId ?? undefined,
```

- [ ] **Step 2: Add updateTelegramOwner function**

Add after `deleteUserTelegramConfig`:

```typescript
export async function updateTelegramOwner(
  db: AppDb,
  userId: string,
  ownerTelegramUserId: string,
): Promise<void> {
  await db
    .update(userTelegramConfig)
    .set({ ownerTelegramUserId, updatedAt: new Date().toISOString() })
    .where(eq(userTelegramConfig.userId, userId));
}
```

Ensure `eq` is imported from `drizzle-orm` (check existing imports).

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/lib/db/telegram.ts
git commit -m "feat: add ownerTelegramUserId to Telegram DB functions"
```

---

### Task 4: Capture Owner on /start + API Endpoint for Editing

**Files:**
- Modify: `packages/worker/src/routes/channel-webhooks.ts:148-152`
- Modify: `packages/worker/src/routes/telegram.ts`

- [ ] **Step 1: Capture owner on /start command**

In `packages/worker/src/routes/channel-webhooks.ts`, the `/start` command handler (lines 148-152) currently just sends a welcome message. Modify it to also store the owner's Telegram user ID.

Replace the `case 'start'` block (lines 148-153):

```typescript
    case 'start': {
      // Capture owner's Telegram user ID on first /start
      if (message.senderId && channelType === 'telegram') {
        try {
          await db.updateTelegramOwner(c.get('db'), userId, message.senderId);
        } catch (err) {
          console.error(`[Channel:${channelType}] Failed to capture owner:`, err);
        }
      }
      await transport.sendMessage(target, {
        markdown: 'Connected to Valet! Send me a message and it will be routed to your orchestrator.',
      }, ctx);
      break;
    }
```

- [ ] **Step 2: Add PATCH endpoint for editing owner**

In `packages/worker/src/routes/telegram.ts`, add after the DELETE handler (after line 46):

```typescript
/**
 * PATCH /api/me/telegram — Update Telegram config
 * Body: { ownerTelegramUserId?: string }
 */
telegramApiRouter.patch('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ ownerTelegramUserId?: string }>();

  if (body.ownerTelegramUserId !== undefined) {
    await db.updateTelegramOwner(c.get('db'), user.id, body.ownerTelegramUserId);
  }

  const config = await db.getUserTelegramConfig(c.get('db'), user.id);
  return c.json({ config });
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/routes/channel-webhooks.ts packages/worker/src/routes/telegram.ts
git commit -m "feat: capture Telegram owner on /start + add PATCH endpoint for editing"
```

---

### Task 5: Add Owner Field to Web UI Telegram Card

**Files:**
- Modify: `packages/client/src/api/orchestrator.ts`
- Modify: `packages/client/src/components/integrations/integration-list.tsx:216-252`

- [ ] **Step 1: Add useUpdateTelegramConfig mutation hook**

In `packages/client/src/api/orchestrator.ts`, add after `useDisconnectTelegram` (after line 429):

```typescript
export function useUpdateTelegramConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { ownerTelegramUserId?: string }) =>
      api.patch<{ config: UserTelegramConfig }>('/me/telegram', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.telegram() });
    },
  });
}
```

Verify that `api.patch` exists. If not, check how other PATCH calls are made in the api module, or use `api.request('PATCH', ...)` or similar.

- [ ] **Step 2: Update TelegramCard to show editable owner field**

In `packages/client/src/components/integrations/integration-list.tsx`, update the `TelegramCard` component. The config prop type needs to include `ownerTelegramUserId`. Replace the entire TelegramCard (lines 216-252):

```typescript
function TelegramCard({ config }: { config: { botUsername: string; webhookActive: boolean; ownerTelegramUserId?: string } }) {
  const disconnectTelegram = useDisconnectTelegram();
  const updateConfig = useUpdateTelegramConfig();
  const [editingOwner, setEditingOwner] = React.useState(false);
  const [ownerValue, setOwnerValue] = React.useState(config.ownerTelegramUserId || '');

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
            <TelegramIcon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Telegram</CardTitle>
            <p className="text-xs text-green-600 dark:text-green-400">
              @{config.botUsername}
              {config.webhookActive ? ' · Webhook active' : ''}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Owner Telegram User ID</label>
          {editingOwner ? (
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={ownerValue}
                onChange={(e) => setOwnerValue(e.target.value)}
                className="flex-1 rounded border px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
                placeholder="Telegram user ID"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  updateConfig.mutate({ ownerTelegramUserId: ownerValue }, {
                    onSuccess: () => setEditingOwner(false),
                  });
                }}
                disabled={updateConfig.isPending}
              >
                Save
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setEditingOwner(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {config.ownerTelegramUserId || 'Not set — send /start to your bot'}
              </p>
              <Button variant="secondary" size="sm" onClick={() => setEditingOwner(true)}>
                Edit
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Bot connected to orchestrator
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => disconnectTelegram.mutate()}
            disabled={disconnectTelegram.isPending}
          >
            {disconnectTelegram.isPending ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

Add `useUpdateTelegramConfig` to the imports from the API module.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/client && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/api/orchestrator.ts packages/client/src/components/integrations/integration-list.tsx
git commit -m "feat: add editable owner field to Telegram integration card"
```

---

## Chunk 2: Thread Mapping + Group Chat Support

### Task 6: Add Owner Verification + Group Chat Filtering to Webhook Handler

**Files:**
- Modify: `packages/worker/src/routes/channel-webhooks.ts:18-129`

- [ ] **Step 1: Add owner verification and group chat filtering**

In `packages/worker/src/routes/channel-webhooks.ts`, after the `parseInbound` call (line 43-51) and before the command handling (line 53), add owner verification and group filtering. The message is already parsed at this point, and we have `config` (Telegram config) from line 29.

Insert after `if (!message) { return c.json({ ok: true }); }` (line 50-51):

```typescript
  // ─── Telegram: Owner verification + group chat filtering ─────────────
  if (channelType === 'telegram' && config) {
    const ownerTelegramUserId = config.ownerTelegramUserId;

    // If owner is set, verify sender matches
    if (ownerTelegramUserId && message.senderId !== ownerTelegramUserId) {
      console.log(`[Channel:${channelType}] Ignoring non-owner message: sender=${message.senderId} owner=${ownerTelegramUserId}`);
      return c.json({ ok: true });
    }

    // Parse raw body again for chat.type (not available on InboundMessage)
    let chatType: string | undefined;
    try {
      const update = JSON.parse(rawBody) as Record<string, unknown>;
      const msg = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
      const chat = msg?.chat as Record<string, unknown> | undefined;
      chatType = chat?.type as string | undefined;
    } catch { /* ignore */ }

    const isGroup = chatType === 'group' || chatType === 'supergroup';

    if (isGroup && !message.command) {
      // In groups without privacy mode bypass (bot is admin), we only get
      // commands and replies anyway. If privacy mode is off (bot is admin),
      // we also get regular messages — check for @bot mention.
      const botUsername = config.botUsername;
      const isMention = botUsername && message.text?.includes(`@${botUsername}`);
      if (!isMention) {
        console.log(`[Channel:${channelType}] Ignoring non-mention group message`);
        return c.json({ ok: true });
      }
    }
  }
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/routes/channel-webhooks.ts
git commit -m "feat: add Telegram owner verification and group chat filtering"
```

---

### Task 7: Add Thread Resolution to Webhook Handler

**Files:**
- Modify: `packages/worker/src/routes/channel-webhooks.ts:60-128`

- [ ] **Step 1: Add thread resolution before dispatch**

In `packages/worker/src/routes/channel-webhooks.ts`, after the scope key / binding lookup (lines 62-64) and before the dispatch to bound session (line 66), add thread resolution for Telegram.

Insert after `const binding = await db.getChannelBindingByScopeKey(c.get('db'), scopeKey);` (line 64):

```typescript
  // ─── Resolve orchestrator thread (Telegram) ──────────────────────────
  let orchestratorThreadId: string | undefined;
  if (channelType === 'telegram') {
    let targetSessionId: string | undefined;

    if (binding) {
      targetSessionId = binding.sessionId;
    } else {
      const orchSession = await db.getOrchestratorSession(c.env.DB, userId);
      targetSessionId = orchSession?.id;
    }

    if (targetSessionId) {
      const THREAD_RESOLVE_RETRIES = 3;
      for (let attempt = 1; attempt <= THREAD_RESOLVE_RETRIES; attempt++) {
        try {
          orchestratorThreadId = await db.getOrCreateChannelThread(c.env.DB, {
            channelType: 'telegram',
            channelId: message.channelId,
            externalThreadId: message.channelId,
            sessionId: targetSessionId,
            userId,
          });
          console.log(`[Channel:${channelType}] Resolved thread: chat=${message.channelId} → orchestrator=${orchestratorThreadId}`);
          break;
        } catch (err) {
          console.error(`[Channel:${channelType}] Thread resolution attempt ${attempt}/${THREAD_RESOLVE_RETRIES} failed:`, err);
          if (attempt < THREAD_RESOLVE_RETRIES) {
            await new Promise((r) => setTimeout(r, 100 * attempt));
          }
        }
      }
    }
  }
```

- [ ] **Step 2: Pass threadId to bound session dispatch**

In the bound session dispatch (lines 79-92), add `threadId: orchestratorThreadId` to the JSON body:

```typescript
          body: JSON.stringify({
            content: message.text,
            attachments: attachments.length > 0 ? attachments : undefined,
            queueMode: binding.queueMode,
            channelType,
            channelId: message.channelId,
            threadId: orchestratorThreadId,
            authorName: message.senderName,
          }),
```

- [ ] **Step 3: Pass threadId to orchestrator dispatch**

In the orchestrator dispatch (lines 111-118), add `threadId: orchestratorThreadId`:

```typescript
  const result = await dispatchOrchestratorPrompt(c.env, {
    userId,
    content: message.text || '[Attachment]',
    channelType,
    channelId: message.channelId,
    threadId: orchestratorThreadId,
    authorName: message.senderName,
    attachments: attachments.length > 0 ? attachments : undefined,
  });
```

- [ ] **Step 4: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/routes/channel-webhooks.ts
git commit -m "feat: resolve Telegram chats to orchestrator threads"
```

---

## Chunk 3: Interactive Prompts

### Task 8: Implement sendInteractivePrompt on TelegramTransport

**Files:**
- Modify: `packages/plugin-telegram/src/channels/transport.ts`

- [ ] **Step 1: Add imports for interactive prompt types**

At the top of `packages/plugin-telegram/src/channels/transport.ts`, add to the existing import (line 1-10):

```typescript
import type {
  ChannelTransport,
  ChannelTarget,
  ChannelContext,
  InboundMessage,
  InboundAttachment,
  OutboundMessage,
  RoutingMetadata,
  SendResult,
  InteractivePrompt,
  InteractivePromptRef,
  InteractiveResolution,
} from '@valet/sdk';
```

- [ ] **Step 2: Add sendInteractivePrompt method**

Add after `sendTypingIndicator` (after line 368), before `registerWebhook`:

```typescript
  async sendInteractivePrompt(
    target: ChannelTarget,
    prompt: InteractivePrompt,
    ctx: ChannelContext,
  ): Promise<InteractivePromptRef | null> {
    // No actions → text-only prompt, ask user to reply
    if (!prompt.actions || prompt.actions.length === 0) {
      const text = `*${prompt.title}*${prompt.body ? '\n' + prompt.body : ''}\n\n_Reply with your answer._`;
      const result = await this.sendMessage(target, { markdown: text }, ctx);
      if (!result.success || !result.messageId) return null;
      return { messageId: result.messageId, channelId: target.channelId };
    }

    // Build message text
    let text = `*${prompt.title}*${prompt.body ? '\n' + prompt.body : ''}`;
    if (prompt.expiresAt) {
      const expiryDate = new Date(prompt.expiresAt);
      text += `\n\n_Expires ${expiryDate.toLocaleString()}_`;
    }

    // Build inline keyboard with emoji-prefixed labels
    const buttonValue = prompt.sessionId ? `${prompt.sessionId}:${prompt.id}` : prompt.id;
    const inlineKeyboard = prompt.actions.map((action) => {
      let emoji = '';
      if (action.id === 'approve') emoji = '✅ ';
      else if (action.id === 'deny') emoji = '❌ ';
      return {
        text: `${emoji}${action.label}`,
        callback_data: `${action.id}|${buttonValue}`,
      };
    });

    const html = this.formatMarkdown(text);
    const resp = await fetch(botUrl(ctx.token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target.channelId,
        text: html,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [inlineKeyboard],
        },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[TelegramTransport] sendInteractivePrompt error: ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const result = (await resp.json()) as { ok: boolean; result?: { message_id?: number } };
    if (!result.ok || !result.result?.message_id) return null;
    return { messageId: String(result.result.message_id), channelId: target.channelId };
  }
```

Note: `callback_data` uses `actionId|sessionId:promptId` format (pipe-separated) so we can extract both the action and the prompt reference. Telegram limits `callback_data` to 64 bytes, so this is compact enough.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/plugin-telegram && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-telegram/src/channels/transport.ts
git commit -m "feat(telegram): implement sendInteractivePrompt with inline keyboards"
```

---

### Task 9: Implement updateInteractivePrompt on TelegramTransport

**Files:**
- Modify: `packages/plugin-telegram/src/channels/transport.ts`

- [ ] **Step 1: Add updateInteractivePrompt method**

Add after `sendInteractivePrompt`:

```typescript
  async updateInteractivePrompt(
    _target: ChannelTarget,
    ref: InteractivePromptRef,
    resolution: InteractiveResolution,
    ctx: ChannelContext,
  ): Promise<void> {
    let statusText: string;
    if (resolution.actionId === '__expired__') {
      statusText = '⏰ Expired';
    } else if (resolution.actionId === 'approve') {
      statusText = `✅ Approved by ${resolution.resolvedBy}`;
    } else if (resolution.actionId === 'deny') {
      statusText = `❌ Denied by ${resolution.resolvedBy}`;
      if (resolution.value) statusText += `: ${resolution.value}`;
    } else if (resolution.actionLabel || resolution.actionId) {
      const label = resolution.actionLabel || resolution.actionId;
      statusText = `*${label}* — selected by ${resolution.resolvedBy}`;
    } else if (resolution.value) {
      const preview = resolution.value.length > 100
        ? resolution.value.slice(0, 97) + '...'
        : resolution.value;
      statusText = `Answered by ${resolution.resolvedBy}: ${preview}`;
    } else {
      statusText = `Resolved by ${resolution.resolvedBy}`;
    }

    if (resolution.promptTitle) {
      statusText = `${resolution.promptTitle}\n\n${statusText}`;
    }

    const html = this.formatMarkdown(statusText);
    const resp = await fetch(botUrl(ctx.token, 'editMessageText'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ref.channelId,
        message_id: Number(ref.messageId),
        text: html,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[TelegramTransport] updateInteractivePrompt error: ${resp.status}: ${body.slice(0, 200)}`);
    }
  }
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/plugin-telegram && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-telegram/src/channels/transport.ts
git commit -m "feat(telegram): implement updateInteractivePrompt"
```

---

### Task 10: Add Tests for Interactive Prompt Methods

**Files:**
- Modify: `packages/plugin-telegram/src/channels/transport.test.ts`

- [ ] **Step 1: Add sendInteractivePrompt tests**

Add to the existing test file, following the established patterns (vitest, global fetch mock, `jsonResponse` helper):

```typescript
  // ─── Interactive Prompts ──────────────────────────────────────────────

  describe('sendInteractivePrompt', () => {
    const target: ChannelTarget = { channelType: 'telegram', channelId: '123' };
    const ctx: ChannelContext = { token: 'bot-token', userId: 'user1' };

    it('sends text-only prompt when no actions', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 42 } }));

      const result = await transport.sendInteractivePrompt!(target, {
        id: 'prompt1',
        sessionId: 'session1',
        type: 'question',
        title: 'What should I name the file?',
        body: 'Please provide a filename.',
        actions: [],
      }, ctx);

      expect(result).not.toBeNull();
      expect(result!.messageId).toBe('42');
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/sendMessage');
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('Reply with your answer');
      expect(body.reply_markup).toBeUndefined();
    });

    it('sends inline keyboard when actions present', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 43 } }));

      const result = await transport.sendInteractivePrompt!(target, {
        id: 'prompt2',
        sessionId: 'session1',
        type: 'approval',
        title: 'Approve this action?',
        actions: [
          { id: 'approve', label: 'Approve', style: 'primary' },
          { id: 'deny', label: 'Deny', style: 'danger' },
        ],
      }, ctx);

      expect(result).not.toBeNull();
      expect(result!.messageId).toBe('43');
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/sendMessage');
      const body = JSON.parse(opts.body);
      expect(body.reply_markup.inline_keyboard).toHaveLength(1);
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
      expect(body.reply_markup.inline_keyboard[0][0].text).toBe('✅ Approve');
      expect(body.reply_markup.inline_keyboard[0][1].text).toBe('❌ Deny');
      expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('approve|session1:prompt2');
    });

    it('returns null on API error', async () => {
      mockFetch.mockResolvedValueOnce(new Response('error', { status: 400 }));

      const result = await transport.sendInteractivePrompt!(target, {
        id: 'prompt3',
        sessionId: 'session1',
        type: 'approval',
        title: 'Test',
        actions: [{ id: 'ok', label: 'OK' }],
      }, ctx);

      expect(result).toBeNull();
    });
  });

  describe('updateInteractivePrompt', () => {
    const target: ChannelTarget = { channelType: 'telegram', channelId: '123' };
    const ctx: ChannelContext = { token: 'bot-token', userId: 'user1' };
    const ref: InteractivePromptRef = { messageId: '42', channelId: '123' };

    it('updates message with approval status', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await transport.updateInteractivePrompt!(target, ref, {
        actionId: 'approve',
        resolvedBy: 'Alice',
      }, ctx);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/editMessageText');
      const body = JSON.parse(opts.body);
      expect(body.message_id).toBe(42);
      expect(body.text).toContain('Approved by Alice');
      expect(body.reply_markup.inline_keyboard).toEqual([]);
    });

    it('updates message with denial and reason', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await transport.updateInteractivePrompt!(target, ref, {
        actionId: 'deny',
        resolvedBy: 'Bob',
        value: 'Too risky',
      }, ctx);

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('Denied by Bob');
      expect(body.text).toContain('Too risky');
    });

    it('updates message with expiry status', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await transport.updateInteractivePrompt!(target, ref, {
        actionId: '__expired__',
        resolvedBy: 'system',
      }, ctx);

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('Expired');
    });
  });
```

Add `InteractivePromptRef` to the existing SDK type imports at the top of the test file.

- [ ] **Step 2: Run the tests**

Run: `cd packages/plugin-telegram && pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-telegram/src/channels/transport.test.ts
git commit -m "test(telegram): add tests for interactive prompt methods"
```

---

### Task 11: Handle callback_query in Webhook Handler

**Files:**
- Modify: `packages/worker/src/routes/channel-webhooks.ts`

- [ ] **Step 1: Add callback_query handling before parseInbound**

In `packages/worker/src/routes/channel-webhooks.ts`, inside the webhook route handler, after reading the raw body (line 36) and before calling `transport.parseInbound` (line 43), add callback_query handling for Telegram.

Insert after `rawHeaders[key] = value;` (line 40), before `const message = await transport.parseInbound(...)`:

```typescript
  // ─── Telegram: Handle callback_query (inline keyboard button clicks) ──
  if (channelType === 'telegram') {
    let update: Record<string, unknown>;
    try {
      update = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ ok: true });
    }

    const callbackQuery = update.callback_query as Record<string, unknown> | undefined;
    if (callbackQuery) {
      const callbackId = callbackQuery.id as string;
      const callbackData = callbackQuery.data as string | undefined;
      const from = callbackQuery.from as Record<string, unknown> | undefined;
      const fromId = from?.id ? String(from.id) : '';

      // Verify owner
      if (config?.ownerTelegramUserId && fromId !== config.ownerTelegramUserId) {
        // Answer the callback to dismiss spinner, but don't process
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackId, text: 'Not authorized' }),
        });
        return c.json({ ok: true });
      }

      // Answer the callback query to dismiss loading spinner
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackId }),
      });

      // Parse callback_data: "actionId|sessionId:promptId"
      if (callbackData) {
        const pipeIdx = callbackData.indexOf('|');
        if (pipeIdx > 0) {
          const actionId = callbackData.slice(0, pipeIdx);
          const rest = callbackData.slice(pipeIdx + 1);
          const colonIdx = rest.lastIndexOf(':');
          let sessionId: string | undefined;
          let promptId: string;
          if (colonIdx > 0) {
            sessionId = rest.slice(0, colonIdx);
            promptId = rest.slice(colonIdx + 1);
          } else {
            promptId = rest;
          }

          if (sessionId && promptId) {
            // Fire-and-forget: resolve prompt on session DO
            c.executionCtx.waitUntil((async () => {
              try {
                const doId = c.env.SESSIONS.idFromName(sessionId!);
                const stub = c.env.SESSIONS.get(doId);
                await stub.fetch(new Request('https://session/prompt-resolved', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    promptId,
                    actionId,
                    resolvedBy: userId,
                  }),
                }));
              } catch (err) {
                console.error('[Telegram callback_query] Failed to notify DO:', err);
              }
            })());
          }
        }
      }

      return c.json({ ok: true });
    }
  }
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/routes/channel-webhooks.ts
git commit -m "feat: handle Telegram callback_query for interactive prompt resolution"
```

---

## Chunk 4: Verification

### Task 12: Full Typecheck + Test Suite

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck` (from repo root)
Expected: PASS across all packages

- [ ] **Step 2: Run Telegram plugin tests**

Run: `cd packages/plugin-telegram && pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Run worker tests (if they exist)**

Run: `cd packages/worker && pnpm test 2>&1 | tail -20`
Expected: No regressions

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address typecheck/test issues from Telegram parity changes"
```
