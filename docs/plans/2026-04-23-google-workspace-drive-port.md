# Google Workspace Drive Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 16 drive actions with 15 ported from the google-docs-mcp reference repo, focused on document-centric workflows with folder navigation, document creation with markdown, and file operations.
**Architecture:** All 15 actions are implemented in `drive-actions.ts` as cases in an `executeDriveAction` switch. The `drive.create_document` action combines the Docs API (create + markdown insert) and Drive API (move to folder), using `insertMarkdown` from `docs-markdown.ts`. The `drive.create_from_template` action chains a file copy with find-and-replace. A `drive-helpers.ts` file provides shared Drive fetch utilities and file type detection.
**Tech Stack:** TypeScript, Cloudflare Workers, Google REST APIs, Zod, Vitest

---

## Task 1: Port drive actions (15 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/drive/listDriveFiles.ts`
- `/tmp/google-docs-mcp/src/tools/drive/searchDriveFiles.ts`
- `/tmp/google-docs-mcp/src/tools/drive/listGoogleDocs.ts`
- `/tmp/google-docs-mcp/src/tools/drive/searchGoogleDocs.ts`
- `/tmp/google-docs-mcp/src/tools/drive/listFolderContents.ts`
- `/tmp/google-docs-mcp/src/tools/drive/getDocumentInfo.ts`
- `/tmp/google-docs-mcp/src/tools/drive/getFolderInfo.ts`
- `/tmp/google-docs-mcp/src/tools/drive/createDocument.ts`
- `/tmp/google-docs-mcp/src/tools/drive/createFolder.ts`
- `/tmp/google-docs-mcp/src/tools/drive/copyFile.ts`
- `/tmp/google-docs-mcp/src/tools/drive/moveFile.ts`
- `/tmp/google-docs-mcp/src/tools/drive/renameFile.ts`
- `/tmp/google-docs-mcp/src/tools/drive/deleteFile.ts`
- `/tmp/google-docs-mcp/src/tools/drive/downloadFile.ts`
- `/tmp/google-docs-mcp/src/tools/drive/createFromTemplate.ts`
- `/tmp/google-docs-mcp/src/driveQueryUtils.ts` (for `escapeDriveQuery`)

Also read the current file for reusable patterns:
- `packages/plugin-google-workspace/src/actions/drive-actions.ts`
- `packages/plugin-google-workspace/src/actions/drive-api.ts`

**Replace:** `packages/plugin-google-workspace/src/actions/drive-actions.ts` (start fresh, keeping the same export shape)
**Delete (later, in Task 3):** `packages/plugin-google-workspace/src/actions/drive-api.ts`

### Shared utilities

Port or retain these in `drive-actions.ts` as module-level helpers:

| Utility | Purpose |
|---------|---------|
| `escapeDriveQuery(value)` | Escape single quotes in Drive API query strings |
| `driveFetch(path, token, init?)` | `fetch('https://www.googleapis.com/drive/v3' + path, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...init })` |
| `driveError(res)` | Convert non-ok response to `{ success: false, error: '...' }` |
| `isGoogleWorkspaceMimeType(mime)` | Check if MIME type is a Google Workspace type |
| `getExportMimeType(mime)` | Map Google Workspace MIME to text export format |

### Drive API base URLs

- Files: `https://www.googleapis.com/drive/v3/files`
- Upload: `https://www.googleapis.com/upload/drive/v3/files`
- Comments: `https://www.googleapis.com/drive/v3/files/${fileId}/comments`

### Docs API base URL (for `create_document`)

- `https://docs.googleapis.com/v1/documents`

### Action definitions

**1. `drive.list_files`** -- riskLevel: `low`
```typescript
params: z.object({
  query: z.string().optional().describe('Additional Drive query filter'),
  folderId: z.string().optional().describe('Folder ID to list contents of'),
  mimeType: z.string().optional().describe('Filter by MIME type (shortcuts: "document", "spreadsheet", "folder")'),
  maxResults: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  orderBy: z.enum(['name', 'modifiedTime', 'createdTime']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
})
```
- REST: `GET https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,owners)&pageSize=${...}&supportsAllDrives=true&includeItemsFromAllDrives=true`
- MIME type shortcuts: `document` -> `application/vnd.google-apps.document`, `spreadsheet` -> `application/vnd.google-apps.spreadsheet`, `folder` -> `application/vnd.google-apps.folder`, etc.
- Inject `__labelFilter` from guard (existing pattern)

**2. `drive.search_files`** -- riskLevel: `low`
```typescript
params: z.object({
  query: z.string().describe('Search text (matches file names and content)'),
  maxResults: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
})
```
- REST: same endpoint with `fullText contains '${escapeDriveQuery(query)}'` in query string
- Inject `__labelFilter` from guard

**3. `drive.list_documents`** -- riskLevel: `low`
```typescript
params: z.object({
  query: z.string().optional().describe('Filter text (name/content match)'),
  maxResults: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
})
```
- REST: same endpoint with `mimeType='application/vnd.google-apps.document'` pre-applied
- Inject `__labelFilter` from guard

