# Google Workspace Docs Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 15 docs actions with 25 ported from the google-docs-mcp reference repo, including shared helpers and markdown transformer.
**Architecture:** The section-based editing model is dropped in favor of index-based primitives ported from the reference repo. A new `docs-helpers.ts` provides batch update, text finding, style building, and tab management functions using raw `fetch()`. A new `docs-markdown.ts` provides bidirectional markdown conversion. All 25 actions are implemented in `docs-actions.ts` as cases in an `executeDocsAction` switch.
**Tech Stack:** TypeScript, Cloudflare Workers, Google REST APIs, Zod, Vitest

---

## Task 1: Port docs helpers (`docs-helpers.ts`)

**Read first:**
- `/tmp/google-docs-mcp/src/googleDocsApiHelpers.ts` (full file, 1178 lines)
- `/tmp/google-docs-mcp/src/types.ts` (for `TextStyleArgs`, `ParagraphStyleArgs`, `hexToRgbColor`)

**Create:** `packages/plugin-google-workspace/src/actions/docs-helpers.ts`
**Delete:** `packages/plugin-google-workspace/src/actions/docs-api.ts`

### Functions to port

Each function takes `token: string` as first param instead of `docs: Docs`. Translate `docs.documents.batchUpdate(...)` to `fetch()` and `docs.documents.get(...)` to `fetch()`.

| Function | Reference Method | REST Translation |
|----------|-----------------|------------------|
| `executeBatchUpdate(token, documentId, requests)` | `docs.documents.batchUpdate({ documentId, requestBody: { requests } })` | `POST https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate` body: `{ requests }` |
| `executeBatchUpdateWithSplitting(token, documentId, requests)` | Same as above but splits into delete/insert/format phases, max 50 per batch | Same endpoint, called multiple times |
| `findTextRange(token, documentId, textToFind, instance?, tabId?)` | `docs.documents.get({ documentId, includeTabsContent, fields })` | `GET https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=${...}&fields=${...}` |
| `buildUpdateTextStyleRequest(startIndex, endIndex, style, tabId?)` | Pure function, no API call | No translation needed -- port as-is |
| `buildUpdateParagraphStyleRequest(startIndex, endIndex, style, tabId?)` | Pure function, no API call | No translation needed -- port as-is |
| `getAllTabs(doc)` | Pure function | Port as-is |
| `findTabById(doc, tabId)` | Pure function | Port as-is |
| `getTabTextLength(documentTab)` | Pure function | Port as-is |
| `insertText(token, documentId, text, index)` | Calls `executeBatchUpdate` | Delegates to ported `executeBatchUpdate` |
| `createTable(token, documentId, rows, columns, index, tabId?)` | Calls `executeBatchUpdate` | Delegates to ported `executeBatchUpdate` |
| `insertInlineImage(token, documentId, imageUrl, index, width?, height?, tabId?)` | Calls `executeBatchUpdate` | Delegates to ported `executeBatchUpdate` |
| `getTableCellRange(token, documentId, tableStartIndex, rowIndex, columnIndex, tabId?)` | `docs.documents.get(...)` | `GET https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=${...}` |
| `hexToRgbColor(hex)` | Pure function from `types.ts` | Port as-is |

Also port from `docs-api.ts`:
| Function | Purpose |
|----------|---------|
| `normalizeDocumentId(input)` | Extracts document ID from URL or returns bare ID |

### Translation details for `executeBatchUpdate`

```
Reference:
  const response = await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });
  return response.data;

Valet:
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    },
  );
  if (!res.ok) { ... handle 400/403/404 errors ... }
  return await res.json();
```

### Translation details for `documents.get`

```
Reference:
  const res = await docs.documents.get({
    documentId,
    includeTabsContent: true,
    fields: 'tabs(...)',
  });

Valet:
  const qs = new URLSearchParams({ includeTabsContent: 'true', fields: '...' });
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
```

### Error translation

Reference `UserError` throws become `return { success: false, error: message }` in the calling action code. In the helper, throw plain `Error` objects and let the action catch them.

