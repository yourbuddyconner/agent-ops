# Gmail Port Design

**Status:** Draft
**Author:** Conner Swann
**Date:** 2026-04-23
**Reference:** github.com/a-bonus/google-docs-mcp

## Summary

Replace the 13 current `gmail.*` actions in `packages/plugin-gmail/` with 13 actions ported from the google-docs-mcp reference implementation. The tool count is coincidentally the same, but the composition changes: convenience wrappers (`archive`, `star`, `mark_read`) are dropped in favor of the general-purpose `modify_labels`, and new capabilities are added: `list_drafts`, `get_draft`, `update_draft`, `delete_draft`, and `triage_inbox`. The Gmail plugin is a standalone package (not part of google-workspace) and has no labels guard.

## Tools Being Adopted

| Action ID | Params (summary) | Description | Risk |
|-----------|------------------|-------------|------|
| `gmail.send_email` | `to`, `cc?`, `bcc?`, `subject`, `body`, `bodyHtml?`, `threadId?`, `replyTo?` | Send a new email | high |
| `gmail.list_messages` | `query?`, `maxResults?`, `labelIds?`, `pageToken?` | List emails with optional query filter | low |
| `gmail.get_message` | `messageId` | Get a single email with full content | low |
| `gmail.modify_labels` | `messageId`, `addLabelIds?`, `removeLabelIds?` | Add or remove labels (subsumes archive, star, mark-read) | medium |
| `gmail.trash_message` | `messageId` | Move a message to trash | high |
| `gmail.create_draft` | `to`, `cc?`, `bcc?`, `subject`, `body`, `bodyHtml?`, `threadId?`, `replyTo?` | Create a draft email | medium |
| `gmail.list_drafts` | `maxResults?`, `pageToken?` | List all drafts | low |
| `gmail.get_draft` | `draftId` | Get a single draft with full content | low |
| `gmail.update_draft` | `draftId`, `to`, `cc?`, `bcc?`, `subject`, `body`, `bodyHtml?` | Update an existing draft | medium |
| `gmail.send_draft` | `draftId` | Send an existing draft | high |
| `gmail.delete_draft` | `draftId` | Permanently delete a draft | medium |
| `gmail.list_labels` | (none) | List all labels | low |
| `gmail.triage_inbox` | `maxResults?`, `additionalQuery?`, `bodyExcerptLength?` | Composite tool: fetch unread messages with heuristic categorization + aggregate stats | low |

## Tools Being Dropped

| Current Action ID | Reason | Regression? |
|-------------------|--------|-------------|
| `gmail.reply_to_email` | Subsumed by `gmail.send_email` with `threadId` + `In-Reply-To` headers | No -- same capability, different params |
| `gmail.archive` | Subsumed by `gmail.modify_labels` with `removeLabelIds: ['INBOX']` | No |
| `gmail.star` | Subsumed by `gmail.modify_labels` with `addLabelIds: ['STARRED']` | No |
| `gmail.mark_read` | Subsumed by `gmail.modify_labels` with `removeLabelIds: ['UNREAD']` | No |
| `gmail.get_attachment` | Not in reference repo | **Yes** -- agents lose the ability to download attachment data |

## Porting Translation

Same pattern as the Docs port (see `2026-04-23-google-workspace-docs-port-design.md`). Key differences specific to Gmail:

- **Gmail API base URL:** `https://gmail.googleapis.com/gmail/v1`
- **RFC 2822 email construction:** Both the reference repo and our current code build raw emails with base64url encoding. The reference repo uses the `googleapis` client but the email construction is pure string manipulation -- ports directly.
- **`triage_inbox` is the interesting new tool:** It fetches unread messages, applies heuristic categorization (newsletter detection via `List-Unsubscribe`/`List-Id` headers, meeting keyword matching, question detection, action-requested detection), and returns aggregate stats (total unread, top senders, category breakdown). This is a composite read-only tool designed for AI inbox triage workflows.
- **`list_messages` response shape changes:** The reference repo fetches full message content for each listed message (N+1 pattern: list IDs then batch-get each). Our current implementation does the same. The reference repo uses `Promise.allSettled` for resilience; the port should adopt this.
- **`update_draft` is new:** Allows modifying a draft's content before sending. Our current implementation only supports create and send.
- **`delete_draft` is new:** Permanently deletes a draft (not trash).
- **`reply_to_email` removal:** The reference repo's `send_email` handles replies via `threadId` param. The `In-Reply-To` and `References` headers must be set by the caller or auto-populated from the thread. The port should support `inReplyTo` and `references` params on `send_email` for threading.

## Files Changed

### Create
- `packages/plugin-gmail/src/actions/actions.ts` (rewrite with 13 new actions)
- `packages/plugin-gmail/skills/gmail.md` (new -- Gmail currently has no skill file)

### Modify
- `packages/plugin-gmail/src/actions/api.ts` (may simplify; keep `gmailFetch`, `decodeBase64Url`, `encodeBase64Url` helpers)

### Delete
None -- the Gmail plugin is small. The actions file is rewritten in place.

## Skill Updates

Gmail currently has **no skill file**. Create `packages/plugin-gmail/skills/gmail.md` with:

- Overview of available Gmail tools (13 actions)
- Triage workflow: `triage_inbox` -> review categorized messages -> `create_draft` / `modify_labels` / `trash_message`
- Reply workflow: `get_message` (read original) -> `send_email` with `threadId` + `inReplyTo` for proper threading
- Draft workflow: `create_draft` -> `update_draft` (revise) -> `send_draft`
- Label management: `list_labels` to discover available labels, `modify_labels` for archive (`removeLabelIds: ['INBOX']`), star (`addLabelIds: ['STARRED']`), mark read (`removeLabelIds: ['UNREAD']`)
- Guidance on Gmail search query syntax for `list_messages` and `triage_inbox`

Also update `packages/plugin-gmail/plugin.yaml` to declare the new skill file.

## Migration / Breaking Changes

Action ID changes:

Unchanged:
- `gmail.send_email`, `gmail.list_messages`, `gmail.get_message`, `gmail.create_draft`, `gmail.send_draft`

Renamed:
- `gmail.modify_labels` (same ID, same params)
- `gmail.trash` -> `gmail.trash_message`
- `gmail.get_labels` -> `gmail.list_labels`

Removed:
- `gmail.reply_to_email` (use `gmail.send_email` with `threadId`)
- `gmail.archive` (use `gmail.modify_labels`)
- `gmail.star` (use `gmail.modify_labels`)
- `gmail.mark_read` (use `gmail.modify_labels`)
- `gmail.get_attachment`

Added:
- `gmail.list_drafts`
- `gmail.get_draft`
- `gmail.update_draft`
- `gmail.delete_draft`
- `gmail.triage_inbox`

No labels guard changes needed -- Gmail is a separate plugin outside google-workspace.

No D1 migration needed. Action IDs are synced at worker startup via content registry.