**4. `drive.search_documents`** -- riskLevel: `low`
```typescript
params: z.object({
  query: z.string().describe('Search text'),
  maxResults: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
})
```
- REST: same endpoint with `mimeType='application/vnd.google-apps.document'` AND `fullText contains '...'`
- Inject `__labelFilter` from guard

**5. `drive.list_folder_contents`** -- riskLevel: `low`
```typescript
params: z.object({
  folderId: z.string().describe('Folder ID'),
  maxResults: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
})
```
- REST: same endpoint with `'${folderId}' in parents and trashed=false`
- Inject `__labelFilter` from guard

**6. `drive.get_document_info`** -- riskLevel: `low`
```typescript
params: z.object({
  fileId: z.string().describe('File ID'),
})
```
- REST: `GET https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,description,size,createdTime,modifiedTime,webViewLink,owners,lastModifyingUser,shared&supportsAllDrives=true`

**7. `drive.get_folder_info`** -- riskLevel: `low`
```typescript
params: z.object({
  folderId: z.string().describe('Folder ID'),
})
```
- REST: GET file metadata + count children with `'${folderId}' in parents` query

**8. `drive.create_document`** -- riskLevel: `medium`
```typescript
params: z.object({
  title: z.string().describe('Document title'),
  markdown: z.string().optional().describe('Initial content as markdown'),
  folderId: z.string().optional().describe('Parent folder ID'),
})
```
- Step 1: `POST https://www.googleapis.com/drive/v3/files` with `{ name: title, mimeType: 'application/vnd.google-apps.document', parents: [folderId] }`
- Step 2 (if markdown): call `insertMarkdown(token, docId, markdown, { startIndex: 1, firstHeadingAsTitle: true })` from `docs-markdown.ts`
- Note: This action depends on the docs port (Task 2 from docs plan). If implementing before docs, use raw `convertMarkdownToRequests` + `executeBatchUpdate` directly.
- REST (for markdown insert): `POST https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`

**9. `drive.create_folder`** -- riskLevel: `medium`
```typescript
params: z.object({
  name: z.string().describe('Folder name'),
  parentFolderId: z.string().optional().describe('Parent folder ID'),
  description: z.string().optional(),
})
```
- REST: `POST https://www.googleapis.com/drive/v3/files` with `{ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId], description }`

**10. `drive.copy_file`** -- riskLevel: `medium`
```typescript
params: z.object({
  fileId: z.string().describe('Source file ID'),
  name: z.string().optional().describe('Name for the copy'),
  folderId: z.string().optional().describe('Destination folder ID'),
})
```
- REST: `POST https://www.googleapis.com/drive/v3/files/${fileId}/copy?fields=id,name,mimeType,webViewLink&supportsAllDrives=true` body: `{ name, parents: [folderId] }`

**11. `drive.move_file`** -- riskLevel: `medium`
```typescript
params: z.object({
  fileId: z.string().describe('File ID'),
  folderId: z.string().describe('Destination folder ID'),
})
```
- Step 1: GET current parents: `GET https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`
- Step 2: `PATCH https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${folderId}&removeParents=${currentParents}&fields=id,name,parents&supportsAllDrives=true`

**12. `drive.rename_file`** -- riskLevel: `medium`
```typescript
params: z.object({
  fileId: z.string().describe('File ID'),
  name: z.string().describe('New file name'),
})
```
- REST: `PATCH https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name&supportsAllDrives=true` body: `{ name }`

**13. `drive.delete_file`** -- riskLevel: `critical`
```typescript
params: z.object({
  fileId: z.string().describe('File ID (PERMANENT deletion)'),
})
```
- REST: `DELETE https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`

**14. `drive.download_file`** -- riskLevel: `low`
```typescript
params: z.object({
  fileId: z.string().describe('File ID'),
  maxSizeBytes: z.number().int().optional().describe('Max bytes to download (default: 1MB)'),
})
```
- Step 1: GET metadata to check MIME type and size
- Step 2a (Google Workspace): Export as text -- `GET https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
- Step 2b (regular text): Download -- `GET https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
- Step 2c (binary): Return error
- Note: No PDF extraction (unlike current `drive.read_file`). Simple text-only approach.

**15. `drive.create_from_template`** -- riskLevel: `medium`
```typescript
params: z.object({
  templateId: z.string().describe('Template document ID to copy'),
  title: z.string().describe('Title for the new document'),
  folderId: z.string().optional().describe('Destination folder ID'),
  replacements: z.record(z.string()).optional().describe('Key-value pairs for placeholder substitution (e.g. {"{{name}}": "Alice"})'),
})
```
- Step 1: Copy template -- `POST https://www.googleapis.com/drive/v3/files/${templateId}/copy` body: `{ name: title, parents: [folderId] }`
- Step 2 (if replacements): For each key-value pair, call batchUpdate with `replaceAllText` request on the new doc
- REST (for replacements): `POST https://docs.googleapis.com/v1/documents/${newDocId}:batchUpdate` body: `{ requests: [{ replaceAllText: { containsText: { text: key, matchCase: true }, replaceText: value } }] }`

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port 15 drive actions from reference repo