### Types

Port `TextStyleArgs` and `ParagraphStyleArgs` as TypeScript interfaces in this file (not Zod -- these are internal helper types). The Zod schemas for the action params live in `docs-actions.ts`.

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port docs helpers from reference repo

Port executeBatchUpdate, executeBatchUpdateWithSplitting, findTextRange,
buildUpdateTextStyleRequest, buildUpdateParagraphStyleRequest, getAllTabs,
findTabById, getTabTextLength, insertText, createTable, insertInlineImage,
getTableCellRange, and hexToRgbColor from google-docs-mcp reference repo.
Translates googleapis client calls to raw fetch() with Bearer token auth.
```

---

## Task 2: Port markdown transformer (`docs-markdown.ts`)

**Read first:**
- `/tmp/google-docs-mcp/src/markdown-transformer/docsToMarkdown.ts`
- `/tmp/google-docs-mcp/src/markdown-transformer/markdownToDocs.ts`
- `/tmp/google-docs-mcp/src/markdown-transformer/index.ts`

**Create:** `packages/plugin-google-workspace/src/actions/docs-markdown.ts`
**Delete:**
- `packages/plugin-google-workspace/src/actions/docs-to-markdown.ts`
- `packages/plugin-google-workspace/src/actions/markdown-to-docs.ts`

### Functions to port

| Function | Source | Purpose |
|----------|--------|---------|
| `docsJsonToMarkdown(doc)` | `docsToMarkdown.ts` | Convert fetched Docs JSON to markdown string |
| `convertMarkdownToRequests(markdown, startIndex, tabId?, options?)` | `markdownToDocs.ts` | Parse markdown and generate Docs API batch requests |
| `insertMarkdown(token, documentId, markdown, options?)` | `index.ts` | High-level: convert markdown + execute via `executeBatchUpdateWithSplitting` |

### Translation for `insertMarkdown`

The reference version takes `docs: Docs` and calls `executeBatchUpdateWithSplitting(docs, ...)`. The ported version takes `token: string` and calls the ported `executeBatchUpdateWithSplitting(token, ...)` from `docs-helpers.ts`.

### Dependencies

- `markdown-it` -- already in `package.json`
- `docs-helpers.ts` -- for `executeBatchUpdateWithSplitting`

### Notes

- `docsJsonToMarkdown` is a pure function (no API calls). Port directly.
- `convertMarkdownToRequests` is a pure function that returns `docs_v1.Schema$Request[]`. Port the logic, but use plain object types instead of `docs_v1` types. Define a local `type DocsRequest = Record<string, unknown>` or similar.
- `insertMarkdown` combines parse + execute. It returns `InsertMarkdownResult` metadata. Port this return type.
- The `ConversionOptions` type includes `firstHeadingAsTitle: boolean`. Port it.

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port markdown transformer from reference repo

Port docsJsonToMarkdown, convertMarkdownToRequests, and insertMarkdown
from google-docs-mcp markdown-transformer. Replaces docs-to-markdown.ts
and markdown-to-docs.ts with the reference repo's more complete
implementation supporting headings, lists, tables, images, and styling.
```

---

## Task 3: Port docs actions -- core read/write (8 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/docs/readGoogleDoc.ts`
- `/tmp/google-docs-mcp/src/tools/docs/insertText.ts`
- `/tmp/google-docs-mcp/src/tools/docs/appendToGoogleDoc.ts`
- `/tmp/google-docs-mcp/src/tools/docs/modifyText.ts`
- `/tmp/google-docs-mcp/src/tools/docs/deleteRange.ts`
- `/tmp/google-docs-mcp/src/tools/docs/findAndReplace.ts`
- `/tmp/google-docs-mcp/src/tools/utils/appendMarkdownToGoogleDoc.ts`
- `/tmp/google-docs-mcp/src/tools/utils/replaceDocumentWithMarkdown.ts`

**Replace:** `packages/plugin-google-workspace/src/actions/docs-actions.ts` (start fresh, keeping the same export shape)

