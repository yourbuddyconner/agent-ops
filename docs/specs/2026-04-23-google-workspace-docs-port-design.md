# Google Workspace Docs Port Design

**Status:** Draft
**Author:** Conner Swann
**Date:** 2026-04-23
**Reference:** github.com/a-bonus/google-docs-mcp

## Summary

Replace the 15 current `docs.*` actions in `packages/plugin-google-workspace/` with 25 actions ported from the google-docs-mcp reference implementation. The current section-based editing model (`replace_section`, `insert_section`, `delete_section`, `list_sections`) is dropped in favor of granular index-based primitives (`modifyText`, `insertText`, `deleteRange`, `findAndReplace`). The custom markdown transformer is replaced by the reference repo's `docsJsonToMarkdown` and `markdownToDocs` implementations. The `readDocument` action gains a `format` param (text/json/markdown) that unlocks surgical editing via JSON index inspection.

## Tools Being Adopted

| Action ID | Params (summary) | Description | Risk | Guard |
|-----------|------------------|-------------|------|-------|
| `docs.read_document` | `documentId`, `format?` (text/json/markdown), `maxLength?`, `tabId?` | Read document content in text, JSON, or markdown format | low | READ_GET |
| `docs.insert_text` | `documentId`, `text`, `index`, `tabId?` | Insert text at a specific index | medium | WRITE_MODIFY |
| `docs.append_text` | `documentId`, `text`, `tabId?` | Append text to end of document | medium | WRITE_MODIFY |
| `docs.modify_text` | `documentId`, `target` (range/find/insertion), `text?`, `style?`, `tabId?` | Combined replace/insert/format in one atomic operation | high | WRITE_MODIFY |
| `docs.delete_range` | `documentId`, `startIndex`, `endIndex`, `tabId?` | Delete content in an index range | high | WRITE_MODIFY |
| `docs.find_and_replace` | `documentId`, `find`, `replace`, `matchCase?`, `tabId?` | Global find-and-replace | medium | WRITE_MODIFY |
| `docs.insert_table` | `documentId`, `rows`, `columns`, `index?`, `tabId?` | Insert empty table | medium | WRITE_MODIFY |
| `docs.insert_table_with_data` | `documentId`, `data` (2D array), `index?`, `tabId?` | Insert table pre-populated with data | medium | WRITE_MODIFY |
| `docs.insert_image` | `documentId`, `uri`, `index?`, `width?`, `height?`, `tabId?` | Insert image by URL | medium | WRITE_MODIFY |
| `docs.insert_page_break` | `documentId`, `index?`, `tabId?` | Insert page break | low | WRITE_MODIFY |
| `docs.insert_section_break` | `documentId`, `index?`, `type?`, `tabId?` | Insert section break (next page, continuous) | low | WRITE_MODIFY |
| `docs.add_tab` | `documentId`, `title` | Add a new tab | medium | WRITE_MODIFY |
| `docs.list_tabs` | `documentId` | List all tabs with IDs and titles | low | LIST_SEARCH |
| `docs.rename_tab` | `documentId`, `tabId`, `title` | Rename an existing tab | medium | WRITE_MODIFY |
| `docs.apply_text_style` | `documentId`, `startIndex`, `endIndex`, `style`, `tabId?` | Apply bold/italic/font/color/size to a range | medium | WRITE_MODIFY |
| `docs.apply_paragraph_style` | `documentId`, `startIndex`, `endIndex`, `style`, `tabId?` | Apply heading level, alignment, spacing, indentation | medium | WRITE_MODIFY |
| `docs.update_section_style` | `documentId`, `startIndex`, `endIndex`, `style`, `tabId?` | Update page margins, columns, orientation for a section | medium | WRITE_MODIFY |
| `docs.add_comment` | `documentId`, `content`, `quotedText?` | Add a comment (optionally anchored to text) | medium | WRITE_MODIFY |
| `docs.list_comments` | `documentId`, `includeResolved?` | List comments on a document | low | READ_GET |
| `docs.get_comment` | `documentId`, `commentId` | Get a single comment by ID | low | READ_GET |
| `docs.reply_to_comment` | `documentId`, `commentId`, `content` | Reply to a comment | medium | WRITE_MODIFY |
| `docs.delete_comment` | `documentId`, `commentId` | Delete a comment | high | WRITE_MODIFY |
| `docs.resolve_comment` | `documentId`, `commentId` | Resolve a comment thread | medium | WRITE_MODIFY |
| `docs.append_markdown` | `documentId`, `markdown`, `tabId?` | Append markdown content to end of document | medium | WRITE_MODIFY |
| `docs.replace_document_with_markdown` | `documentId`, `markdown` | Replace entire document body with markdown | high | WRITE_MODIFY |

## Tools Being Dropped

