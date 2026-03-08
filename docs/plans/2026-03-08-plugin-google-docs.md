# Google Docs Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `plugin-google-docs` package that lets agents read/write Google Docs using markdown as the interface.

**Architecture:** Port the markdown ↔ Docs converter from [google-docs-mcp](https://github.com/a-bonus/google-docs-mcp) (MIT, cloned at `/tmp/google-docs-mcp`), replacing `googleapis` SDK calls with raw `fetch()`. Follow the exact plugin structure of `plugin-google-drive`. 10 high-level actions instead of 44 low-level tools.

**Tech Stack:** TypeScript, raw `fetch()`, `markdown-it` for parsing, `zod` for schemas, `@valet/sdk` integration contracts.

---

### Task 1: Scaffold Plugin Package

**Files:**
- Create: `packages/plugin-google-docs/plugin.yaml`
- Create: `packages/plugin-google-docs/package.json`
- Create: `packages/plugin-google-docs/tsconfig.json`
- Create: `packages/plugin-google-docs/src/actions/index.ts` (stub)

**Step 1: Create plugin.yaml**

```yaml
name: google-docs
version: 0.0.1
description: Google Docs integration with markdown-native read/write
icon: "\U0001F4DD"
```

**Step 2: Create package.json**

```json
{
  "name": "@valet/plugin-google-docs",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./actions": "./src/actions/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@valet/sdk": "workspace:*",
    "@valet/shared": "workspace:*",
    "markdown-it": "^14.1.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/markdown-it": "^14.1.2",
    "typescript": "^5.3.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": []
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../sdk" }, { "path": "../shared" }]
}
```

**Step 4: Create stub index.ts**

Create `packages/plugin-google-docs/src/actions/index.ts`:

```typescript
import type { IntegrationPackage } from '@valet/sdk';

// Stubs — will be implemented in subsequent tasks
const googleDocsPackage: IntegrationPackage = {
  name: '@valet/actions-google-docs',
  version: '0.0.1',
  service: 'google_docs',
  provider: undefined as any,
  actions: undefined as any,
};

export default googleDocsPackage;
```

**Step 5: Wire into workspace**

Add to `packages/worker/package.json` dependencies:
```json
"@valet/plugin-google-docs": "workspace:*",
```

Add to root `tsconfig.json` references:
```json
{ "path": "./packages/plugin-google-docs" }
```

Add to `packages/worker/tsconfig.json` references:
```json
{ "path": "../plugin-google-docs" }
```

**Step 6: Install and verify**

Run: `pnpm install`
Run: `cd packages/plugin-google-docs && pnpm typecheck`
Expected: passes (stub compiles)

**Step 7: Commit**

```bash
git add packages/plugin-google-docs/ packages/worker/package.json tsconfig.json packages/worker/tsconfig.json pnpm-lock.yaml
git commit -m "feat(google-docs): scaffold plugin package"
```

---

### Task 2: API Helpers

**Files:**
- Create: `packages/plugin-google-docs/src/actions/api.ts`

**Step 1: Write API helpers**

Port the pattern from `plugin-google-drive/src/actions/api.ts`. Two fetch helpers — one for the Docs API, one for Drive (metadata only).

```typescript
const DOCS_API = 'https://docs.googleapis.com/v1';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** Authenticated fetch against Google Docs API v1. */
export async function docsFetch(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${DOCS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/** Authenticated fetch against Google Drive API v3 (for document discovery). */
export async function driveFetch(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/** Build descriptive error from a failed API response. */
export async function apiError(res: Response, api: string): Promise<{ success: false; error: string }> {
  let detail = '';
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    detail = json?.error?.message || body.slice(0, 500);
  } catch {
    detail = res.statusText;
  }
  return { success: false, error: `${api} API ${res.status}: ${detail}` };
}
```

**Step 2: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`
Expected: passes

**Step 3: Commit**

```bash
git add packages/plugin-google-docs/src/actions/api.ts
git commit -m "feat(google-docs): add API fetch helpers"
```

---

### Task 3: OAuth Provider

**Files:**
- Create: `packages/plugin-google-docs/src/actions/provider.ts`

**Step 1: Write provider**

Copy the exact pattern from `plugin-google-drive/src/actions/provider.ts`, changing:
- `service`: `'google_docs'`
- `displayName`: `'Google Docs'`
- `supportedEntities`: `['documents']`
- Scopes: `documents` + `drive.metadata.readonly`
- `testConnection`: call `docsFetch('/documents/...')` — use Drive files list filtered to docs MIME type since Docs API has no lightweight "list" endpoint

```typescript
import type { IntegrationProvider, IntegrationCredentials, OAuthConfig } from '@valet/sdk';
import { driveFetch } from './api.js';

const GOOGLE_OAUTH = 'https://oauth2.googleapis.com';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

const DOCS_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

export const googleDocsProvider: IntegrationProvider = {
  service: 'google_docs',
  displayName: 'Google Docs',
  authType: 'oauth2',
  supportedEntities: ['documents'],
  oauthScopes: DOCS_SCOPES,
  oauthEnvKeys: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },

  validateCredentials(credentials: IntegrationCredentials): boolean {
    return !!(credentials.access_token || credentials.refresh_token);
  },

  async testConnection(credentials: IntegrationCredentials): Promise<boolean> {
    const token = credentials.access_token || '';
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.document'");
    const res = await driveFetch(`/files?q=${q}&pageSize=1&fields=files(id)`, token);
    return res.ok;
  },

  // getOAuthUrl, exchangeOAuthCode, refreshOAuthTokens — identical to Drive provider
  // (copy verbatim from plugin-google-drive/src/actions/provider.ts, only change DRIVE_SCOPES → DOCS_SCOPES)
  getOAuthUrl(oauth: OAuthConfig, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: oauth.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DOCS_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH}?${params}`;
  },

  async exchangeOAuthCode(oauth, code, redirectUri) {
    // ... identical to Drive provider ...
  },

  async refreshOAuthTokens(oauth, refreshToken) {
    // ... identical to Drive provider ...
  },
};
```

Copy the `exchangeOAuthCode` and `refreshOAuthTokens` implementations verbatim from `packages/plugin-google-drive/src/actions/provider.ts`.

**Step 2: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`

**Step 3: Commit**

```bash
git add packages/plugin-google-docs/src/actions/provider.ts
git commit -m "feat(google-docs): add OAuth provider"
```

---

### Task 4: Docs-to-Markdown Converter

**Files:**
- Create: `packages/plugin-google-docs/src/actions/docs-to-markdown.ts`

**Step 1: Port docsToMarkdown from reference**

Adapt `/tmp/google-docs-mcp/src/markdown-transformer/docsToMarkdown.ts` (310 lines). This file is self-contained — it takes a raw JSON document body and returns markdown. No SDK dependencies to remove.

Key changes from reference:
- Remove `googleapis` type imports — define minimal inline types for the document structure we need (`StructuralElement`, `Paragraph`, `TextRun`, `Table`, `TableCell`, etc.)
- Export a single function: `docsToMarkdown(body: DocsBody, lists?: DocsLists): string`
- Keep all detection logic: headings by `namedStyleType`, lists by `bullet` property, code blocks by styled 1x1 tables, formatting by text style properties

The inline types needed (define at top of file):

```typescript
/** Minimal Google Docs API types for document reading. */

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  link?: { url?: string };
  weightedFontFamily?: { fontFamily?: string };
}

