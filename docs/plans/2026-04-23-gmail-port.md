# Gmail Plugin Port -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 13 gmail actions with 13 actions ported from the google-docs-mcp reference repo, swapping convenience wrappers for general-purpose tools and adding draft management and inbox triage capabilities.

**Architecture:** The existing `packages/plugin-gmail/` package is rewritten in place. The `api.ts` helper (`gmailFetch`, `decodeBase64Url`, `encodeBase64Url`) and `provider.ts` (OAuth config) are kept unchanged. Only `actions.ts` is rewritten and a new skill file is created. No new packages, no shared state with google-workspace.

**Tech Stack:** TypeScript, Cloudflare Workers, Gmail REST API v1, Zod, Vitest

**Spec:** `docs/specs/2026-04-23-gmail-port-design.md`

---

## Task 1: Rewrite Gmail Actions -- Messages (5 actions)

**Files:**
- Rewrite: `packages/plugin-gmail/src/actions/actions.ts`
- Reference: `/tmp/google-docs-mcp/src/tools/gmail/` (all tool files + `helpers.ts`)
- Keep unchanged: `packages/plugin-gmail/src/actions/api.ts`
- Keep unchanged: `packages/plugin-gmail/src/actions/provider.ts`
- Keep unchanged: `packages/plugin-gmail/src/actions/index.ts`

### Translation pattern

Same as Calendar port. Each reference tool follows `server.addTool({ name, parameters, execute })`. The port translates to:
1. An `ActionDefinition` object with `id`, `name`, `description`, `riskLevel`, `params` (Zod schema)
2. A `case` in the `executeAction` switch statement
3. `getGmailClient()` calls become `gmailFetch(path, token)` using the existing `api.ts` helper
4. `UserError` throws become `{ success: false, error: message }` returns
5. Gmail API base URL: `https://gmail.googleapis.com/gmail/v1` (already configured in `api.ts`)
6. All Gmail endpoints are relative to `/users/me` (already in current `gmailFetch` calls)

### RFC 2822 MIME encoding

Both send and draft operations require building RFC 2822 messages and base64url-encoding them. The current codebase already has `buildRawEmail` and `encodeBase64Url` helpers. The reference repo has equivalent functions in `helpers.ts` (`buildMimeMessage`, `encodeRawMessage`, `prepareMimeRequest`).

The port should keep the existing `encodeBase64Url` from `api.ts` and port the MIME building logic from the reference repo's `helpers.ts` into `actions.ts` as internal helpers. Key helpers to port:

- `buildMimeMessage(opts)` -- builds RFC 2822 message string with headers and body
- `encodeRawMessage(mime)` -- base64url encodes the MIME string (use existing `encodeBase64Url`)
- `getReplyContext(token, messageId)` -- fetches original message headers for threading
- `prepareMimeRequest(token, args)` -- orchestrates reply context + MIME building
- `findHeaderValue(headers, name)` -- extracts header value from Gmail headers array
- `extractMessageBody(payload)` -- walks MIME tree to extract text/plain and text/html
- `decodeBase64Url(data)` -- already in `api.ts`

### Step-by-step

- [ ] **Step 1: Read reference files for full context**

Read all reference tool files:
- `/tmp/google-docs-mcp/src/tools/gmail/helpers.ts` (MIME encoding, header extraction, body decoding)
- `/tmp/google-docs-mcp/src/tools/gmail/sendEmail.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/listMessages.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/getMessage.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/modifyMessageLabels.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/trashMessage.ts`

Also read:
- `packages/plugin-gmail/src/actions/actions.ts` (current, to be replaced)
- `packages/plugin-gmail/src/actions/api.ts` (kept, understand available helpers)

- [ ] **Step 2: Write internal helpers at top of new `actions.ts`**

Port from reference `helpers.ts`, adapted for raw `fetch` instead of `googleapis` client:

**`findHeaderValue`:**
```typescript
function findHeaderValue(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}
```

**`encodeHeader`** (RFC 2047 for non-ASCII subjects):
```typescript
function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `=?UTF-8?B?${btoa(binary)}?=`;
}
```