| Current Action ID | Reason |
|-------------------|--------|
| `docs.search_documents` | Moved to Drive: use `drive.search_documents` or `drive.list_documents` instead |
| `docs.get_document` | Subsumed by `docs.read_document` with `format` param |
| `docs.read_section` | Dropped with section-based editing model; use `read_document` format=json + index-based ops |
| `docs.create_document` | Moved to Drive: use `drive.create_document` instead |
| `docs.replace_document` | Replaced by `docs.replace_document_with_markdown` |
| `docs.append_content` | Replaced by `docs.append_markdown` (same behavior, clearer name) |
| `docs.replace_section` | Dropped: replaced by `modify_text` with range target |
| `docs.insert_section` | Dropped: replaced by `insert_text` at computed index |
| `docs.delete_section` | Dropped: replaced by `delete_range` with computed indices |
| `docs.update_document` | Replaced by `docs.modify_text` (TOON/JSON operations model replaced by direct target model) |
| `docs.list_sections` | Dropped with section-based editing model |
| `docs.create_comment` | Replaced by `docs.add_comment` (gains `quotedText` param for anchored comments) |

## Porting Translation

FastMCP `server.addTool({ name, parameters, execute })` maps to Valet as follows:

- **Tool name** (camelCase) becomes **action ID** (snake_case with `docs.` prefix)
- **`parameters`** (Zod schema) becomes `ActionDefinition.params` (Zod schema, identical)
- **`execute` function** becomes a `case` in the `executeDocsAction` switch statement
- **`getDocsClient()` calls** become raw `fetch()` to `https://docs.googleapis.com/v1/...` with `Authorization: Bearer ${token}`
- **`getDriveClient()` calls** (for comments API) become raw `fetch()` to `https://www.googleapis.com/drive/v3/...`
- **`throw new UserError(msg)`** becomes `return { success: false, error: msg }`
- **Return value** (string) becomes `{ success: true, data: { ... } }` with structured data
- **`GDocsHelpers.*`** functions are ported to `docs-helpers.ts` using fetch instead of googleapis client

The `executeBatchUpdateWithSplitting` helper (splits >50 requests into multiple API calls) should be ported since the reference repo handles this and our current code does not.

## Files Changed

### Create
- `packages/plugin-google-workspace/src/actions/docs-actions.ts` (rewrite with 25 new actions)
- `packages/plugin-google-workspace/src/actions/docs-helpers.ts` (ported `googleDocsApiHelpers.ts` functions using fetch)
- `packages/plugin-google-workspace/src/actions/docs-markdown.ts` (ported `docsJsonToMarkdown` + `markdownToDocs`)

### Modify
- `packages/plugin-google-workspace/src/actions/labels-guard.ts` (update all four classification arrays for new action IDs)
- `packages/plugin-google-workspace/src/actions/actions.ts` (no changes to dispatch logic, just re-exports)
- `packages/plugin-google-workspace/src/actions/__tests__/labels-guard.test.ts` (will auto-catch mismatches)
- `packages/plugin-google-workspace/skills/google-docs.md` (full rewrite)

### Delete
- `packages/plugin-google-workspace/src/actions/docs-api.ts` (replaced by docs-helpers.ts)
- `packages/plugin-google-workspace/src/actions/docs-to-markdown.ts` (replaced by docs-markdown.ts)
- `packages/plugin-google-workspace/src/actions/markdown-to-docs.ts` (replaced by docs-markdown.ts)
- `packages/plugin-google-workspace/src/actions/sections.ts` (section model dropped)
- `packages/plugin-google-workspace/src/actions/operations.ts` (TOON operations model dropped)

## Skill Updates

`packages/plugin-google-workspace/skills/google-docs.md` needs a full rewrite:

- New tool names and IDs throughout
- New workflow: read with `format=json` to get indices, then use `modify_text` / `insert_text` / `delete_range` for surgical edits
- New workflow: read with `format=markdown` for overview, then `replace_document_with_markdown` for bulk rewrites
- Drop all section-based editing guidance
- Document the `modify_text` target union (range indices, text search, insertion index)
- Document comment tools (add, list, get, reply, delete, resolve)
- Document tab management (add, list, rename)

## Migration / Breaking Changes

All 15 current `docs.*` action IDs change. Actions stored in D1 skill definitions will be stale until `make generate-registries` is run and content is re-synced at worker startup. No user-facing migration is needed since action IDs are internal to the agent's tool use.

Specific ID renames:
- `docs.search_documents` -> removed (use `drive.search_documents` or `drive.list_documents`)
- `docs.get_document` -> removed (use `docs.read_document`)
- `docs.read_document` -> `docs.read_document` (same ID, new params)
- `docs.read_section` -> removed
- `docs.create_document` -> removed (use `drive.create_document`)
- `docs.replace_document` -> `docs.replace_document_with_markdown`
- `docs.append_content` -> `docs.append_markdown`
- `docs.replace_section` -> removed
- `docs.insert_section` -> removed
- `docs.delete_section` -> removed
- `docs.update_document` -> removed (use `docs.modify_text`)
- `docs.list_sections` -> removed
- `docs.list_comments` -> `docs.list_comments` (same)
- `docs.create_comment` -> `docs.add_comment`
- `docs.reply_to_comment` -> `docs.reply_to_comment` (same)

The `@toon-format/toon` dependency can be removed from `package.json` after the port.