interface TextRun {
  content?: string;
  textStyle?: TextStyle;
}

interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: TextRun;
  inlineObjectElement?: { inlineObjectId?: string };
}

interface ParagraphStyle {
  namedStyleType?: string;
}

interface Bullet {
  listId?: string;
  nestingLevel?: number;
}

interface Paragraph {
  elements?: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
  bullet?: Bullet;
}

interface TableCell {
  content?: StructuralElement[];
  tableCellStyle?: {
    backgroundColor?: {
      color?: { rgbColor?: { red?: number; green?: number; blue?: number } };
    };
  };
}

interface TableRow {
  tableCells?: TableCell[];
}

interface Table {
  rows?: number;
  columns?: number;
  tableRows?: TableRow[];
}

interface StructuralElement {
  paragraph?: Paragraph;
  table?: Table;
  sectionBreak?: Record<string, unknown>;
}

export interface DocsBody {
  content?: StructuralElement[];
}

interface NestingLevel {
  glyphType?: string;
  glyphSymbol?: string;
}

interface ListProperties {
  nestingLevels?: NestingLevel[];
}

export interface DocsLists {
  [listId: string]: { listProperties?: ListProperties };
}
```

Port the conversion logic from the reference, preserving:
- Heading detection (`TITLE` → `# `, `SUBTITLE` → `## `, `HEADING_N` → N `#`s)
- List detection (ordered vs unordered via glyphType, nesting)
- Text formatting (bold, italic, strikethrough, code via monospace font detection, links)
- Code block detection (1x1 tables with gray bg or monospace font → fenced code)
- Regular table → GFM pipe syntax
- Section break → `---`

