# Google Workspace Drive Port Design

**Status:** Draft
**Author:** Conner Swann
**Date:** 2026-04-23
**Reference:** github.com/a-bonus/google-docs-mcp

## Summary

Replace the 16 current `drive.*` actions in `packages/plugin-google-workspace/` with 15 actions ported from the google-docs-mcp reference implementation. The reference repo's Drive tools are focused on document-centric workflows: listing/searching Docs specifically, folder navigation, document creation (with optional markdown body), and file operations (copy, move, rename, delete, download). Several current capabilities are dropped: file content reading/export, sharing/permissions, and trash/untrash. These are flagged as regressions below.

**Risk: capability regression.** The reference repo's Drive tools do not cover sharing (`drive.share_file`, `drive.list_permissions`, `drive.remove_permission`), file content reading (`drive.read_file`, `drive.export_file`), content updates (`drive.update_content`), or reversible deletion (`drive.trash_file`, `drive.untrash_file`). Consider re-adding these as a fast-follow if agents need them.

## Tools Being Adopted

| Action ID | Params (summary) | Description | Risk | Guard |
|-----------|------------------|-------------|------|-------|
| `drive.list_files` | `query?`, `folderId?`, `mimeType?`, `maxResults?`, `pageToken?` | List files with optional filtering | low | LIST_SEARCH |
| `drive.search_files` | `query`, `maxResults?`, `pageToken?` | Full-text search across file names and content | low | LIST_SEARCH |
| `drive.list_documents` | `query?`, `maxResults?`, `pageToken?` | List Google Docs specifically (mimeType filter pre-applied) | low | LIST_SEARCH |
| `drive.search_documents` | `query`, `maxResults?`, `pageToken?` | Search Google Docs by name and content | low | LIST_SEARCH |
| `drive.list_folder_contents` | `folderId`, `maxResults?`, `pageToken?` | List contents of a specific folder | low | LIST_SEARCH |
| `drive.get_document_info` | `fileId` | Get document metadata (title, mimeType, size, owners, links) | low | READ_GET |
| `drive.get_folder_info` | `folderId` | Get folder metadata including child count | low | READ_GET |
| `drive.create_document` | `title`, `markdown?`, `folderId?` | Create a new Google Doc with optional markdown content | medium | CREATE |
| `drive.create_folder` | `name`, `parentFolderId?`, `description?` | Create a new folder | medium | CREATE |
| `drive.copy_file` | `fileId`, `name?`, `folderId?` | Copy a file, optionally to a different folder with a new name | medium | WRITE_MODIFY |
| `drive.move_file` | `fileId`, `folderId` | Move a file to a different folder | medium | WRITE_MODIFY |
| `drive.rename_file` | `fileId`, `name` | Rename a file | medium | WRITE_MODIFY |
| `drive.delete_file` | `fileId` | Permanently delete a file (cannot be undone) | critical | WRITE_MODIFY |
| `drive.download_file` | `fileId`, `maxSizeBytes?` | Download file content as text (with Google Workspace export) | low | READ_GET |
| `drive.create_from_template` | `templateId`, `title`, `folderId?`, `replacements?` | Create a new document from a template with placeholder substitution | medium | CREATE |

## Tools Being Dropped

| Current Action ID | Reason | Regression? |
|-------------------|--------|-------------|
| `drive.get_file` | Replaced by `drive.get_document_info` | No |
| `drive.read_file` | Not in reference repo (text reading with PDF extraction) | **Yes** -- agents lose the ability to read file contents via Drive |
| `drive.export_file` | Not in reference repo | **Yes** -- agents lose explicit format export; `download_file` covers some cases |
| `drive.create_file` | Replaced by `drive.create_document` (Docs-specific) | Partial -- generic file creation (text, CSV) is lost |
| `drive.update_metadata` | Subsumed by `drive.rename_file` + `drive.move_file` | No -- dedicated single-purpose tools are cleaner |
| `drive.update_content` | Not in reference repo | **Yes** -- agents lose the ability to update file content via Drive |
| `drive.copy_file` | `drive.copy_file` (same, ported) | No |
| `drive.share_file` | Not in reference repo | **Yes** -- agents lose sharing capability |
| `drive.list_permissions` | Not in reference repo | **Yes** -- agents lose permission inspection |
| `drive.remove_permission` | Not in reference repo | **Yes** -- agents lose permission revocation |
| `drive.trash_file` | Not in reference repo | **Yes** -- agents lose recoverable deletion (only permanent delete available) |
| `drive.untrash_file` | Not in reference repo | **Yes** -- agents lose trash recovery |