### Action definitions

**1. `docs.read_document`** -- riskLevel: `low`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  format: z.enum(['text', 'json', 'markdown']).optional().describe('Output format (default: text)'),
  maxLength: z.number().optional().describe('Max character limit for output'),
  tabId: z.string().optional().describe('Specific tab ID to read'),
})
```
- REST: `GET https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=${!!tabId}&fields=${fields}`
- Fields depend on format: `*` for json/markdown, `body(content(paragraph(elements(textRun(content)))))` for text
- For `format=markdown`, call `docsJsonToMarkdown()` from `docs-markdown.ts`
- For `format=json`, return raw document JSON
- For `format=text`, extract text from paragraphs and tables

**2. `docs.insert_text`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  text: z.string().min(1).describe('Text to insert'),
  index: z.number().int().min(1).describe('1-based character index'),
  tabId: z.string().optional().describe('Tab ID'),
})
```
- REST: `POST https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate` with `insertText` request
- Uses `insertText()` helper from `docs-helpers.ts` (with tabId support)

**3. `docs.append_text`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  text: z.string().min(1).describe('Text to append'),
  tabId: z.string().optional().describe('Tab ID'),
})
```
- REST: `GET` document to find end index, then `POST` batchUpdate with `insertText` at end index
- Auto-prepends newline if document doesn't end with one

**4. `docs.modify_text`** -- riskLevel: `high`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  target: z.union([
    z.object({ startIndex: z.number().int().min(1), endIndex: z.number().int().min(1) }),
    z.object({ textToFind: z.string().min(1), matchInstance: z.number().int().min(1).optional() }),
    z.object({ insertionIndex: z.number().int().min(1) }),
  ]).describe('Target by range, text search, or insertion index'),
  text: z.string().optional().describe('New text to insert or replace with'),
  style: z.object({ /* TextStyleArgs fields */ }).optional().describe('Text formatting'),
  tabId: z.string().optional(),
})
```
- Combines delete + insert + format in one batch
- Uses `findTextRange()` from `docs-helpers.ts` to resolve text targets
- Uses `buildUpdateTextStyleRequest()` for formatting
- REST: `POST https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`

**5. `docs.delete_range`** -- riskLevel: `high`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  startIndex: z.number().int().min(1).describe('Start of range (inclusive)'),
  endIndex: z.number().int().min(1).describe('End of range (exclusive)'),
  tabId: z.string().optional(),
})
```
- REST: batchUpdate with `deleteContentRange` request

**6. `docs.find_and_replace`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  findText: z.string().min(1).describe('Text to search for'),
  replaceText: z.string().describe('Replacement text (empty to delete)'),
  matchCase: z.boolean().optional().describe('Case-sensitive (default: false)'),
  tabId: z.string().optional().describe('Scope to a specific tab'),
})
```
- REST: batchUpdate with `replaceAllText` request
- Uses `tabsCriteria: { tabIds: [tabId] }` when tabId is provided

**7. `docs.append_markdown`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  markdown: z.string().min(1).describe('Markdown content to append'),
  tabId: z.string().optional(),
})
```
- Get document to find end index
- Call `insertMarkdown(token, documentId, markdown, { startIndex: endIndex, tabId })` from `docs-markdown.ts`

**8. `docs.replace_document_with_markdown`** -- riskLevel: `high`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  markdown: z.string().min(1).max(500000).describe('Markdown content'),
  tabId: z.string().optional(),
  firstHeadingAsTitle: z.boolean().optional().describe('First H1 as TITLE style (default: true)'),
})
```
- Delete existing content (index 1 to endIndex-1)
- Clean surviving paragraph (strip bullets + text style)
- Call `insertMarkdown(token, documentId, markdown, { startIndex: 1, tabId, firstHeadingAsTitle })`
- REST: multiple batchUpdate calls via `executeBatchUpdateWithSplitting`