**Step 2: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`

**Step 3: Commit**

```bash
git add packages/plugin-google-docs/src/actions/docs-to-markdown.ts
git commit -m "feat(google-docs): port docs-to-markdown converter"
```

---

### Task 5: Markdown-to-Docs Converter

**Files:**
- Create: `packages/plugin-google-docs/src/actions/markdown-to-docs.ts`

**Step 1: Port markdownToDocs from reference**

Adapt `/tmp/google-docs-mcp/src/markdown-transformer/markdownToDocs.ts` (1,069 lines). This is the most complex file.

Key changes from reference:
- Remove all `googleapis` / `docs_v1.Schema$Request` types — define our own minimal request types
- The function should return an array of raw request objects (JSON) that can be sent to the `batchUpdate` endpoint via `fetch()`
- Keep `markdown-it` as the parser (same dependency)

Define request types at top of file:

```typescript
/** Google Docs batchUpdate request types (minimal, for raw fetch). */

interface DocsRange {
  startIndex: number;
  endIndex: number;
  tabId?: string;
}

interface DocsLocation {
  index: number;
  tabId?: string;
}

// The function returns an array of these
export type DocsRequest = Record<string, unknown>;
```

Main export:

```typescript
import MarkdownIt from 'markdown-it';

export interface ConvertOptions {
  startIndex?: number;   // default: 1
  tabId?: string;
  firstHeadingAsTitle?: boolean;
}

/**
 * Convert markdown to an array of Google Docs batchUpdate requests.
 * Requests are ordered: inserts first, then formatting.
 * The caller is responsible for executing them via the batchUpdate API.
 */
export function convertMarkdownToRequests(
  markdown: string,
  options?: ConvertOptions,
): DocsRequest[];
```

Port the full conversion logic from the reference, preserving:
- Token processing via `markdown-it`
- ConversionContext for index tracking, formatting stack, list state, table state
- Code blocks as styled 1x1 tables (`CELL_CONTENT_OFFSET = 4`, `EMPTY_1x1_TABLE_SIZE = 6`)
- Two-phase output: insert requests then format requests
- Heading styles, text formatting, list bullets
- Table rendering with complex cell index math
- Bottom-to-top list formatting to avoid index corruption
- Horizontal rule as paragraph with bottom border

**Step 2: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`

**Step 3: Commit**

```bash
git add packages/plugin-google-docs/src/actions/markdown-to-docs.ts
git commit -m "feat(google-docs): port markdown-to-docs converter"
```

---

### Task 6: Section Resolution Helpers

**Files:**
- Create: `packages/plugin-google-docs/src/actions/sections.ts`

**Step 1: Write section helpers**

These helpers scan document structure for headings and resolve sections for read/replace/insert/delete operations.

```typescript
import type { DocsBody } from './docs-to-markdown.js';

export interface Section {
  heading: string;
  level: number;           // 1-6
  startIndex: number;      // start of heading paragraph
  endIndex: number;        // end of section (start of next same-or-higher-level heading, or doc end)
}

/** Extract all sections from a document body. */
export function extractSections(body: DocsBody): Section[];

/** Find a section by heading text (case-insensitive substring match). */
export function findSection(body: DocsBody, headingText: string): Section | null;

/** Get the end index of the document body (last element's endIndex). */
export function getBodyEndIndex(body: DocsBody): number;
```

Implementation:
- Walk `body.content` structural elements
- For each paragraph with `namedStyleType` matching `HEADING_*` or `TITLE`, record heading text, level, and startIndex
- Section endIndex = next heading of equal or higher level's startIndex, or document end
- `findSection` does case-insensitive substring match on heading text

**Step 2: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`

**Step 3: Commit**

```bash
git add packages/plugin-google-docs/src/actions/sections.ts
git commit -m "feat(google-docs): add section resolution helpers"
```

---

### Task 7: Batch Update Executor

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/api.ts`

