---
name: google-drive
description: How to use Google Drive tools effectively — file search, reading, creating, organizing, sharing, and working with Google Workspace file types.
---

# Google Drive

You have full access to Google Drive through the `google-drive` plugin. Drive is the file system — use it to find, read, create, organize, and share files. For editing Google Docs or Sheets content, use the dedicated `google-docs` or `google-sheets` tools instead.

## Available Tools

### Finding Files

- **`drive.list_files`** — List files in a folder (or root). Supports query filters, MIME type filtering, sorting, and pagination.
- **`drive.search_files`** — Full-text search across file names and content. The fastest way to find a file.
- **`drive.get_file`** — Get full metadata for a file by ID (name, type, size, owners, sharing status, links).

### Reading Content

- **`drive.read_file`** — Read text content of a file. Automatically exports Google Workspace files (Docs → plain text, Sheets → CSV). Extracts text from PDFs. Rejects binary files.
- **`drive.export_file`** — Export a Google Workspace file to a specific text format (plain text, CSV, HTML, JSON, XML).

### Creating & Updating

- **`drive.create_file`** — Create a new file with text content. Set `mimeType` to a Google Apps type to create native Workspace files.
- **`drive.create_folder`** — Create a new folder.
- **`drive.update_content`** — Replace the content of an existing file.
- **`drive.update_metadata`** — Rename, move, star, or update description of a file.
- **`drive.copy_file`** — Copy a file, optionally to a different folder with a new name.

### Sharing

- **`drive.share_file`** — Share with a user, group, domain, or anyone. Set role (reader/commenter/writer/organizer).
- **`drive.list_permissions`** — List all permissions on a file.
- **`drive.remove_permission`** — Remove a specific permission.

### Cleanup

- **`drive.trash_file`** — Move to trash (recoverable).
- **`drive.untrash_file`** — Restore from trash.
- **`drive.delete_file`** — Permanently delete (cannot be undone).

## Common Patterns

### Finding a File

Search is the fastest way to find files:

```
drive.search_files({ query: "Q1 budget report" })
```

To browse a specific folder:

```
drive.list_files({ folderId: "folder-id-here", orderBy: "modifiedTime desc" })
```

To find files by type:

```
drive.list_files({ mimeType: "application/vnd.google-apps.spreadsheet" })
```

### Reading Google Workspace Files

`read_file` auto-exports Workspace files to readable text:

- Google Docs → plain text
- Google Sheets → CSV
- Google Slides → plain text

For more control over the export format, use `export_file`:

```
drive.export_file({ fileId: "...", mimeType: "text/html" })        // Docs as HTML
drive.export_file({ fileId: "...", mimeType: "text/csv" })          // Sheets as CSV
drive.export_file({ fileId: "...", mimeType: "text/plain" })        // Slides as text
```

### Creating a Google Doc via Drive

To create a native Google Doc (not a plain text file), set the Google Apps MIME type:

```
drive.create_file({
  name: "Meeting Notes",
  content: "# Meeting Notes\n\nAgenda items...",
  mimeType: "application/vnd.google-apps.document",
  folderId: "folder-id-here"
})
```

The content is uploaded as plain text and converted to a native Google Doc. For rich formatting, use `google-docs` tools instead — they support full markdown-to-Docs conversion.

### Organizing Files

Move a file to a different folder:

```
drive.update_metadata({
  fileId: "...",
  addParents: "target-folder-id",
  removeParents: "current-folder-id"
})
```

Rename a file:

```
drive.update_metadata({ fileId: "...", name: "New Name" })
```

### Sharing Files

Share with a specific person:

```
drive.share_file({
  fileId: "...",
  role: "writer",
  type: "user",
  emailAddress: "alice@example.com"
})
```

Share with anyone who has the link:

```
drive.share_file({
  fileId: "...",
  role: "reader",
  type: "anyone"
})
```

## Google Workspace MIME Types

| Type | MIME Type |
|---|---|
| Google Docs | `application/vnd.google-apps.document` |
| Google Sheets | `application/vnd.google-apps.spreadsheet` |
| Google Slides | `application/vnd.google-apps.presentation` |
| Google Forms | `application/vnd.google-apps.form` |
| Google Drawings | `application/vnd.google-apps.drawing` |
| Folder | `application/vnd.google-apps.folder` |

## Tips

- **Drive vs Docs/Sheets**: Use Drive for file management (find, create, move, share). Use `google-docs` or `google-sheets` for editing content with rich formatting.
- **Search broadly**: `search_files` searches both file names and content. It's the best starting point when looking for something.
- **Read file handles PDFs**: `read_file` automatically extracts text from PDF files.
- **Binary files are rejected**: `read_file` only works with text-based files, Google Workspace files, and PDFs. Use `get_file` for metadata of binary files.
- **Trash before delete**: Prefer `trash_file` over `delete_file` — trashed files can be recovered.