### Files to delete after this task
- `packages/plugin-google-workspace/src/actions/sections.ts`
- `packages/plugin-google-workspace/src/actions/operations.ts`

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port core docs read/write actions (8 of 25)

Port read_document (with format param), insert_text, append_text,
modify_text, delete_range, find_and_replace, append_markdown, and
replace_document_with_markdown from google-docs-mcp reference repo.
Drop section-based editing model (sections.ts, operations.ts).
```

---

## Task 4: Port docs actions -- content insertion (5 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/docs/insertTable.ts`
- `/tmp/google-docs-mcp/src/tools/docs/insertTableWithData.ts`
- `/tmp/google-docs-mcp/src/tools/docs/insertImage.ts`
- `/tmp/google-docs-mcp/src/tools/docs/insertPageBreak.ts`
- `/tmp/google-docs-mcp/src/tools/docs/insertSectionBreak.ts`

**Add to:** `packages/plugin-google-workspace/src/actions/docs-actions.ts`

### Action definitions

**9. `docs.insert_table`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  rows: z.number().int().min(1).describe('Number of rows'),
  columns: z.number().int().min(1).describe('Number of columns'),
  index: z.number().int().min(1).describe('1-based insertion index'),
  tabId: z.string().optional(),
})
```
- REST: batchUpdate with `insertTable` request
- Uses `createTable()` from `docs-helpers.ts`

**10. `docs.insert_table_with_data`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  data: z.array(z.array(z.string())).min(1).describe('2D array of cell values'),
  index: z.number().int().min(1).describe('1-based insertion index'),
  hasHeaderRow: z.boolean().optional().describe('Bold the first row (default: false)'),
  tabId: z.string().optional(),
})
```
- Port `buildInsertTableWithDataRequests()` from reference (uses table index math to compute cell positions)
- REST: batchUpdate with insertTable + insertText for each cell + optional formatting for header row
- Cell index formula: `cellContentIndex = T + 4 + r * (1 + 2*C) + 2*c`

**11. `docs.insert_image`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  uri: z.string().url().describe('Publicly accessible image URL'),
  index: z.number().int().min(1).describe('1-based insertion index'),
  width: z.number().min(1).optional().describe('Width in points'),
  height: z.number().min(1).optional().describe('Height in points'),
  tabId: z.string().optional(),
})
```
- REST: batchUpdate with `insertInlineImage` request
- Uses `insertInlineImage()` from `docs-helpers.ts`
- Note: Only URL-based insertion. Drop `localImagePath` (no filesystem in Workers) and Apps Script path.

**12. `docs.insert_page_break`** -- riskLevel: `low`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  index: z.number().int().min(1).describe('1-based insertion index'),
  tabId: z.string().optional(),
})
```
- REST: batchUpdate with `insertPageBreak` request

**13. `docs.insert_section_break`** -- riskLevel: `low`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  index: z.number().int().min(1).describe('1-based insertion index'),
  sectionType: z.enum(['NEXT_PAGE', 'CONTINUOUS']).optional().describe('Break type (default: NEXT_PAGE)'),
  tabId: z.string().optional(),
})
```
- REST: batchUpdate with `insertSectionBreak` request

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port content insertion docs actions (5 of 25)

Port insert_table, insert_table_with_data, insert_image,
insert_page_break, and insert_section_break from reference repo.
```

---

## Task 5: Port docs actions -- tabs (3 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/docs/addTab.ts`
- `/tmp/google-docs-mcp/src/tools/docs/listDocumentTabs.ts`
- `/tmp/google-docs-mcp/src/tools/docs/renameTab.ts`

**Add to:** `packages/plugin-google-workspace/src/actions/docs-actions.ts`

### Action definitions

**14. `docs.add_tab`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  title: z.string().optional().describe('Tab title'),
})
```
- REST: `POST https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate` with `createTab` request (body: `{ requests: [{ createTab: { tab: { tabProperties: { title } } } }] }`)
- Return new tab ID and properties

**15. `docs.list_tabs`** -- riskLevel: `low`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
})
```
- REST: `GET https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true&fields=title,tabs(tabProperties,childTabs)`
- Uses `getAllTabs()` and `getTabTextLength()` from `docs-helpers.ts`
- Returns array of `{ tabId, title, level, characterCount }`

