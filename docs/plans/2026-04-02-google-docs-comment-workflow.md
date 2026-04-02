# Google Docs Comment-Driven Editing Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the valet agent to read Google Docs comments, make surgical or section-level edits to address them without corrupting formatting, and resolve comments programmatically.

**Architecture:** Four changes to the `packages/plugin-google-docs` package: (1) new comments API actions using Drive API v3, (2) a formatting reset pass in the markdown-to-docs converter to prevent style bleed on insert, (3) a new `replaceText` operation for targeted first-occurrence replacements, (4) a `list_sections` action exposing document structure. All changes are in `packages/plugin-google-docs/src/actions/`.

**Tech Stack:** TypeScript, Vitest, Google Docs API v1, Google Drive API v3, Zod

---

### Task 1: Add `docs.list_comments` action

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/actions.ts` (add action definition + execution case)
- Modify: `packages/plugin-google-docs/src/actions/provider.ts` (update OAuth scope)
- Test: `packages/plugin-google-docs/src/actions/comments.test.ts` (new file)

- [ ] **Step 1: Write the failing test for list_comments**

Create `packages/plugin-google-docs/src/actions/comments.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { googleDocsActions } from './actions.js';
import type { ActionContext } from '@valet/sdk';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeCtx(): ActionContext {
  return {
    credentials: { access_token: 'test-token' },
    userId: 'test-user',
  } as ActionContext;
}