**Step 1: Add batch update function**

Add a `executeBatchUpdate` function to `api.ts` that handles the three-phase execution strategy (delete → insert → format) with request splitting at 50 per batch. Adapted from `executeBatchUpdateWithSplitting` in the reference.

```typescript
import type { DocsRequest } from './markdown-to-docs.js';

const MAX_BATCH_SIZE = 50;

const DELETE_TYPES = new Set(['deleteContentRange']);
const INSERT_TYPES = new Set(['insertText', 'insertTable', 'insertPageBreak', 'insertInlineImage', 'insertSectionBreak']);
// Everything else is a format request

/**
 * Execute batchUpdate requests in three phases: delete → insert → format.
 * Splits large batches into chunks of 50 requests max.
 */
export async function executeBatchUpdate(
  documentId: string,
  token: string,
  requests: DocsRequest[],
): Promise<{ success: boolean; error?: string }>;
```

Implementation:
- Categorize requests into delete/insert/format arrays
- Execute each phase sequentially, splitting into chunks of MAX_BATCH_SIZE
- Each chunk → `POST /documents/{id}:batchUpdate` with `{ requests: chunk }`
- Return `{ success: false, error }` on any failure

**Step 2: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`

**Step 3: Commit**

```bash
git add packages/plugin-google-docs/src/actions/api.ts
git commit -m "feat(google-docs): add three-phase batch update executor"
```

---

### Task 8: Action Definitions and Executor

**Files:**
- Create: `packages/plugin-google-docs/src/actions/actions.ts`

**Step 1: Write action definitions**

Define all 10 actions with Zod schemas, following the pattern in `plugin-google-drive/src/actions/actions.ts`.

```typescript
import { z } from 'zod';
import type { ActionDefinition, ActionSource, ActionContext, ActionResult } from '@valet/sdk';
import { docsFetch, driveFetch, apiError, executeBatchUpdate } from './api.js';
import { docsToMarkdown } from './docs-to-markdown.js';
import { convertMarkdownToRequests } from './markdown-to-docs.js';
import { extractSections, findSection, getBodyEndIndex } from './sections.js';

const DOCS_MIME = 'application/vnd.google-apps.document';

// ─── Action Definitions ──────────────────────────────────────────────────

const searchDocuments: ActionDefinition = {
  id: 'docs.search_documents',
  name: 'Search Documents',
  description: 'Search for Google Docs by name or content via Drive API',
  riskLevel: 'low',
  params: z.object({
    query: z.string().describe('Search text (matches document names and content)'),
    maxResults: z.number().int().min(1).max(50).optional().default(20),
  }),
};

const getDocument: ActionDefinition = {
  id: 'docs.get_document',
  name: 'Get Document',
  description: 'Get document metadata (title, last modified, tabs)',
  riskLevel: 'low',
  params: z.object({
    documentId: z.string().describe('Google Docs document ID'),
  }),
};

const readDocument: ActionDefinition = {
  id: 'docs.read_document',
  name: 'Read Document',
  description: 'Read entire document content as markdown',
  riskLevel: 'low',
  params: z.object({
    documentId: z.string(),
    tabId: z.string().optional().describe('Specific tab ID (for multi-tab docs)'),
  }),
};

const readSection: ActionDefinition = {
  id: 'docs.read_section',
  name: 'Read Section',
  description: 'Read a specific section by heading text. Returns markdown for everything under that heading until the next heading of equal or higher level.',
  riskLevel: 'low',
  params: z.object({
    documentId: z.string(),
    heading: z.string().describe('Heading text to find (case-insensitive substring match)'),
  }),
};

const createDocument: ActionDefinition = {
  id: 'docs.create_document',
  name: 'Create Document',
  description: 'Create a new Google Doc from markdown content',
  riskLevel: 'medium',
  params: z.object({
    title: z.string(),
    markdown: z.string().describe('Markdown content for the document body'),
    folderId: z.string().optional().describe('Google Drive folder ID to create in'),
  }),
};

const replaceDocument: ActionDefinition = {
  id: 'docs.replace_document',
  name: 'Replace Document',
  description: 'Replace entire document content with new markdown. Preserves the document title.',
  riskLevel: 'high',
  params: z.object({
    documentId: z.string(),
    markdown: z.string().describe('New markdown content to replace the entire document body'),
  }),
};