**16. `docs.rename_tab`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  tabId: z.string().describe('Tab ID to rename'),
  title: z.string().describe('New tab title'),
})
```
- REST: batchUpdate with `updateTab` request (body: `{ requests: [{ updateTab: { tab: { tabProperties: { tabId, title } }, fields: 'title' } }] }`)

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port tab management docs actions (3 of 25)

Port add_tab, list_tabs, and rename_tab from reference repo.
```

---

## Task 6: Port docs actions -- formatting (3 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/docs/formatting/applyTextStyle.ts`
- `/tmp/google-docs-mcp/src/tools/docs/formatting/applyParagraphStyle.ts`
- `/tmp/google-docs-mcp/src/tools/docs/updateSectionStyle.ts`
- `/tmp/google-docs-mcp/src/types.ts` (for `TextStyleParameters`, `ParagraphStyleParameters`)

**Add to:** `packages/plugin-google-workspace/src/actions/docs-actions.ts`

### Action definitions

**17. `docs.apply_text_style`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  target: z.union([
    z.object({ startIndex: z.number().int().min(1), endIndex: z.number().int().min(1) }),
    z.object({ textToFind: z.string().min(1), matchInstance: z.number().int().min(1).optional() }),
  ]).describe('Target by range or text search'),
  style: z.object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    fontSize: z.number().min(1).optional(),
    fontFamily: z.string().optional(),
    foregroundColor: z.string().optional().describe('Hex color, e.g. #FF0000'),
    backgroundColor: z.string().optional().describe('Hex color, e.g. #FFFF00'),
    linkUrl: z.string().url().optional(),
  }).describe('Text style properties'),
  tabId: z.string().optional(),
})
```
- Resolve target (range or text search via `findTextRange()`)
- Build request via `buildUpdateTextStyleRequest()` from `docs-helpers.ts`
- REST: batchUpdate

**18. `docs.apply_paragraph_style`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  startIndex: z.number().int().min(1).describe('Start of range (inclusive)'),
  endIndex: z.number().int().min(1).describe('End of range (exclusive)'),
  style: z.object({
    alignment: z.enum(['START', 'END', 'CENTER', 'JUSTIFIED']).optional(),
    indentStart: z.number().min(0).optional().describe('Left indent in points'),
    indentEnd: z.number().min(0).optional().describe('Right indent in points'),
    spaceAbove: z.number().min(0).optional().describe('Space above in points'),
    spaceBelow: z.number().min(0).optional().describe('Space below in points'),
    namedStyleType: z.enum(['NORMAL_TEXT', 'TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6']).optional(),
    keepWithNext: z.boolean().optional(),
  }).describe('Paragraph style properties'),
  tabId: z.string().optional(),
})
```
- Build request via `buildUpdateParagraphStyleRequest()` from `docs-helpers.ts`
- REST: batchUpdate

**19. `docs.update_section_style`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  startIndex: z.number().int().min(0).describe('Start of section range'),
  endIndex: z.number().int().min(1).describe('End of section range'),
  style: z.object({
    flipPageOrientation: z.boolean().optional(),
    sectionType: z.enum(['SECTION_TYPE_UNSPECIFIED', 'CONTINUOUS', 'NEXT_PAGE']).optional(),
    marginTop: z.number().min(0).optional().describe('Top margin in points'),
    marginBottom: z.number().min(0).optional().describe('Bottom margin in points'),
    marginLeft: z.number().min(0).optional().describe('Left margin in points'),
    marginRight: z.number().min(0).optional().describe('Right margin in points'),
    pageNumberStart: z.number().int().optional(),
  }).describe('Section style properties'),
  tabId: z.string().optional(),
})
```
- Build request via `buildUpdateSectionStyleRequest()` (port from reference `updateSectionStyle.ts`)
- REST: batchUpdate with `updateSectionStyle` request

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port formatting docs actions (3 of 25)

Port apply_text_style, apply_paragraph_style, and update_section_style
from reference repo formatting tools.
```