**`buildMimeMessage`:**
```typescript
interface MimeMessageOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}

function buildMimeMessage(opts: MimeMessageOptions): string {
  const lines: string[] = [];
  lines.push(`To: ${opts.to.join(', ')}`);
  if (opts.cc && opts.cc.length > 0) lines.push(`Cc: ${opts.cc.join(', ')}`);
  if (opts.bcc && opts.bcc.length > 0) lines.push(`Bcc: ${opts.bcc.join(', ')}`);
  lines.push(`Subject: ${encodeHeader(opts.subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push('');
  lines.push(opts.body);
  return lines.join('\r\n');
}
```

**`getReplyContext`** (adapted for raw fetch):
```typescript
async function getReplyContext(
  token: string,
  messageId: string,
): Promise<{ threadId: string | undefined; inReplyTo: string | null; references: string | null }> {
  const qs = new URLSearchParams({
    format: 'metadata',
    metadataHeaders: 'Message-Id',
    metadataHeaders: 'References',
  });
  // Note: URLSearchParams doesn't support duplicate keys well.
  // Use manual query string for metadataHeaders:
  const res = await gmailFetch(
    `/users/me/messages/${messageId}?format=metadata&metadataHeaders=Message-Id&metadataHeaders=References&metadataHeaders=Subject`,
    token,
  );
  if (!res.ok) return { threadId: undefined, inReplyTo: null, references: null };
  const data = (await res.json()) as {
    threadId?: string;
    payload?: { headers?: Array<{ name: string; value: string }> };
  };
  const headers = data.payload?.headers;
  const inReplyTo = findHeaderValue(headers, 'Message-Id');
  const origRefs = findHeaderValue(headers, 'References');
  const references = [origRefs, inReplyTo].filter(Boolean).join(' ') || null;
  return { threadId: data.threadId, inReplyTo, references };
}
```

**`prepareMimeRequest`** (composes reply context + MIME):
```typescript
interface ComposeArgs {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  replyToMessageId?: string;
}

async function prepareMimeRequest(
  token: string,
  args: ComposeArgs,
): Promise<{ raw: string; threadId: string | undefined; toList: string[] }> {
  const toList = Array.isArray(args.to) ? args.to : [args.to];
  let threadId: string | undefined;
  let inReplyTo: string | null = null;
  let references: string | null = null;

  if (args.replyToMessageId) {
    const ctx = await getReplyContext(token, args.replyToMessageId);
    threadId = ctx.threadId;
    inReplyTo = ctx.inReplyTo;
    references = ctx.references;
  }

  const raw = encodeBase64Url(buildMimeMessage({
    to: toList, cc: args.cc, bcc: args.bcc,
    subject: args.subject, body: args.body,
    inReplyTo, references,
  }));

  return { raw, threadId, toList };
}
```

**`extractMessageBody`** (walks MIME tree):
```typescript
function extractMessageBody(payload?: GmailPayload): { text: string; html: string } {
  let text = '';
  let html = '';
  if (!payload) return { text, html };
  const walk = (part: GmailPayload) => {
    const mime = part.mimeType ?? '';
    if (mime === 'text/plain' && part.body?.data) text += decodeBase64Url(part.body.data);
    else if (mime === 'text/html' && part.body?.data) html += decodeBase64Url(part.body.data);
    if (part.parts) for (const sub of part.parts) walk(sub);
  };
  walk(payload);
  return { text, html };
}
```

**Internal types** (used by helpers and execute):
```typescript
interface GmailPayload {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPayload[];
}
```

- [ ] **Step 3: Write 5 message action definitions**

1. **`gmail.send_email`** -- risk: `high`

```typescript
const sendEmail: ActionDefinition = {
  id: 'gmail.send_email',
  name: 'Send Email',
  description: 'Sends a plain-text email from the authenticated Gmail account. Supports cc/bcc and optional threading by passing replyToMessageId (which copies threadId and sets In-Reply-To/References so the reply lands in the same thread).',
  riskLevel: 'high',
  params: z.object({
    to: z.union([z.string(), z.array(z.string()).min(1)])
      .describe('Recipient email address, or an array of addresses.'),
    subject: z.string().describe('Email subject line.'),
    body: z.string().describe('Plain-text body of the email.'),
    cc: z.array(z.string()).optional().describe('Optional list of Cc recipients.'),
    bcc: z.array(z.string()).optional().describe('Optional list of Bcc recipients.'),
    replyToMessageId: z.string().optional()
      .describe('Optional Gmail message ID to reply to. The new email is threaded with the original.'),
  }),
};
```

Execute: call `prepareMimeRequest`, then `POST /users/me/messages/send` with `{ raw, threadId? }`.
Return: `{ success: true, data: { id, threadId, labelIds, to, subject } }`

2. **`gmail.list_messages`** -- risk: `low`

```typescript
const listMessages: ActionDefinition = {
  id: 'gmail.list_messages',
  name: 'List Messages',
  description: 'Lists Gmail messages for the authenticated user. Supports the full Gmail search syntax via the q parameter (e.g. "is:unread", "from:alice@example.com"). Returns message IDs with sender, subject, date, and snippet for each result.',
  riskLevel: 'low',
  params: z.object({
    maxResults: z.number().int().min(1).max(100).optional().default(10)
      .describe('Maximum number of messages to return (1-100). Defaults to 10.'),
    q: z.string().optional()
      .describe('Gmail search query (same syntax as the Gmail search box).'),
    labelIds: z.array(z.string()).optional()
      .describe('Only return messages with these label IDs (e.g. ["INBOX"]).'),
    includeSpamTrash: z.boolean().optional().default(false)
      .describe('If true, also include messages from SPAM and TRASH.'),
  }),
};
```

Execute: `GET /users/me/messages?{qs}`, then for each message ref, `GET /users/me/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`. Use `Promise.allSettled` for resilience.
Return: `{ success: true, data: { messages: [...], resultSizeEstimate, nextPageToken } }`

3. **`gmail.get_message`** -- risk: `low`

```typescript
const getMessage: ActionDefinition = {
  id: 'gmail.get_message',
  name: 'Get Message',
  description: 'Fetches a single Gmail message by ID with headers, decoded plain-text body, HTML body, and a list of attachments (metadata only). Use list_messages to discover message IDs.',
  riskLevel: 'low',
  params: z.object({
    messageId: z.string().describe('The Gmail message ID, typically from list_messages results.'),
    format: z.enum(['full', 'metadata', 'minimal']).optional().default('full')
      .describe('"full" returns headers + body + attachments; "metadata" returns headers only; "minimal" returns just labels/snippet.'),
  }),
};
```

Execute: `GET /users/me/messages/{id}?format={format}`. Walk payload tree for body extraction (full format). Collect attachment metadata.
Return depends on format:
- `minimal`: `{ id, threadId, labelIds, snippet, historyId, internalDate, sizeEstimate }`
- `metadata`: add `headers: { from, to, cc, bcc, subject, date, messageIdHeader }`
- `full`: add `body: { text, html }` and `attachments: [{ partId, filename, mimeType, size, attachmentId }]`

4. **`gmail.modify_labels`** -- risk: `medium`

```typescript
const modifyLabels: ActionDefinition = {
  id: 'gmail.modify_labels',
  name: 'Modify Labels',
  description: 'Adds and/or removes labels on a Gmail message. Use this to star (add STARRED), archive (remove INBOX), mark read (remove UNREAD), or apply custom labels. At least one of addLabelIds or removeLabelIds must be provided.',
  riskLevel: 'medium',
  params: z.object({
    messageId: z.string().describe('The Gmail message ID to modify.'),
    addLabelIds: z.array(z.string()).optional()
      .describe('Label IDs to add (e.g. ["STARRED"]).'),
    removeLabelIds: z.array(z.string()).optional()
      .describe('Label IDs to remove (e.g. ["INBOX"] to archive, ["UNREAD"] to mark as read).'),
  }),
};
```

Validation: at least one of `addLabelIds`/`removeLabelIds` must be non-empty.
Execute: `POST /users/me/messages/{id}/modify` with `{ addLabelIds, removeLabelIds }`.
Return: `{ success: true, data: { id, threadId, labelIds } }`

5. **`gmail.trash_message`** -- risk: `high`

```typescript
const trashMessage: ActionDefinition = {
  id: 'gmail.trash_message',
  name: 'Trash Message',
  description: 'Moves a Gmail message to Trash. Reversible from the Trash folder for 30 days. Not a permanent delete.',
  riskLevel: 'high',
  params: z.object({
    messageId: z.string().describe('The Gmail message ID to move to Trash.'),
  }),
};
```

Execute: `POST /users/me/messages/{id}/trash`.
Return: `{ success: true, data: { id, threadId, labelIds } }`

- [ ] **Step 4: Write the `executeAction` cases for the 5 message actions**

Port each reference tool's execute function. The general error handling pattern for all cases:

```typescript
const res = await gmailFetch(path, token, options);
if (!res.ok) {
  let detail = '';
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    detail = json?.error?.message || body.slice(0, 200);
  } catch { detail = res.statusText; }
  return { success: false, error: `Gmail API ${res.status}: ${detail}` };
}
```

Keep the existing `gmailError` helper pattern from the current code -- it works well and is simpler than individual status code branches.

- [ ] **Step 5: Verify the partial file compiles**

Run: `cd /Users/conner/code/valet && pnpm typecheck`

At this point the file has 5 of 13 actions. The remaining 8 actions will reference the same helpers, so get the foundation right before proceeding.

- [ ] **Step 6: Commit partial progress**

```bash
git add packages/plugin-gmail/src/actions/actions.ts
git commit -m "feat(gmail): port 5 message actions from reference repo (send, list, get, modify_labels, trash)"
```

---

## Task 2: Rewrite Gmail Actions -- Drafts (6 actions)

**Files:**
- Continue editing: `packages/plugin-gmail/src/actions/actions.ts`
- Reference: `/tmp/google-docs-mcp/src/tools/gmail/createDraft.ts`, `listDrafts.ts`, `getDraft.ts`, `updateDraft.ts`, `sendDraft.ts`, `deleteDraft.ts`

- [ ] **Step 1: Read reference draft tool files**

Read:
- `/tmp/google-docs-mcp/src/tools/gmail/createDraft.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/listDrafts.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/getDraft.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/updateDraft.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/sendDraft.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/deleteDraft.ts`

- [ ] **Step 2: Add 6 draft action definitions**

6. **`gmail.create_draft`** -- risk: `medium`

```typescript
const createDraft: ActionDefinition = {
  id: 'gmail.create_draft',
  name: 'Create Draft',
  description: 'Creates a Gmail draft (does NOT send). Use this for AI-composed emails that the user should review before sending. Supports threading via replyToMessageId.',
  riskLevel: 'medium',
  params: z.object({
    to: z.union([z.string(), z.array(z.string()).min(1)])
      .describe('Recipient email address, or an array of addresses.'),
    subject: z.string().describe('Email subject line.'),
    body: z.string().describe('Plain-text body of the draft.'),
    cc: z.array(z.string()).optional().describe('Optional list of Cc recipients.'),
    bcc: z.array(z.string()).optional().describe('Optional list of Bcc recipients.'),
    replyToMessageId: z.string().optional()
      .describe('Optional Gmail message ID to draft a reply to. The draft is threaded with the original.'),
  }),
};
```

Execute: call `prepareMimeRequest`, then `POST /users/me/drafts` with `{ message: { raw, threadId? } }`.
Return: `{ success: true, data: { draftId, messageId, threadId, to, subject } }`

7. **`gmail.list_drafts`** -- risk: `low`

```typescript
const listDrafts: ActionDefinition = {
  id: 'gmail.list_drafts',
  name: 'List Drafts',
  description: 'Lists Gmail drafts for the authenticated user. Returns draft IDs along with recipient, subject, snippet, and date for each.',
  riskLevel: 'low',
  params: z.object({
    maxResults: z.number().int().min(1).max(100).optional().default(25)
      .describe('Maximum number of drafts to return (1-100). Defaults to 25.'),
    q: z.string().optional()
      .describe('Optional Gmail search query to filter drafts.'),
  }),
};
```

Execute: `GET /users/me/drafts?{qs}`, then for each draft ref, `GET /users/me/drafts/{id}?format=metadata`. Use `Promise.allSettled` for resilience.
Return: `{ success: true, data: { drafts: [...], resultSizeEstimate, nextPageToken } }`

8. **`gmail.get_draft`** -- risk: `low`

```typescript
const getDraft: ActionDefinition = {
  id: 'gmail.get_draft',
  name: 'Get Draft',
  description: 'Fetches a single Gmail draft by ID with full headers and body. Use list_drafts to discover draft IDs.',
  riskLevel: 'low',
  params: z.object({
    draftId: z.string().describe('The Gmail draft ID, typically from list_drafts results.'),
  }),
};
```

Execute: `GET /users/me/drafts/{id}?format=full`. Extract headers and body from `draft.message.payload`.
Return: `{ success: true, data: { draftId, messageId, threadId, labelIds, snippet, headers: {...}, body: { text, html } } }`

9. **`gmail.update_draft`** -- risk: `medium`

```typescript
const updateDraft: ActionDefinition = {
  id: 'gmail.update_draft',
  name: 'Update Draft',
  description: 'Replaces the contents of an existing Gmail draft. This is a full replace, not a patch. Use when iterating on an AI-composed draft before sending.',
  riskLevel: 'medium',
  params: z.object({
    draftId: z.string().describe('The Gmail draft ID to update.'),
    to: z.union([z.string(), z.array(z.string()).min(1)])
      .describe('Recipient email address, or an array of addresses.'),
    subject: z.string().describe('Email subject line.'),
    body: z.string().describe('New plain-text body of the draft.'),
    cc: z.array(z.string()).optional().describe('Optional list of Cc recipients.'),
    bcc: z.array(z.string()).optional().describe('Optional list of Bcc recipients.'),
    replyToMessageId: z.string().optional()
      .describe('Optional Gmail message ID to thread the draft with.'),
  }),
};
```

Execute: call `prepareMimeRequest`, then `PUT /users/me/drafts/{draftId}` with `{ message: { raw, threadId? } }`.
Return: `{ success: true, data: { draftId, messageId, threadId, to, subject } }`

10. **`gmail.send_draft`** -- risk: `high`

```typescript
const sendDraft: ActionDefinition = {
  id: 'gmail.send_draft',
  name: 'Send Draft',
  description: 'Sends an existing Gmail draft. After sending, the draft is removed and the message appears in Sent.',
  riskLevel: 'high',
  params: z.object({
    draftId: z.string().describe('The Gmail draft ID to send (from create_draft or list_drafts).'),
  }),
};
```

Execute: `POST /users/me/drafts/send` with `{ id: draftId }`.
Return: `{ success: true, data: { draftId, messageId, threadId, labelIds } }`

11. **`gmail.delete_draft`** -- risk: `medium`

```typescript
const deleteDraft: ActionDefinition = {
  id: 'gmail.delete_draft',
  name: 'Delete Draft',
  description: 'Permanently deletes a Gmail draft. This is irreversible -- the draft is removed entirely, not moved to Trash.',
  riskLevel: 'medium',
  params: z.object({
    draftId: z.string().describe('The Gmail draft ID to delete.'),
  }),
};
```

Execute: `DELETE /users/me/drafts/{id}`. Gmail returns 204 No Content on success.
Return: `{ success: true, data: { draftId } }`

- [ ] **Step 3: Write the `executeAction` cases for the 6 draft actions**

Follow the same error handling pattern as Task 1. Key implementation notes:

- `create_draft` and `update_draft` both use `prepareMimeRequest` for MIME encoding and threading
- `update_draft` uses HTTP `PUT`, not `PATCH` -- the Gmail API replaces the entire draft message
- `delete_draft` returns 204 with no body -- check `res.ok` without parsing JSON
- `list_drafts` uses the N+1 pattern (list IDs, then get each) same as `list_messages`

- [ ] **Step 4: Verify typecheck**

Run: `cd /Users/conner/code/valet && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-gmail/src/actions/actions.ts
git commit -m "feat(gmail): port 6 draft actions (create, list, get, update, send, delete)"
```

---

## Task 3: Rewrite Gmail Actions -- Labels + Triage (2 actions)

**Files:**
- Continue editing: `packages/plugin-gmail/src/actions/actions.ts`
- Reference: `/tmp/google-docs-mcp/src/tools/gmail/listLabels.ts`, `triageInbox.ts`

- [ ] **Step 1: Read reference label and triage tool files**

Read:
- `/tmp/google-docs-mcp/src/tools/gmail/listLabels.ts`
- `/tmp/google-docs-mcp/src/tools/gmail/triageInbox.ts`

- [ ] **Step 2: Add 2 action definitions**

12. **`gmail.list_labels`** -- risk: `low`

```typescript
const listLabels: ActionDefinition = {
  id: 'gmail.list_labels',
  name: 'List Labels',
  description: 'Lists all Gmail labels for the authenticated user, including system labels (INBOX, SENT, STARRED, UNREAD) and custom labels. Use the returned IDs with modify_labels or list_messages.',
  riskLevel: 'low',
  params: z.object({}),
};
```

Execute: `GET /users/me/labels`.
Return: `{ success: true, data: { labels: [{ id, name, type, messageListVisibility, labelListVisibility }], count } }`

13. **`gmail.triage_inbox`** -- risk: `low`

```typescript
const triageInbox: ActionDefinition = {
  id: 'gmail.triage_inbox',
  name: 'Triage Inbox',
  description: "Composite tool: fetches the user's most recent unread Gmail messages with full content and heuristic categorization in a single call. Returns headers, body excerpts, labels, plus per-message signals (newsletter, meeting reference, contains question, action requested) AND aggregate stats (total unread, top senders, breakdown by category). Designed for AI inbox triage workflows.",
  riskLevel: 'low',
  params: z.object({
    maxResults: z.number().int().min(1).max(50).optional().default(20)
      .describe('How many unread messages to triage in one pass (1-50). Defaults to 20.'),
    additionalQuery: z.string().optional()
      .describe('Optional Gmail query appended to "is:unread", e.g. "newer_than:2d".'),
    bodyExcerptLength: z.number().int().min(0).max(2000).optional().default(400)
      .describe('Max characters of body text to include per message (0 to skip bodies).'),
  }),
};
```

Execute -- this is the most complex action. Port from reference `triageInbox.ts`:

1. Build query: `is:unread` + optional `additionalQuery`
2. `GET /users/me/messages?q={query}&maxResults={maxResults}`
3. For each message ref, `GET /users/me/messages/{id}?format=full` using `Promise.allSettled` for resilience
4. For each fetched message, extract:
   - Headers (From, To, Subject, Date)
   - Body excerpt (truncated to `bodyExcerptLength`)
   - Newsletter detection: check `List-Unsubscribe` and `List-Id` headers
   - Meeting keyword pattern: `/\b(meeting|call|invite|invitation|calendar|schedule|reschedul|zoom|google meet|teams)\b/i`
   - Question pattern: `/\?/`
   - Action-requested pattern: `/\b(please|could you|can you|let me know|need|review|approve|sign|deadline|by (mon|tue|wed|thu|fri|sat|sun|today|tomorrow|next week|eod|cob))\b/i`
   - Sender domain extraction
5. Compute aggregate stats: totalUnread, topSenders (top 5), newsletterCount, meetingReferenceCount, questionCount, actionRequestedCount
6. Return: `{ success: true, data: { summary: {...}, messages: [...] } }`

Key implementation detail: the `extractDomain` helper from the reference:
```typescript
function extractDomain(fromHeader: string | null): string | null {
  if (!fromHeader) return null;
  const match = fromHeader.match(/<?([^@<>\s]+)@([^>\s]+)>?/);
  return match ? match[2].toLowerCase() : null;
}
```

The text body extraction for triage needs a fallback: if no `text/plain` part, strip HTML tags from `text/html`:
```typescript
function extractTextBody(payload?: GmailPayload): string {
  const { text, html } = extractMessageBody(payload);
  if (text) return text;
  return html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, ' ');
}
```

And a truncation helper:
```typescript
function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max) + '...';
}
```

- [ ] **Step 3: Write the `executeAction` cases for list_labels and triage_inbox**

- [ ] **Step 4: Finalize the action array and export**

```typescript
const allActions: ActionDefinition[] = [
  sendEmail, listMessages, getMessage, modifyLabels, trashMessage,
  createDraft, listDrafts, getDraft, updateDraft, sendDraft, deleteDraft,
  listLabels, triageInbox,
];

