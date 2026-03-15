---
name: google-docs
description: How to use Google Docs tools effectively — markdown formatting, section-based editing, read-before-write patterns, and rich text best practices.
---

# Google Docs

You have full read/write access to Google Docs through the `google-docs` plugin. The key advantage is **rich text formatting** — content you write in markdown is automatically converted to properly formatted Google Docs (headings, bold, italic, links, lists, tables, code blocks, etc).

## Critical Rule: Always Use Markdown

**Every piece of content you write to a Google Doc MUST be formatted in markdown.** The system converts markdown to native Google Docs formatting. If you write plain text without markdown, the document will look unformatted and unprofessional.

```markdown
# Meeting Notes — March 15, 2026

## Action Items

- **@alice**: Finalize the API spec by Friday
- **@bob**: Review the [design doc](https://docs.google.com/...)
- ~~Cancelled: vendor demo~~ — rescheduled to next week

## Technical Summary

The migration uses a `three-phase approach`:

1. **Phase 1** — Schema migration with backwards compatibility
2. **Phase 2** — Dual-write to old and new tables
3. **Phase 3** — Cut over and deprecate old schema
```

This produces a document with proper headings, bold names, a clickable link, strikethrough, inline code, and a numbered list — not just raw text.

## Supported Markdown Formatting

| Markdown | Result in Google Docs |
|---|---|
| `# Heading` through `###### Heading` | Heading 1 through Heading 6 |
| `**bold**` | Bold text |
| `*italic*` | Italic text |
| `~~strikethrough~~` | Strikethrough text |
| `[text](url)` | Clickable hyperlink |
| `` `inline code` `` | Monospace font (Roboto Mono, green) |
| Triple-backtick code blocks | Gray-background table cell with monospace font |
| `- item` or `* item` | Bullet list |
| `1. item` | Numbered list |
| `- [ ] task` / `- [x] task` | Checkbox list items |
| `---` | Horizontal rule |
| Markdown tables | Native Google Docs tables |

## Available Tools

### Reading

- **`docs.search_documents`** — Find documents by title keyword. Use this to locate documents before reading/editing.
- **`docs.get_document`** — Get full document metadata (title, sections, revision info). Good for understanding document structure.
- **`docs.read_document`** — Read entire document content as plain text. Use for short documents.
- **`docs.read_section`** — Read a specific section by heading name. Use for long documents where you only need part of the content.

### Writing

- **`docs.create_document`** — Create a new document. Content MUST be markdown.
- **`docs.replace_document`** — Replace the entire document body. Content MUST be markdown.
- **`docs.append_content`** — Append content to the end of the document. Content MUST be markdown.
- **`docs.replace_section`** — Replace the content under a specific heading. Content MUST be markdown.
- **`docs.insert_section`** — Insert a new section before or after an existing heading.
- **`docs.delete_section`** — Delete a section and all its content.

## Common Patterns

### Read Before Write

Always read a document before modifying it to understand its structure:

```
1. docs.search_documents({ query: "Q1 Planning" })
2. docs.get_document({ documentId: "..." })      // see section headings
3. docs.read_section({ documentId: "...", sectionHeading: "Budget" })
4. docs.replace_section({ documentId: "...", sectionHeading: "Budget", content: "..." })
```

### Section-Based Editing

Documents are organized by headings. Use section tools to surgically edit specific parts without touching the rest:

- **Replace a section**: `docs.replace_section` replaces everything under a heading (up to the next heading of equal or higher level)
- **Insert a section**: `docs.insert_section` adds a new section before or after an existing one
- **Delete a section**: `docs.delete_section` removes a heading and everything under it

When targeting a section, use the exact heading text (case-sensitive).

### Creating Well-Structured Documents

When creating new documents, use heading hierarchy to establish clear structure:

```markdown
# Project Title

Brief overview paragraph.

## Background

Context and motivation.

## Requirements

### Functional Requirements

- Requirement 1
- Requirement 2

### Non-Functional Requirements

- Performance: < 200ms p99
- Availability: 99.9%

## Timeline

| Phase | Date | Milestone |
|---|---|---|
| Design | Mar 20 | Design doc approved |
| Build | Apr 10 | MVP complete |
| Launch | Apr 30 | GA release |
```

### Appending to Existing Documents

Use `docs.append_content` to add new content at the end. This is useful for running logs, meeting notes, or adding new sections to an existing document.

### Code in Documents

Code blocks render as gray-background table cells with monospace font, making them visually distinct:

````markdown
```python
def hello():
    print("Hello, world!")
```
````

Inline code like `variable_name` renders in green monospace font.

## Tips

- **Search first**: Use `docs.search_documents` to find documents by title before working with them. You need the document ID for all other operations.
- **Use sections**: For large documents, prefer `read_section` and `replace_section` over reading/replacing the entire document.
- **Markdown everywhere**: Every content string — in create, replace, append, insert — is parsed as markdown. Take advantage of this for professional-looking documents.
- **Heading levels matter**: Section operations use heading hierarchy. A `## Subheading` under `# Heading` is part of the `# Heading` section. Replacing `# Heading` replaces everything including sub-sections.