---

## Task 7: Port docs actions -- comments (6 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/docs/comments/addComment.ts`
- `/tmp/google-docs-mcp/src/tools/docs/comments/listComments.ts`
- `/tmp/google-docs-mcp/src/tools/docs/comments/getComment.ts`
- `/tmp/google-docs-mcp/src/tools/docs/comments/replyToComment.ts`
- `/tmp/google-docs-mcp/src/tools/docs/comments/resolveComment.ts`
- `/tmp/google-docs-mcp/src/tools/docs/comments/deleteComment.ts`

**Add to:** `packages/plugin-google-workspace/src/actions/docs-actions.ts`

**Important:** Comments use the **Drive API v3** comments endpoint, not the Docs API.
- Base URL: `https://www.googleapis.com/drive/v3/files/${documentId}/comments`
- Replies URL: `https://www.googleapis.com/drive/v3/files/${documentId}/comments/${commentId}/replies`

### Action definitions

**20. `docs.add_comment`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  content: z.string().min(1).describe('Comment text'),
  startIndex: z.number().int().min(1).optional().describe('Start of anchor range (1-based)'),
  endIndex: z.number().int().min(1).optional().describe('End of anchor range (1-based, exclusive)'),
})
```
- If startIndex/endIndex provided: read document to extract quoted text, then create anchored comment
- REST: `POST https://www.googleapis.com/drive/v3/files/${documentId}/comments?fields=id,content,quotedFileContent,author,createdTime,resolved`
- Body includes `anchor` JSON for anchored comments (uses Drive API 0-based indexing: `startIndex - 1`)

**21. `docs.list_comments`** -- riskLevel: `low`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  includeResolved: z.boolean().optional().describe('Include resolved comments (default: false)'),
})
```
- REST: `GET https://www.googleapis.com/drive/v3/files/${documentId}/comments?fields=comments(id,content,quotedFileContent,author,createdTime,resolved)&pageSize=100`
- Paginate up to 10 pages

**22. `docs.get_comment`** -- riskLevel: `low`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  commentId: z.string().describe('Comment ID'),
})
```
- REST: `GET https://www.googleapis.com/drive/v3/files/${documentId}/comments/${commentId}?fields=id,content,quotedFileContent,author,createdTime,resolved,replies(id,content,author,createdTime)`

**23. `docs.reply_to_comment`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  commentId: z.string().describe('Comment ID'),
  content: z.string().min(1).describe('Reply text'),
})
```
- REST: `POST https://www.googleapis.com/drive/v3/files/${documentId}/comments/${commentId}/replies?fields=id,content,author,createdTime`

**24. `docs.delete_comment`** -- riskLevel: `high`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  commentId: z.string().describe('Comment ID'),
})
```
- REST: `DELETE https://www.googleapis.com/drive/v3/files/${documentId}/comments/${commentId}`

**25. `docs.resolve_comment`** -- riskLevel: `medium`
```typescript
params: z.object({
  documentId: z.string().describe('Google Docs document ID or full URL'),
  commentId: z.string().describe('Comment ID'),
})
```
- First GET the comment to retrieve current content
- REST: `PATCH https://www.googleapis.com/drive/v3/files/${documentId}/comments/${commentId}?fields=id,resolved` with body `{ content: currentContent, resolved: true }`

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port comment docs actions (6 of 25)

Port add_comment (with anchor support), list_comments, get_comment,
reply_to_comment, delete_comment, and resolve_comment. Comments use
Drive API v3 comments endpoint, not Docs API.
```

---

## Task 8: Update labels guard + aggregator + skill

**Modify:** `packages/plugin-google-workspace/src/actions/labels-guard.ts`

### Replace classification arrays

```typescript
export const LIST_SEARCH_ACTIONS: string[] = [
  'drive.list_files',
  'drive.search_files',
  'drive.list_documents',
  'drive.search_documents',
  'drive.list_folder_contents',
  'docs.list_tabs',
  'sheets.list_spreadsheets',
  'sheets.list_tables',
  'sheets.get_conditional_formatting',
];