function okResponse(data: unknown = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('docs.list_comments', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('lists unresolved comments by default', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        comments: [
          {
            id: 'c1',
            content: 'Fix this typo',
            author: { displayName: 'Zeke', emailAddress: 'zeke@example.com' },
            resolved: false,
            quotedFileContent: { mimeType: 'text/html', value: 'teh system' },
            replies: [],
          },
          {
            id: 'c2',
            content: 'Already addressed',
            author: { displayName: 'Zeke', emailAddress: 'zeke@example.com' },
            resolved: true,
            replies: [{ id: 'r1', content: 'Done', author: { displayName: 'Agent' }, action: 'resolve' }],
          },
        ],
      }),
    );

    const result = await googleDocsActions.execute(
      'docs.list_comments',
      { documentId: 'doc-123' },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const data = result.data as { comments: unknown[] };
    // Should filter out resolved comments by default
    expect(data.comments).toHaveLength(1);
    expect((data.comments[0] as { id: string }).id).toBe('c1');

    // Verify Drive API was called with correct fields
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/files/doc-123/comments');
    expect(url).toContain('fields=');
  });

  it('includes resolved comments when includeResolved is true', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        comments: [
          {
            id: 'c1',
            content: 'Fix this',
            author: { displayName: 'Zeke', emailAddress: 'zeke@example.com' },
            resolved: false,
            replies: [],
          },
          {
            id: 'c2',
            content: 'Done already',
            author: { displayName: 'Zeke', emailAddress: 'zeke@example.com' },
            resolved: true,
            replies: [],
          },
        ],
      }),
    );

    const result = await googleDocsActions.execute(
      'docs.list_comments',
      { documentId: 'doc-123', includeResolved: true },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const data = result.data as { comments: unknown[] };
    expect(data.comments).toHaveLength(2);
  });

  it('paginates through all comments', async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          comments: [{ id: 'c1', content: 'First', author: {}, resolved: false, replies: [] }],
          nextPageToken: 'page2',
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          comments: [{ id: 'c2', content: 'Second', author: {}, resolved: false, replies: [] }],
        }),
      );

    const result = await googleDocsActions.execute(
      'docs.list_comments',
      { documentId: 'doc-123' },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const data = result.data as { comments: unknown[] };
    expect(data.comments).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles Google Docs URLs as documentId', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ comments: [] }));

    await googleDocsActions.execute(
      'docs.list_comments',
      { documentId: 'https://docs.google.com/document/d/abc123/edit' },
      makeCtx(),
    );

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/files/abc123/comments');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-google-docs && pnpm test -- comments.test`
Expected: FAIL — `docs.list_comments` is an unknown action

- [ ] **Step 3: Update OAuth scope in provider.ts**

In `packages/plugin-google-docs/src/actions/provider.ts`, change the scopes array:

```ts
const DOCS_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
];
```

- [ ] **Step 4: Add list_comments action definition and execution**

In `packages/plugin-google-docs/src/actions/actions.ts`, add the action definition after the existing `updateDocument` definition:

```ts
const listComments: ActionDefinition = {
  id: 'docs.list_comments',
  name: 'List Comments',
  description: 'List comments on a Google Doc. Returns unresolved comments by default.',
  riskLevel: 'low',
  params: z.object({
    documentId: z.string().describe('Google Docs document ID or full Google Docs URL'),
    includeResolved: z.boolean().optional().describe('Include resolved comments (default: false)'),
  }),
};
```

Add `listComments` to the `allActions` array.

Add the execution case in the `switch` block:

```ts
case 'docs.list_comments': {
  const { documentId, includeResolved } = listComments.params.parse(params);
  const normalizedDocumentId = normalizeDocumentId(documentId);

  const commentFields = 'comments(id,content,author(displayName,emailAddress),resolved,quotedFileContent,replies(id,content,author(displayName,emailAddress),action)),nextPageToken';
  const allComments: unknown[] = [];
  let pageToken: string | undefined;

  do {
    const qs = new URLSearchParams({
      fields: commentFields,
      pageSize: '100',
    });
    if (pageToken) qs.set('pageToken', pageToken);

    const res = await driveFetch(
      `/files/${encodeURIComponent(normalizedDocumentId)}/comments?${qs}`,
      token,
    );
    if (!res.ok) return await apiError(res, 'Drive');

    const data = (await res.json()) as {
      comments?: Array<{ resolved?: boolean }>;
      nextPageToken?: string;
    };

    for (const comment of data.comments ?? []) {
      if (!includeResolved && comment.resolved) continue;
      allComments.push(comment);
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return { success: true, data: { comments: allComments } };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/plugin-google-docs && pnpm test -- comments.test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-google-docs/src/actions/comments.test.ts packages/plugin-google-docs/src/actions/actions.ts packages/plugin-google-docs/src/actions/provider.ts
git commit -m "feat(google-docs): add docs.list_comments action with Drive API v3"
```

---

### Task 2: Add `docs.create_comment` action

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/actions.ts`
- Test: `packages/plugin-google-docs/src/actions/comments.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `comments.test.ts`:

```ts
describe('docs.create_comment', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('creates an unanchored comment', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: 'c-new',
        content: 'Needs revision',
        author: { displayName: 'Agent', emailAddress: 'agent@example.com' },
      }),
    );

    const result = await googleDocsActions.execute(
      'docs.create_comment',
      { documentId: 'doc-123', content: 'Needs revision' },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const data = result.data as { id: string; content: string };
    expect(data.id).toBe('c-new');
    expect(data.content).toBe('Needs revision');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/files/doc-123/comments');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.content).toBe('Needs revision');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-google-docs && pnpm test -- comments.test`
Expected: FAIL — `docs.create_comment` is an unknown action

- [ ] **Step 3: Add create_comment action definition and execution**

In `actions.ts`, add definition:

```ts
const createComment: ActionDefinition = {
  id: 'docs.create_comment',
  name: 'Create Comment',
  description: 'Create an unanchored comment on a Google Doc',
  riskLevel: 'medium',
  params: z.object({
    documentId: z.string().describe('Google Docs document ID or full Google Docs URL'),
    content: z.string().describe('Comment text'),
  }),
};
```

Add `createComment` to `allActions`.

Add execution case:

```ts
case 'docs.create_comment': {
  const { documentId, content } = createComment.params.parse(params);
  const normalizedDocumentId = normalizeDocumentId(documentId);

  const qs = new URLSearchParams({
    fields: 'id,content,author(displayName,emailAddress)',
  });
  const res = await driveFetch(
    `/files/${encodeURIComponent(normalizedDocumentId)}/comments?${qs}`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) return await apiError(res, 'Drive');

  const comment = await res.json();
  return { success: true, data: comment };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin-google-docs && pnpm test -- comments.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-google-docs/src/actions/actions.ts packages/plugin-google-docs/src/actions/comments.test.ts
git commit -m "feat(google-docs): add docs.create_comment action"
```

---

### Task 3: Add `docs.reply_to_comment` action

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/actions.ts`
- Test: `packages/plugin-google-docs/src/actions/comments.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `comments.test.ts`:

```ts
describe('docs.reply_to_comment', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('posts a reply to a comment', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: 'r-new',
        content: 'Good point, fixing now',
        author: { displayName: 'Agent' },
      }),
    );

    const result = await googleDocsActions.execute(
      'docs.reply_to_comment',
      { documentId: 'doc-123', commentId: 'c1', content: 'Good point, fixing now' },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/files/doc-123/comments/c1/replies');
    const body = JSON.parse(opts.body);
    expect(body.content).toBe('Good point, fixing now');
    expect(body.action).toBeUndefined();
  });

  it('resolves a comment when resolve is true', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ id: 'r-new', content: 'Fixed', action: 'resolve' }),
    );

    const result = await googleDocsActions.execute(
      'docs.reply_to_comment',
      { documentId: 'doc-123', commentId: 'c1', content: 'Fixed', resolve: true },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.action).toBe('resolve');
  });

  it('reopens a comment when reopen is true', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ id: 'r-new', content: 'Actually not fixed', action: 'reopen' }),
    );

    const result = await googleDocsActions.execute(
      'docs.reply_to_comment',
      { documentId: 'doc-123', commentId: 'c1', content: 'Actually not fixed', reopen: true },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.action).toBe('reopen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-google-docs && pnpm test -- comments.test`
Expected: FAIL — `docs.reply_to_comment` is an unknown action

- [ ] **Step 3: Add reply_to_comment action definition and execution**

In `actions.ts`, add definition:

```ts
const replyToComment: ActionDefinition = {
  id: 'docs.reply_to_comment',
  name: 'Reply to Comment',
  description:
    'Reply to a comment on a Google Doc. Set resolve: true to resolve the comment, or reopen: true to reopen a resolved comment. Resolving is done by posting a reply with action "resolve" — the resolved field on comments is read-only.',
  riskLevel: 'medium',
  params: z.object({
    documentId: z.string().describe('Google Docs document ID or full Google Docs URL'),
    commentId: z.string().describe('ID of the comment to reply to'),
    content: z.string().describe('Reply text'),
    resolve: z.boolean().optional().describe('Resolve the comment with this reply'),
    reopen: z.boolean().optional().describe('Reopen a resolved comment with this reply'),
  }),
};
```

Add `replyToComment` to `allActions`.

Add execution case:

```ts
case 'docs.reply_to_comment': {
  const { documentId, commentId, content, resolve, reopen } =
    replyToComment.params.parse(params);
  const normalizedDocumentId = normalizeDocumentId(documentId);

  const replyBody: Record<string, string> = { content };
  if (resolve) replyBody.action = 'resolve';
  else if (reopen) replyBody.action = 'reopen';

  const qs = new URLSearchParams({
    fields: 'id,content,author(displayName,emailAddress),action',
  });
  const res = await driveFetch(
    `/files/${encodeURIComponent(normalizedDocumentId)}/comments/${encodeURIComponent(commentId)}/replies?${qs}`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(replyBody),
    },
  );
  if (!res.ok) return await apiError(res, 'Drive');

  const reply = await res.json();
  return { success: true, data: reply };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin-google-docs && pnpm test -- comments.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-google-docs/src/actions/actions.ts packages/plugin-google-docs/src/actions/comments.test.ts
git commit -m "feat(google-docs): add docs.reply_to_comment action with resolve/reopen support"
```

---

### Task 4: Add style reset pass to `finalizeFormatting()`

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/markdown-to-docs.ts`
- Test: `packages/plugin-google-docs/src/actions/markdown-to-docs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `markdown-to-docs.test.ts`:

```ts
describe('style reset on insert', () => {
  it('emits updateTextStyle reset for heading paragraphs', () => {
    const result = convertMarkdownToRequests('# My Heading');

    // Find the paragraph style request (sets namedStyleType)
    const paraStyleReqs = findAllRequests(result, 'updateParagraphStyle');
    expect(paraStyleReqs.length).toBeGreaterThan(0);

    const headingParaStyle = paraStyleReqs.find((r) => {
      const ps = (r.updateParagraphStyle as { paragraphStyle: { namedStyleType?: string } })
        .paragraphStyle;
      return ps.namedStyleType === 'HEADING_1';
    });
    expect(headingParaStyle).toBeDefined();

    // There should also be a text style reset that covers the same range
    // with fields "fontSize,weightedFontFamily" and an empty textStyle
    const textStyleReqs = findAllRequests(result, 'updateTextStyle');
    const resetReq = textStyleReqs.find((r) => {
      const ts = r.updateTextStyle as {
        fields: string;
        textStyle: Record<string, unknown>;
      };
      return (
        ts.fields === 'fontSize,weightedFontFamily' &&
        Object.keys(ts.textStyle).length === 0
      );
    });
    expect(resetReq).toBeDefined();
  });

  it('emits updateTextStyle reset for normal paragraphs', () => {
    const result = convertMarkdownToRequests('Just a paragraph of text.');

    const textStyleReqs = findAllRequests(result, 'updateTextStyle');
    const resetReq = textStyleReqs.find((r) => {
      const ts = r.updateTextStyle as {
        fields: string;
        textStyle: Record<string, unknown>;
      };
      return (
        ts.fields === 'fontSize,weightedFontFamily' &&
        Object.keys(ts.textStyle).length === 0
      );
    });
    expect(resetReq).toBeDefined();
  });

  it('emits reset with tabId when tabId is provided', () => {
    const result = convertMarkdownToRequests('# Heading', { tabId: 'tab-1' });

    const textStyleReqs = findAllRequests(result, 'updateTextStyle');
    const resetReq = textStyleReqs.find((r) => {
      const ts = r.updateTextStyle as {
        fields: string;
        range: { tabId?: string };
      };
      return ts.fields === 'fontSize,weightedFontFamily' && ts.range.tabId === 'tab-1';
    });
    expect(resetReq).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-google-docs && pnpm test -- markdown-to-docs.test`
Expected: FAIL — no reset requests are emitted

- [ ] **Step 3: Add style reset pass to finalizeFormatting()**

In `packages/plugin-google-docs/src/actions/markdown-to-docs.ts`, add the following at the beginning of `finalizeFormatting()`, before the existing character-level formatting loop:

```ts
// Style reset pass: clear inherited fontSize/weightedFontFamily so
// named styles (HEADING_1, NORMAL_TEXT, etc.) control the appearance.
// Without this, inserted text inherits character-level styling from
// the text before the insertion point, causing font size scrambling.

// Reset for heading paragraphs
for (const paraRange of context.paragraphRanges) {
  const range: Record<string, unknown> = {
    startIndex: paraRange.startIndex,
    endIndex: paraRange.endIndex,
  };
  if (context.tabId) range.tabId = context.tabId;

  context.formatRequests.push({
    updateTextStyle: {
      range,
      textStyle: {},
      fields: 'fontSize,weightedFontFamily',
    },
  });
}

// Reset for normal paragraphs
for (const normalRange of context.normalParagraphRanges) {
  const range: Record<string, unknown> = {
    startIndex: normalRange.startIndex,
    endIndex: normalRange.endIndex,
  };
  if (context.tabId) range.tabId = context.tabId;

  context.formatRequests.push({
    updateTextStyle: {
      range,
      textStyle: {},
      fields: 'fontSize,weightedFontFamily',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin-google-docs && pnpm test -- markdown-to-docs.test`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd packages/plugin-google-docs && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-google-docs/src/actions/markdown-to-docs.ts packages/plugin-google-docs/src/actions/markdown-to-docs.test.ts
git commit -m "fix(google-docs): add style reset pass to prevent formatting corruption on insert"
```

---

### Task 5: Sort batch requests by reverse index

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/api.ts`
- Test: `packages/plugin-google-docs/src/actions/api.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `packages/plugin-google-docs/src/actions/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeBatchUpdate } from './api.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okResponse() {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('executeBatchUpdate reverse-index sorting', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sorts delete requests by descending startIndex', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await executeBatchUpdate('doc-1', 'token', [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
      { deleteContentRange: { range: { startIndex: 50, endIndex: 60 } } },
      { deleteContentRange: { range: { startIndex: 30, endIndex: 40 } } },
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const indices = body.requests.map(
      (r: { deleteContentRange: { range: { startIndex: number } } }) =>
        r.deleteContentRange.range.startIndex,
    );
    expect(indices).toEqual([50, 30, 10]);
  });

  it('sorts insert requests by descending index', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await executeBatchUpdate('doc-1', 'token', [
      { insertText: { location: { index: 5 }, text: 'a' } },
      { insertText: { location: { index: 50 }, text: 'b' } },
      { insertText: { location: { index: 20 }, text: 'c' } },
    ]);

    // Inserts go in the second call (first call is empty deletes, skipped)
    const calls = mockFetch.mock.calls;
    const insertBody = JSON.parse(calls[0][1].body);
    const indices = insertBody.requests.map(
      (r: { insertText: { location: { index: number } } }) =>
        r.insertText.location.index,
    );
    expect(indices).toEqual([50, 20, 5]);
  });

  it('does not sort when preserveOrder is true', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await executeBatchUpdate(
      'doc-1',
      'token',
      [
        { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
        { deleteContentRange: { range: { startIndex: 50, endIndex: 60 } } },
      ],
      { preserveOrder: true },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const indices = body.requests.map(
      (r: { deleteContentRange: { range: { startIndex: number } } }) =>
        r.deleteContentRange.range.startIndex,
    );
    // Order preserved as provided
    expect(indices).toEqual([10, 50]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-google-docs && pnpm test -- api.test`
Expected: FAIL — requests are not sorted

- [ ] **Step 3: Add reverse-index sorting to executeBatchUpdate**

In `packages/plugin-google-docs/src/actions/api.ts`, add a helper function before `executeBatchUpdate`:

```ts
/**
 * Extract the primary index from a request for sorting.
 * Deletes use startIndex, inserts use index, format requests use startIndex from range.
 * Returns -1 if no index found (will sort to beginning).
 */
function extractRequestIndex(req: DocsRequest): number {
  const key = Object.keys(req)[0];
  const value = req[key] as Record<string, unknown>;

  if (key === 'deleteContentRange') {
    const range = value.range as { startIndex?: number } | undefined;
    return range?.startIndex ?? -1;
  }

  // Insert types use location.index
  if ('location' in value) {
    const location = value.location as { index?: number } | undefined;
    return location?.index ?? -1;
  }

  // Format types use range.startIndex
  if ('range' in value) {
    const range = value.range as { startIndex?: number } | undefined;
    return range?.startIndex ?? -1;
  }

  return -1;
}

/** Sort requests by descending index (highest first = "write backwards"). */
function sortByReverseIndex(requests: DocsRequest[]): DocsRequest[] {
  return [...requests].sort((a, b) => extractRequestIndex(b) - extractRequestIndex(a));
}
```

Then in the non-preserveOrder branch of `executeBatchUpdate`, sort each phase before executing. Replace the `const phases` line and the loop:

```ts
  // Sort each phase by reverse index ("write backwards" per Google's recommendation)
  const phases = [
    sortByReverseIndex(deleteRequests),
    sortByReverseIndex(insertRequests),
    sortByReverseIndex(formatRequests),
  ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin-google-docs && pnpm test -- api.test`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd packages/plugin-google-docs && pnpm test`
Expected: All tests PASS. Note: some existing tests may rely on specific request ordering. If any fail, the test fixtures need updating to expect reverse-sorted order.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-google-docs/src/actions/api.ts packages/plugin-google-docs/src/actions/api.test.ts
git commit -m "fix(google-docs): sort batch requests by reverse index per Google API guidance"
```

---

### Task 6: Add `replaceText` operation to `update_document`

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/operations.ts`
- Test: `packages/plugin-google-docs/src/actions/update-document.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `update-document.test.ts`:

```ts
describe('replaceText operation', () => {
  it('replaces the first occurrence of target text', async () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [
                {
                  startIndex: 1,
                  endIndex: 45,
                  textRun: { content: 'The system uses AES-128 encryption today.\n' },
                },
              ],
            },
          },
        ],
      },
    };

    mockFetch
      .mockResolvedValueOnce(okResponse(doc))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsJson: [
          {
            type: 'replaceText',
            find: 'AES-128',
            replace: 'AES-256',
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    // Should delete "AES-128" (7 chars starting at index 22) then insert "AES-256"
    expect(body.requests).toEqual([
      {
        deleteContentRange: {
          range: { startIndex: 22, endIndex: 29 },
        },
      },
      {
        insertText: {
          location: { index: 22 },
          text: 'AES-256',
        },
      },
    ]);
  });

  it('targets the Nth occurrence when occurrence param is set', async () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [
                {
                  startIndex: 1,
                  endIndex: 21,
                  textRun: { content: 'foo bar foo baz foo\n' },
                },
              ],
            },
          },
        ],
      },
    };

    mockFetch
      .mockResolvedValueOnce(okResponse(doc))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsJson: [
          {
            type: 'replaceText',
            find: 'foo',
            replace: 'qux',
            occurrence: 2,
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    // Second "foo" starts at offset 8 in the text, doc index = 1 + 8 = 9
    expect(body.requests[0].deleteContentRange.range.startIndex).toBe(9);
  });

  it('errors when target text is not found', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(makeDocument()));

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsJson: [
          {
            type: 'replaceText',
            find: 'nonexistent text',
            replace: 'something',
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('tracks mutations across replaceText and other operations', async () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [
                {
                  startIndex: 1,
                  endIndex: 20,
                  textRun: { content: 'aaa bbb ccc ddd\n' },
                },
              ],
            },
          },
        ],
      },
    };

    mockFetch
      .mockResolvedValueOnce(okResponse(doc))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsJson: [
          {
            type: 'replaceText',
            find: 'aaa',
            replace: 'AAAAA',
          },
          {
            type: 'replaceText',
            find: 'ccc',
            replace: 'C',
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    // First replaceText: delete at 1-4, insert "AAAAA" at 1 → mutation adds 2 chars
    // Second replaceText: original "ccc" at index 9, adjusted to 9+2=11
    expect(body.requests[0].deleteContentRange.range.startIndex).toBe(1);
    expect(body.requests[0].deleteContentRange.range.endIndex).toBe(4);
    expect(body.requests[1].insertText.location.index).toBe(1);
    expect(body.requests[2].deleteContentRange.range.startIndex).toBe(11);
    expect(body.requests[2].deleteContentRange.range.endIndex).toBe(14);
    expect(body.requests[3].insertText.location.index).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-google-docs && pnpm test -- update-document.test`
Expected: FAIL — `replaceText` is an unknown operation type

- [ ] **Step 3: Add replaceText schema and translation**

In `packages/plugin-google-docs/src/actions/operations.ts`:

Add the schema after `insertTextOperationSchema`:

```ts
export const replaceTextOperationSchema = z.object({
  type: z.literal('replaceText'),
  find: z.string().describe('Exact text to find in the document'),
  replace: z.string().describe('Replacement text'),
  occurrence: z.number().int().min(1).optional().describe('Which occurrence to target (default: 1, first occurrence)'),
});
```

Update the union:

```ts
export const updateDocumentOperationSchema = z.union([
  replaceAllOperationSchema,
  fillCellOperationSchema,
  insertTextOperationSchema,
  replaceTextOperationSchema,
]);
```

Add `'replaceText'` case to `parseUpdateOperation`:

```ts
case 'replaceText': {
  return replaceTextOperationSchema.parse(input);
}
```

Update `requiresDocumentRead` to include `replaceText`:

```ts
export function requiresDocumentRead(operations: UpdateDocumentOperation[]): boolean {
  return operations.some((operation) => operation.type !== 'replaceAll');
}
```

(This already works since `replaceText !== 'replaceAll'`, so no change needed.)

Add the translation function:

```ts
function translateReplaceTextOperation(
  body: DocsBody,
  operation: Extract<UpdateDocumentOperation, { type: 'replaceText' }>,
  operationIndex: number,
  mutations: IndexMutation[],
): { requests: DocsRequest[]; mutation: IndexMutation } {
  const segments = collectTextSegments(body.content ?? []);
  const fullText = segments.map((segment) => segment.text).join('');
  const targetOccurrence = operation.occurrence ?? 1;

  // Find the Nth occurrence
  let searchFrom = 0;
  let foundOffset = -1;
  for (let n = 0; n < targetOccurrence; n++) {
    foundOffset = fullText.indexOf(operation.find, searchFrom);
    if (foundOffset === -1) break;
    searchFrom = foundOffset + 1;
  }

  if (foundOffset === -1) {
    const suffix = targetOccurrence > 1 ? ` (occurrence ${targetOccurrence})` : '';
    throw new Error(
      `operation[${operationIndex}]: text '${operation.find}' not found${suffix}`,
    );
  }

  const indexMap = buildIndexMap(segments);
  const docStartIndex = indexMap[foundOffset];
  const docEndIndex = indexMap[foundOffset + operation.find.length - 1] + 1;

  const adjustedStartIndex = adjustIndexForMutations(docStartIndex, mutations, operationIndex);
  const adjustedEndIndex = adjustIndexForMutations(docEndIndex, mutations, operationIndex);

  const requests: DocsRequest[] = [
    {
      deleteContentRange: {
        range: { startIndex: adjustedStartIndex, endIndex: adjustedEndIndex },
      },
    },
    {
      insertText: {
        location: { index: adjustedStartIndex },
        text: operation.replace,
      },
    },
  ];

  return {
    requests,
    mutation: {
      startIndex: docStartIndex,
      endIndex: docEndIndex,
      newLength: operation.replace.length,
    },
  };
}
```

Add the `replaceText` case to the loop in `translateUpdateOperations`:

```ts
if (operation.type === 'replaceText') {
  const translated = translateReplaceTextOperation(body, operation, index, mutations);
  requests.push(...translated.requests);
  mutations.push(translated.mutation);
  continue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin-google-docs && pnpm test -- update-document.test`
Expected: PASS

- [ ] **Step 5: Update the update_document action description**

In `actions.ts`, update the `updateDocument` definition description to mention `replaceText`:

```ts
const updateDocument: ActionDefinition = {
  id: 'docs.update_document',
  name: 'Update Document',
  description:
    'Apply targeted edits to a Google Doc without replacing the full body. Supports operations: replaceAll (global find-replace), replaceText (replace Nth occurrence of specific text), fillCell (table cell update), and insertText (anchor-based insertion). Accepts TOON-encoded or JSON operations.',
  riskLevel: 'high',
  params: z.object({
    documentId: z.string().describe('Google Docs document ID or full Google Docs URL'),
    operationsToon: z.string().optional().describe('TOON-encoded array of operations to apply'),
    operationsJson: z.array(z.unknown()).optional().describe('JSON array of operations to apply'),
    tabId: z.string().optional().describe('Tab ID for multi-tab documents'),
  }).refine((value) => Boolean(value.operationsToon || value.operationsJson), {
    message: 'Provide either operationsToon or operationsJson',
    path: ['operationsToon'],
  }),
};
```

- [ ] **Step 6: Run full test suite**

Run: `cd packages/plugin-google-docs && pnpm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-google-docs/src/actions/operations.ts packages/plugin-google-docs/src/actions/update-document.test.ts packages/plugin-google-docs/src/actions/actions.ts
git commit -m "feat(google-docs): add replaceText operation for surgical first-occurrence edits"
```

---

### Task 7: Add `docs.list_sections` action

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/actions.ts`
- Modify: `packages/plugin-google-docs/src/actions/sections.ts` (export `extractSections` — already exported)
- Test: `packages/plugin-google-docs/src/actions/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `actions.test.ts`:

```ts
describe('docs.list_sections', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns all sections with heading, level, and index ranges', async () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              paragraphStyle: { namedStyleType: 'HEADING_1' },
              elements: [
                { startIndex: 1, endIndex: 12, textRun: { content: 'Chapter 1\n' } },
              ],
            },
          },
          {
            paragraph: {
              elements: [
                { startIndex: 12, endIndex: 30, textRun: { content: 'Some body text.\n' } },
              ],
            },
          },
          {
            paragraph: {
              paragraphStyle: { namedStyleType: 'HEADING_2' },
              elements: [
                { startIndex: 30, endIndex: 43, textRun: { content: 'Subsection\n' } },
              ],
            },
          },
          {
            paragraph: {
              paragraphStyle: { namedStyleType: 'HEADING_1' },
              elements: [
                { startIndex: 43, endIndex: 54, textRun: { content: 'Chapter 2\n' } },
              ],
            },
          },
        ],
      },
    };

    mockFetch.mockResolvedValueOnce(okResponse(doc));

    const result = await googleDocsActions.execute(
      'docs.list_sections',
      { documentId: 'doc-123' },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const data = result.data as { sections: Array<{ heading: string; level: number; startIndex: number; endIndex: number }> };
    expect(data.sections).toEqual([
      { heading: 'Chapter 1', level: 1, startIndex: 1, endIndex: 43 },
      { heading: 'Subsection', level: 2, startIndex: 30, endIndex: 43 },
      { heading: 'Chapter 2', level: 1, startIndex: 43, endIndex: 54 },
    ]);
  });

  it('returns empty array for document with no headings', async () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [
                { startIndex: 1, endIndex: 12, textRun: { content: 'Just text.\n' } },
              ],
            },
          },
        ],
      },
    };

    mockFetch.mockResolvedValueOnce(okResponse(doc));

    const result = await googleDocsActions.execute(
      'docs.list_sections',
      { documentId: 'doc-123' },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const data = result.data as { sections: unknown[] };
    expect(data.sections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-google-docs && pnpm test -- actions.test`
Expected: FAIL — `docs.list_sections` is an unknown action

- [ ] **Step 3: Add list_sections action definition and execution**

In `actions.ts`, add import for `extractSections`:

```ts
import { findSection, getBodyEndIndex, extractSections } from './sections.js';
```

Add definition:

```ts
const listSections: ActionDefinition = {
  id: 'docs.list_sections',
  name: 'List Sections',
  description: 'List all sections (headings) in a Google Doc with their levels and index ranges. Useful for understanding document structure before making targeted edits.',
  riskLevel: 'low',
  params: z.object({
    documentId: z.string().describe('Google Docs document ID or full Google Docs URL'),
    tabId: z.string().optional().describe('Specific tab ID (for multi-tab docs)'),
  }),
};
```

Add `listSections` to `allActions`.

Add execution case:

```ts
case 'docs.list_sections': {
  const { documentId, tabId } = listSections.params.parse(params);
  const normalizedDocumentId = normalizeDocumentId(documentId);
  const result = await fetchDocument(normalizedDocumentId, token);
  if (!result.ok) return result.error;

  let body: DocsBody;
  if (tabId) {
    const tabs = (result.doc as { tabs?: Array<{ tabProperties?: { tabId?: string }; body?: DocsBody; documentTab?: { body?: DocsBody } }> }).tabs;
    const tab = tabs?.find((t) => t.tabProperties?.tabId === tabId);
    if (!tab) {
      return { success: false, error: `Tab '${tabId}' not found in document` };
    }
    body = tab.documentTab?.body ?? tab.body ?? {};
  } else {
    body = (result.doc.body ?? {}) as DocsBody;
  }

  const sections = extractSections(body);
  return {
    success: true,
    data: {
      sections: sections.map((s) => ({
        heading: s.heading,
        level: s.level,
        startIndex: s.startIndex,
        endIndex: s.endIndex,
      })),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin-google-docs && pnpm test -- actions.test`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd packages/plugin-google-docs && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-google-docs/src/actions/actions.ts packages/plugin-google-docs/src/actions/actions.test.ts
git commit -m "feat(google-docs): add docs.list_sections action for document structure discovery"
```

---

### Task 8: Regenerate plugin registries and final verification

**Files:**
- Modify: `packages/worker/src/integrations/packages.ts` (auto-generated)

- [ ] **Step 1: Regenerate registries**

Run: `make generate-registries`
Expected: Registries regenerated successfully

- [ ] **Step 2: Typecheck all packages**

Run: `pnpm typecheck`
Expected: No errors across all packages

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Commit registry changes if any**

```bash
git add -A && git status
# If there are changes to generated files:
git commit -m "chore: regenerate plugin registries after google-docs comment actions"
```