export const gmailActions: ActionSource = {
  listActions: () => allActions,
  execute: executeAction,
};
```

- [ ] **Step 5: Verify typecheck**

Run: `cd /Users/conner/code/valet && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-gmail/src/actions/actions.ts
git commit -m "feat(gmail): port list_labels and triage_inbox, complete 13-action rewrite"
```

---

## Task 4: Create Gmail Skill

**Files:**
- Create: `packages/plugin-gmail/skills/gmail.md`
- Modify: `packages/plugin-gmail/plugin.yaml` (verify skills directory is discoverable)

Gmail currently has no skill file. The registry generator auto-discovers `skills/*.md` from the plugin directory.

- [ ] **Step 1: Verify plugin.yaml doesn't need changes**

Read `packages/plugin-gmail/plugin.yaml`. The registry generator scans for `skills/*.md` in the plugin directory automatically -- no explicit declaration needed in `plugin.yaml`. Just verify the directory structure works.

- [ ] **Step 2: Create the skills directory**

```bash
mkdir -p packages/plugin-gmail/skills
```

- [ ] **Step 3: Write the skill file**

Create `packages/plugin-gmail/skills/gmail.md`:

```
---
name: gmail
description: How to use Gmail tools -- reading messages, composing emails, managing drafts, triaging inbox, and organizing with labels.
---

# Gmail

## Available Tools (13 actions)

### Messages
- gmail.send_email -- send a new email or threaded reply
- gmail.list_messages -- search/list messages with Gmail query syntax
- gmail.get_message -- fetch a single message with full content
- gmail.modify_labels -- add/remove labels (archive, star, mark read)
- gmail.trash_message -- move a message to trash (30-day recovery)

### Drafts
- gmail.create_draft -- compose a draft for user review
- gmail.list_drafts -- list existing drafts
- gmail.get_draft -- fetch a draft with full content
- gmail.update_draft -- replace a draft's contents
- gmail.send_draft -- send an existing draft
- gmail.delete_draft -- permanently delete a draft

### Labels & Triage
- gmail.list_labels -- discover all label IDs
- gmail.triage_inbox -- fetch unread messages with heuristic categorization

## Common Workflows

### Inbox Triage
[triage_inbox -> review categorized messages -> create_draft/modify_labels/trash_message]

### Reply to Email
[get_message (read original) -> send_email with replyToMessageId for proper threading]

### Draft-Review-Send
[create_draft -> update_draft (revise) -> send_draft]

### Label Management
- Archive: modify_labels with removeLabelIds: ['INBOX']
- Star: modify_labels with addLabelIds: ['STARRED']
- Mark read: modify_labels with removeLabelIds: ['UNREAD']
- Use list_labels to discover custom label IDs

### Gmail Search Syntax
[Examples for q parameter: is:unread, from:, has:attachment, newer_than:, subject:, etc.]
```

Flesh out each section with concrete code examples showing the action params, similar to the calendar skill format.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-gmail/skills/gmail.md
git commit -m "docs(gmail): create skill file documenting 13-action tool set"
```

---

## Task 5: Regenerate Registries and Verify

**Files:**
- Modify (auto-generated): `packages/worker/src/integrations/packages.ts`
- Modify (auto-generated): `packages/worker/src/plugins/content-registry.ts`

- [ ] **Step 1: Regenerate registries**

Run: `make generate-registries`

This re-scans `packages/plugin-*/` and regenerates:
- `packages/worker/src/plugins/content-registry.ts` -- will now include the new Gmail skill content (it previously had none)
- `packages/worker/src/integrations/packages.ts` -- no structural change (same package name)

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`