export const READ_GET_ACTIONS: string[] = [
  'drive.get_document_info',
  'drive.get_folder_info',
  'drive.download_file',
  'docs.read_document',
  'docs.list_comments',
  'docs.get_comment',
  'sheets.read_spreadsheet',
  'sheets.get_spreadsheet_info',
  'sheets.read_cell_format',
  'sheets.get_table',
];

export const WRITE_MODIFY_ACTIONS: string[] = [
  // Drive
  'drive.copy_file',
  'drive.move_file',
  'drive.rename_file',
  'drive.delete_file',
  // Docs
  'docs.insert_text',
  'docs.append_text',
  'docs.modify_text',
  'docs.delete_range',
  'docs.find_and_replace',
  'docs.append_markdown',
  'docs.replace_document_with_markdown',
  'docs.insert_table',
  'docs.insert_table_with_data',
  'docs.insert_image',
  'docs.insert_page_break',
  'docs.insert_section_break',
  'docs.add_tab',
  'docs.rename_tab',
  'docs.apply_text_style',
  'docs.apply_paragraph_style',
  'docs.update_section_style',
  'docs.add_comment',
  'docs.reply_to_comment',
  'docs.delete_comment',
  'docs.resolve_comment',
  // Sheets (full list in sheets port plan)
  ...sheets write/modify actions...
];

export const CREATE_ACTIONS: string[] = [
  'drive.create_document',
  'drive.create_folder',
  'drive.create_from_template',
  'sheets.create_spreadsheet',
  'sheets.create_table',
];
```

### Update `extractFileId`

The `docs.*` actions continue to use `documentId` param. No change needed for docs.

### Update `normalizeDocumentId` import

Change import to source from `docs-helpers.ts` instead of `docs-api.ts`.

**Modify:** `packages/plugin-google-workspace/src/actions/actions.ts`
- Update import path if needed (exports should be stable)

**Modify:** `packages/plugin-google-workspace/skills/google-docs.md`
- Full rewrite for new 25-action tool set
- Document index-based editing workflow: read with `format=json` to get indices
- Document markdown workflow: read with `format=markdown`, edit, `replace_document_with_markdown`
- Document comment workflow: `list_comments` -> `get_comment` -> `reply_to_comment` / `resolve_comment`
- Document tab workflow: `list_tabs` -> use `tabId` param on other tools

### Test step
- Run `cd packages/plugin-google-workspace && pnpm test` (runs labels-guard completeness test)
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): update labels guard and skill for 25 docs actions

Update all four classification arrays in labels-guard.ts for the new
action IDs. Rewrite google-docs.md skill with index-based editing and
markdown workflows.
```

---

## Task 9: Clean up + verify

**Delete:**
- `packages/plugin-google-workspace/src/actions/docs-api.ts`
- `packages/plugin-google-workspace/src/actions/docs-to-markdown.ts`
- `packages/plugin-google-workspace/src/actions/markdown-to-docs.ts`
- `packages/plugin-google-workspace/src/actions/sections.ts`
- `packages/plugin-google-workspace/src/actions/operations.ts`

**Modify:** `packages/plugin-google-workspace/package.json`
- Remove `@toon-format/toon` from dependencies (TOON operations model dropped)
- Verify `markdown-it` and `@types/markdown-it` remain

**Verify:**
- `pnpm typecheck` from repo root passes
- `cd packages/plugin-google-workspace && pnpm test` passes (labels-guard completeness)
- No remaining imports from deleted files

### Commit
```
chore(google-workspace): remove old docs files and toon dependency

Delete docs-api.ts, docs-to-markdown.ts, markdown-to-docs.ts,
sections.ts, and operations.ts. Remove @toon-format/toon dependency.
```