const appendContent: ActionDefinition = {
  id: 'docs.append_content',
  name: 'Append Content',
  description: 'Append markdown content to the end of a document',
  riskLevel: 'medium',
  params: z.object({
    documentId: z.string(),
    markdown: z.string().describe('Markdown content to append'),
  }),
};

const replaceSection: ActionDefinition = {
  id: 'docs.replace_section',
  name: 'Replace Section',
  description: 'Replace a specific section (identified by heading) with new markdown content',
  riskLevel: 'medium',
  params: z.object({
    documentId: z.string(),
    heading: z.string().describe('Heading text of the section to replace'),
    markdown: z.string().describe('New markdown content for this section (include the heading)'),
  }),
};

const insertSection: ActionDefinition = {
  id: 'docs.insert_section',
  name: 'Insert Section',
  description: 'Insert new markdown content before or after a named heading',
  riskLevel: 'medium',
  params: z.object({
    documentId: z.string(),
    heading: z.string().describe('Heading text to insert relative to'),
    position: z.enum(['before', 'after']).describe('Insert before or after the named section'),
    markdown: z.string().describe('Markdown content to insert'),
  }),
};

const deleteSection: ActionDefinition = {
  id: 'docs.delete_section',
  name: 'Delete Section',
  description: 'Delete a section by heading text (removes heading and all content until next same-level heading)',
  riskLevel: 'high',
  params: z.object({
    documentId: z.string(),
    heading: z.string().describe('Heading text of the section to delete'),
  }),
};
```

**Step 2: Write executor**

Single `executeAction` function with switch on `actionId`. Key implementation notes per action:

- **`docs.search_documents`**: `GET /files?q=fullText contains '{query}' and mimeType='application/vnd.google-apps.document'&fields=files(id,name,modifiedTime,webViewLink)&pageSize={maxResults}` via `driveFetch`
- **`docs.get_document`**: `GET /documents/{id}?fields=documentId,title,revisionId,body.content` via `docsFetch`, return metadata
- **`docs.read_document`**: `GET /documents/{id}` via `docsFetch`, pass body to `docsToMarkdown()`
- **`docs.read_section`**: Same as read_document, then `findSection()` + extract section markdown
- **`docs.create_document`**: `POST /documents` with `{ title }` via `docsFetch`, then if markdown provided, `convertMarkdownToRequests()` + `executeBatchUpdate()`. If `folderId`, also `PATCH /files/{id}?addParents={folderId}` via `driveFetch`
- **`docs.replace_document`**: `GET /documents/{id}` to get body end index, `deleteContentRange` from index 1 to end, then `convertMarkdownToRequests()` + `executeBatchUpdate()`
- **`docs.append_content`**: `GET /documents/{id}` to get body end index, `convertMarkdownToRequests(markdown, { startIndex: endIndex - 1 })` + `executeBatchUpdate()`
- **`docs.replace_section`**: `findSection()` to get range, delete range, insert new markdown at section start
- **`docs.insert_section`**: `findSection()`, insert at section start (before) or section end (after)
- **`docs.delete_section`**: `findSection()`, `deleteContentRange` for section range

Export:

```typescript
const allActions = [searchDocuments, getDocument, readDocument, readSection, createDocument, replaceDocument, appendContent, replaceSection, insertSection, deleteSection];

export const googleDocsActions: ActionSource = {
  listActions: () => allActions,
  execute: executeAction,
};
```

**Step 3: Typecheck**

Run: `cd packages/plugin-google-docs && pnpm typecheck`

**Step 4: Commit**

```bash
git add packages/plugin-google-docs/src/actions/actions.ts
git commit -m "feat(google-docs): add action definitions and executor"
```

---

### Task 9: Wire Up Index and Generate Registries

**Files:**
- Modify: `packages/plugin-google-docs/src/actions/index.ts`

**Step 1: Complete the index.ts**

Replace the stub with real exports:

```typescript
import type { IntegrationPackage } from '@valet/sdk';
import { googleDocsProvider } from './provider.js';
import { googleDocsActions } from './actions.js';

export { googleDocsProvider } from './provider.js';
export { googleDocsActions } from './actions.js';
export { docsFetch, driveFetch } from './api.js';