This verifies:
- The new `actions.ts` compiles correctly with all 13 actions
- The generated registries reference the correct exports
- The new skill file is properly inlined in the content registry

- [ ] **Step 3: Verify no stale references to removed actions**

Search for any remaining references to the 5 dropped action IDs:

```
gmail.reply_to_email, gmail.archive, gmail.star, gmail.mark_read, gmail.get_attachment
```

Also check for the renamed IDs:
- `gmail.trash` (renamed to `gmail.trash_message`)
- `gmail.get_labels` (renamed to `gmail.list_labels`)

These should only appear in git history, not in the current codebase.

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/integrations/packages.ts packages/worker/src/plugins/content-registry.ts
git commit -m "chore: regenerate registries after gmail port"
```

---

## Summary of Changes

| File | Action | What Changes |
|------|--------|--------------|
| `packages/plugin-gmail/src/actions/actions.ts` | Rewrite | 13 actions -> 13 actions (different composition), new MIME helpers, triage_inbox |
| `packages/plugin-gmail/skills/gmail.md` | Create | New skill file documenting all 13 actions and workflows |
| `packages/plugin-gmail/src/actions/api.ts` | Unchanged | `gmailFetch`, `decodeBase64Url`, `encodeBase64Url` stay as-is |
| `packages/plugin-gmail/src/actions/provider.ts` | Unchanged | OAuth scopes stay as-is |
| `packages/plugin-gmail/src/actions/index.ts` | Unchanged | Package export stays as-is |
| `packages/worker/src/plugins/content-registry.ts` | Regenerated | Gains Gmail skill content |
| `packages/worker/src/integrations/packages.ts` | Regenerated | No structural change |

## Risk Assessment

| Action | Risk | Why |
|--------|------|-----|
| `gmail.send_email` | High | Sends real email. MIME encoding must be correct. Threading via `replyToMessageId` adds complexity. |
| `gmail.list_messages` | Low | Read-only. N+1 fetch pattern (list then get each) -- use `Promise.allSettled` for resilience. |
| `gmail.get_message` | Low | Read-only. MIME tree walking for body extraction is the main complexity. |
| `gmail.modify_labels` | Medium | Modifies message state. Subsumes 3 removed convenience actions. |
| `gmail.trash_message` | High | Destructive (reversible for 30 days). Renamed from `gmail.trash`. |
| `gmail.create_draft` | Medium | Creates draft, does not send. Uses same MIME pipeline as `send_email`. |
| `gmail.list_drafts` | Low | Read-only. Same N+1 pattern as `list_messages`. |
| `gmail.get_draft` | Low | Read-only. |
| `gmail.update_draft` | Medium | Full replace (not patch). Same MIME pipeline. |
| `gmail.send_draft` | High | Sends real email from draft. |
| `gmail.delete_draft` | Medium | Permanent deletion (no trash). |
| `gmail.list_labels` | Low | Read-only. |
| `gmail.triage_inbox` | Low | Read-only composite. Most complex action (heuristic categorization). |

## Key Behavior Changes from Current Implementation

1. **`reply_to_email` is removed.** Reply functionality is now handled by `send_email` with `replyToMessageId`. The MIME encoding automatically sets `In-Reply-To` and `References` headers and uses the original message's `threadId`.

2. **Convenience wrappers (`archive`, `star`, `mark_read`) are removed.** All handled by `modify_labels` with appropriate label ID arrays. The skill file documents the equivalences.

3. **`triage_inbox` is new.** A composite read-only action that fetches unread messages with heuristic categorization (newsletter, meeting, question, action-requested) and aggregate statistics. Designed for AI triage workflows.

4. **Full draft lifecycle is new.** `list_drafts`, `get_draft`, `update_draft`, `delete_draft` are all new capabilities. The current codebase only supports `create_draft` and `send_draft`.

5. **`get_message` gains format support.** The current `get_message` always fetches full format. The port adds `format` param (`full`/`metadata`/`minimal`) for efficiency.

6. **MIME encoding is rebuilt.** The current `buildRawEmail` helper is replaced with the reference repo's `buildMimeMessage` + `encodeRawMessage` pipeline, adding proper RFC 2047 header encoding for non-ASCII subjects and correct `Content-Transfer-Encoding` header.

7. **`gmail.trash` is renamed to `gmail.trash_message`** for consistency with the reference repo naming.

8. **`gmail.get_labels` is renamed to `gmail.list_labels`** for consistency (list operations use `list_` prefix).

9. **`gmail.get_attachment` is removed.** Agents lose the ability to download attachment binary data. The `get_message` action still returns attachment metadata (filename, size, mimeType, attachmentId).