Port list_files, search_files, list_documents, search_documents,
list_folder_contents, get_document_info, get_folder_info,
create_document (with markdown), create_folder, copy_file, move_file,
rename_file, delete_file, download_file, and create_from_template.
Drop sharing, permissions, trash, file content update, and PDF
extraction capabilities.
```

---

## Task 2: Update labels guard + aggregator + skill

**Modify:** `packages/plugin-google-workspace/src/actions/labels-guard.ts`

### Replace drive classification arrays

All 15 drive action IDs must be classified:

**LIST_SEARCH:**
- `drive.list_files`
- `drive.search_files`
- `drive.list_documents`
- `drive.search_documents`
- `drive.list_folder_contents`

**READ_GET:**
- `drive.get_document_info`
- `drive.get_folder_info`
- `drive.download_file`

**WRITE_MODIFY:**
- `drive.copy_file`
- `drive.move_file`
- `drive.rename_file`
- `drive.delete_file`

**CREATE:**
- `drive.create_document`
- `drive.create_folder`
- `drive.create_from_template`

### Update `__labelFilter` injection

The `list_search` actions that need `__labelFilter` injection:
- `drive.list_files` -- existing pattern, inject into query
- `drive.search_files` -- existing pattern
- `drive.list_documents` -- new, needs label filter in query
- `drive.search_documents` -- new, needs label filter in query
- `drive.list_folder_contents` -- new, needs label filter in query

Each of these actions must read `(params as Record<string, unknown>).__labelFilter` and append it to the Drive API query with `AND` (same parenthesized pattern as existing code).

### Update `extractFileId`

The Drive actions use `fileId` param. The new actions follow the same convention except:
- `drive.create_from_template` uses `templateId` -- the guard's `extractFileId` should map this to `templateId` for the pre-dispatch label check

Update `extractFileId` for new param names:
```typescript
if (actionId === 'drive.create_from_template') {
  return typeof params.templateId === 'string' ? params.templateId : null;
}
```

### Update `extractCreatedFileId`

For `drive.create_document` and `drive.create_from_template`, the result data has `id` (same as existing pattern). No change needed.

**Modify:** `packages/plugin-google-workspace/src/actions/actions.ts`
- No changes to dispatch logic (imports are stable)
- Verify `drive.copy_file` special case in guard still works

**Modify:** `packages/plugin-google-workspace/skills/google-drive.md`
- Full rewrite for 15-action tool set
- Document document-centric search: `list_documents`, `search_documents`
- Document folder navigation: `list_folder_contents`, `get_folder_info`
- Document template workflow: `create_from_template` with placeholder replacements
- Document `create_document` with markdown body support
- Document download: `download_file` for text content extraction
- Keep guard awareness section (label filtering is invisible to the agent)

### Test step
- Run `cd packages/plugin-google-workspace && pnpm test` (labels-guard completeness)
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): update labels guard and skill for 15 drive actions

Update classification arrays in labels-guard.ts for new drive action IDs.
Add label filter injection for list_documents, search_documents, and
list_folder_contents. Rewrite google-drive.md skill with document-centric
search and template workflows.
```

---

## Task 3: Clean up + verify

**Delete:**
- `packages/plugin-google-workspace/src/actions/drive-api.ts`

**Modify:** `packages/plugin-google-workspace/package.json`
- Remove `unpdf` from dependencies (PDF extraction dropped -- `drive.read_file` removed)

**Verify:**
- `pnpm typecheck` from repo root passes
- `cd packages/plugin-google-workspace && pnpm test` passes (labels-guard completeness)
- No remaining imports from `drive-api.ts`
- `make generate-registries` succeeds
- All 15 + 25 + 37 = 77 action IDs are classified in the guard (total across all three ports)

### Commit
```
chore(google-workspace): remove old drive files and unpdf dependency

Delete drive-api.ts, replaced by inline fetch in drive-actions.ts.
Remove unpdf dependency (PDF extraction dropped with drive.read_file).
```

---

## Cross-port dependencies

The three ports have the following dependency chain:

1. **Docs helpers** (docs plan Task 1) must be done first -- provides `normalizeDocumentId`, `executeBatchUpdate`
2. **Docs markdown** (docs plan Task 2) must be done before **Drive Task 1** -- `drive.create_document` uses `insertMarkdown`
3. **Sheets helpers** (sheets plan Task 1) is independent of the other two
4. **Labels guard updates** should be done last (docs Task 8 + sheets Task 7 + drive Task 2) -- or all at once in a single task

Recommended execution order:
1. Docs Task 1 (helpers)
2. Docs Task 2 (markdown)
3. Docs Tasks 3-7 (actions) -- can parallelize
4. Sheets Task 1 (helpers)
5. Sheets Tasks 2-6 (actions) -- can parallelize
6. Drive Task 1 (actions)
7. All three guard/skill updates (docs Task 8 + sheets Task 7 + drive Task 2) -- do together
8. All three cleanup tasks (docs Task 9 + sheets Task 8 + drive Task 3) -- do together