**Decision needed:** The sharing/permissions and trash tools could be retained alongside the ported tools with minimal effort. They are independent of the reference repo's changes. Recommend keeping them in a follow-up if needed.

## Porting Translation

Same pattern as the Docs port (see `2026-04-23-google-workspace-docs-port-design.md`). Key differences:

- **Drive API base URL:** `https://www.googleapis.com/drive/v3`
- **Upload endpoint:** `https://www.googleapis.com/upload/drive/v3` for file creation with content
- **`create_document`** is the most complex tool: creates a Doc via Docs API, optionally inserts markdown content via batchUpdate, then moves to target folder via Drive API. This combines Docs + Drive APIs in one action.
- **`create_from_template`** copies a template doc then does find-and-replace on placeholders. Two API calls chained.
- **`download_file`** replaces our `read_file` but is simpler: exports Google Workspace files as text, downloads regular files as text, rejects binary files. No PDF extraction.

## Files Changed

### Create
- `packages/plugin-google-workspace/src/actions/drive-actions.ts` (rewrite with 15 new actions)
- `packages/plugin-google-workspace/src/actions/drive-helpers.ts` (shared Drive fetch helpers, file type detection)

### Modify
- `packages/plugin-google-workspace/src/actions/labels-guard.ts` (update all four classification arrays for new Drive action IDs)
- `packages/plugin-google-workspace/src/actions/actions.ts` (update `extractFileId` mappings if param names change)
- `packages/plugin-google-workspace/skills/google-drive.md` (full rewrite)

### Delete
- `packages/plugin-google-workspace/src/actions/drive-api.ts` (replaced by drive-helpers.ts)

## Skill Updates

`packages/plugin-google-workspace/skills/google-drive.md` needs a full rewrite:

- New tool names and IDs throughout
- Document document-centric search: `list_documents`, `search_documents` for Docs-specific queries
- Document folder navigation: `list_folder_contents`, `get_folder_info`
- Document template workflow: `create_from_template` with placeholder replacements
- Document `create_document` with markdown body support
- Drop sharing/permissions guidance
- Drop file content reading guidance (or flag as coming from `download_file`)

## Migration / Breaking Changes

All 16 current `drive.*` action IDs change or are removed. The labels-guard completeness test will enforce classification of all new IDs.

Specific ID renames:
- `drive.list_files` -> `drive.list_files` (same)
- `drive.search_files` -> `drive.search_files` (same)
- `drive.get_file` -> `drive.get_document_info`
- `drive.read_file` -> removed (partially covered by `drive.download_file`)
- `drive.export_file` -> removed
- `drive.create_file` -> `drive.create_document`
- `drive.create_folder` -> `drive.create_folder` (same)
- `drive.update_metadata` -> removed (split into `drive.rename_file` + `drive.move_file`)
- `drive.update_content` -> removed
- `drive.copy_file` -> `drive.copy_file` (same)
- `drive.share_file` -> removed
- `drive.list_permissions` -> removed
- `drive.remove_permission` -> removed
- `drive.trash_file` -> removed
- `drive.untrash_file` -> removed
- `drive.delete_file` -> `drive.delete_file` (same)

The `unpdf` dependency (used by `drive.read_file` for PDF text extraction) can be removed from `package.json` if `read_file` is not retained.
