# Plugin Google Docs — Design

## Summary

A new `packages/plugin-google-docs/` plugin that lets the agent read and write Google Docs using **markdown** as the interface. The plugin handles all conversion between markdown and Google's `batchUpdate` structured format. The agent never deals with character indexes or batch requests.

## Key Decisions

1. **Markdown-native** — The agent reads docs as markdown and writes docs from markdown. The plugin handles bidirectional conversion.
2. **Self-contained with thin Drive dependency** — Requests `documents` + `drive.metadata.readonly` OAuth scopes so it can search/list docs without requiring the full Drive plugin.
3. **Port converter from [google-docs-mcp](https://github.com/a-bonus/google-docs-mcp)** (MIT) — Their `markdownToDocs.ts` (1,069 lines) and `docsToMarkdown.ts` (310 lines) are battle-tested. We adapt the conversion logic to use raw `fetch()` instead of the `googleapis` SDK.
4. **No `googleapis` SDK** — All API calls use raw `fetch()`, consistent with our other Google plugins and suitable for Cloudflare Workers.
5. **Focused action set** — ~10 high-level actions rather than 44 low-level tools. Agents work better with fewer, more powerful actions.
6. **Follows existing plugin structure** — Same file layout, IntegrationPackage export, and provider pattern as plugin-google-calendar/drive/sheets.

## OAuth & Scopes

- `https://www.googleapis.com/auth/documents` — Read/write Google Docs
- `https://www.googleapis.com/auth/drive.metadata.readonly` — List/search documents via Drive API
- Shared credentials: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

## Actions

| Action | Risk | Description |
|--------|------|-------------|
| `docs.search_documents` | low | Search for docs by name/query via Drive API (filtered to Google Docs MIME type) |
| `docs.get_document` | low | Get document metadata (title, last modified, word count, tabs) |
| `docs.read_document` | low | Read full document content as markdown (or specific tab) |
| `docs.read_section` | low | Read a specific section by heading text |
| `docs.create_document` | medium | Create a new Google Doc from markdown content, optionally in a folder |
| `docs.replace_document` | high | Replace entire document content with new markdown |
| `docs.append_content` | medium | Append markdown content to end of document |
| `docs.replace_section` | medium | Replace a specific section (identified by heading) with new markdown |
| `docs.insert_section` | medium | Insert a new markdown section before/after a named heading |
| `docs.delete_section` | high | Delete a section by heading text |

## Markdown ↔ Docs Conversion

### Docs → Markdown (reading)

Walk the document's `body.content` structural elements and produce markdown:

- Headings: `namedStyleType` → `#`, `##`, `###`, etc. (TITLE→H1, HEADING_1→H1, HEADING_2→H2)
- Text formatting: bold→`**`, italic→`_`, code (monospace fonts)→`` ` ``, strikethrough→`~~`, links→`[text](url)`
- Lists: bullet/ordered detection via `glyphType`, nesting via `nestingLevel`
- Tables: GFM pipe table syntax
- Code blocks: detect styled 1×1 tables with monospace font → fenced code blocks
- Horizontal rules / section breaks → `---`

### Markdown → Docs (writing)

Parse markdown with `markdown-it`, then build `batchUpdate` requests in three phases:

1. **Delete phase** — `deleteContentRange` requests (indexes shrink)
2. **Insert phase** — `insertText`, `insertTable`, `insertPageBreak`, `insertInlineImage`
3. **Format phase** — `updateParagraphStyle` (headings), `updateTextStyle` (bold/italic/links), `createParagraphBullets` (lists)

Key implementation details (ported from google-docs-mcp):
- Index tracking: cumulative offset as inserts modify document structure
- Code blocks rendered as styled 1×1 tables (Docs has no native code block)
- List formatting applied bottom-to-top to avoid index shift corruption
- Survivor paragraph cleanup after `deleteContentRange` (can't delete last paragraph)

### Section Resolution

- Scan document structure for heading paragraphs
- A "section" = everything from one heading to the next heading of equal or higher level
- Used by `read_section`, `replace_section`, `insert_section`, `delete_section`

## File Structure

```
packages/plugin-google-docs/
├── plugin.yaml
├── package.json
├── tsconfig.json
└── src/
    └── actions/
        ├── index.ts              # IntegrationPackage default export
        ├── provider.ts           # OAuth provider (standard Google pattern)
        ├── api.ts                # docsFetch() + driveFetch() helpers
        ├── actions.ts            # Action definitions (Zod schemas) + executor
        ├── docs-to-markdown.ts   # Docs JSON → markdown conversion
        ├── markdown-to-docs.ts   # Markdown → batchUpdate requests
        └── sections.ts           # Section resolution helpers
```

## Dependencies

- `@valet/sdk` (workspace)
- `@valet/shared` (workspace)
- `zod` — schema validation (existing pattern)
- `markdown-it` — markdown parser for md→docs conversion (same as google-docs-mcp reference)
- `@types/markdown-it` — dev dependency

No `googleapis` SDK. No `google-auth-library`. Raw `fetch()` for all API calls.

## API Endpoints

| Endpoint | Usage |
|----------|-------|
| `https://docs.googleapis.com/v1/documents/{id}` | GET document structure |
| `https://docs.googleapis.com/v1/documents` | POST create document |
| `https://docs.googleapis.com/v1/documents/{id}:batchUpdate` | POST modify document |
| `https://www.googleapis.com/drive/v3/files` | GET list/search documents |

## What We're NOT Building

- Low-level index-based insert/delete actions (footguns for agents)
- Formatting-only actions (bold a range without content change)
- Comments/suggestions API
- Revision history
- Tab management (list tabs is included, but no create/delete/rename)
- Template support
- Image upload (inline image insertion from URL is supported via markdown `![](url)`)

## Reference Implementation

Converter logic adapted from [a-bonus/google-docs-mcp](https://github.com/a-bonus/google-docs-mcp) (MIT license):
- `src/markdown-transformer/markdownToDocs.ts` — md→docs conversion with index management
- `src/markdown-transformer/docsToMarkdown.ts` — docs→md conversion
- `src/googleDocsApiHelpers.ts` — batch update phase splitting strategy