const googleDocsPackage: IntegrationPackage = {
  name: '@valet/actions-google-docs',
  version: '0.0.1',
  service: 'google_docs',
  provider: googleDocsProvider,
  actions: googleDocsActions,
};

export default googleDocsPackage;
```

**Step 2: Generate registries**

Run: `make generate-registries`
Expected: Output includes `google-docs` in the integration count

**Step 3: Typecheck everything**

Run: `pnpm typecheck`
Expected: all packages pass

**Step 4: Commit**

```bash
git add packages/plugin-google-docs/src/actions/index.ts packages/worker/src/integrations/packages.ts packages/worker/src/plugins/content-registry.ts
git commit -m "feat(google-docs): wire up plugin and generate registries"
```

---

### Task 10: Converter Tests

**Files:**
- Create: `packages/plugin-google-docs/src/actions/docs-to-markdown.test.ts`
- Create: `packages/plugin-google-docs/src/actions/markdown-to-docs.test.ts`
- Create: `packages/plugin-google-docs/src/actions/sections.test.ts`

**Step 1: Write docs-to-markdown tests**

Test cases:
- Simple paragraph → plain text
- Heading paragraph (HEADING_1, HEADING_2, TITLE) → `#`, `##`, `#`
- Bold/italic text runs → `**bold**`, `_italic_`
- Link text run → `[text](url)`
- Unordered list → `- item`
- Ordered list → `1. item`
- Nested list → indented items
- Simple table → GFM pipe table
- 1x1 styled table with monospace → fenced code block
- Section break → `---`
- Empty document → empty string

**Step 2: Write markdown-to-docs tests**

Test cases:
- Simple text → insertText request at index 1
- `# Heading` → insertText + updateParagraphStyle with HEADING_1
- `**bold**` → insertText + updateTextStyle with bold
- `- item` → insertText + createParagraphBullets
- Fenced code block → insertTable (1x1) + insertText + styling requests
- `---` → insertText with border styling
- Multiple elements → correct index tracking (offsets)

**Step 3: Write section tests**

Test cases:
- Extract sections from doc with multiple headings
- findSection with exact match
- findSection with case-insensitive substring
- findSection with no match → null
- Section endIndex stops at next same-level heading
- Section endIndex goes to doc end for last section

**Step 4: Run tests**

Run: `cd packages/plugin-google-docs && pnpm test`
Expected: all pass

**Step 5: Commit**

```bash
git add packages/plugin-google-docs/src/actions/*.test.ts
git commit -m "test(google-docs): add converter and section tests"
```

---

### Task 11: Full Typecheck, Registry Regeneration, and Deploy

**Step 1: Final typecheck**

Run: `pnpm typecheck`
Expected: all packages pass

**Step 2: Regenerate registries**

Run: `make generate-registries`

**Step 3: Deploy**

Run: `make deploy`
Expected: deploy succeeds, worker includes google-docs integration

**Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "feat(google-docs): finalize plugin for deployment"
```

---

## Implementation Notes

### Porting the Converter

The two converter files are the core of this plugin. When porting:

1. **`docsToMarkdown.ts`** (simpler, ~310 lines) — This is mostly self-contained. Define minimal types for the Google Docs JSON structure at the top of the file. The conversion logic maps structural elements to markdown strings.

2. **`markdownToDocs.ts`** (complex, ~1,069 lines) — This uses `markdown-it` for parsing and builds raw request objects. Replace `docs_v1.Schema$Request` with plain `Record<string, unknown>` (or a minimal union type). The index math and formatting logic ports directly.

3. **Request format** — The reference uses `googleapis` SDK types, but the actual request bodies are just JSON. For example:
   ```typescript
   // Reference (googleapis SDK):
   { insertText: { location: { index: 1 }, text: 'Hello' } }
   // Our code (raw fetch):
   { insertText: { location: { index: 1 }, text: 'Hello' } }
   ```
   They're identical — the SDK just adds type checking. Our raw `fetch()` sends the same JSON.

### Reference Files

- Reference converter: `/tmp/google-docs-mcp/src/markdown-transformer/`
- Reference batch update: `/tmp/google-docs-mcp/src/googleDocsApiHelpers.ts`
- Existing plugin pattern: `packages/plugin-google-drive/src/actions/`
- SDK contracts: `packages/sdk/src/integrations/index.ts`
