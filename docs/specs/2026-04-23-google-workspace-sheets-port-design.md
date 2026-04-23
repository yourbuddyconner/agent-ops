# Google Workspace Sheets Port Design

**Status:** Draft
**Author:** Conner Swann
**Date:** 2026-04-23
**Reference:** github.com/a-bonus/google-docs-mcp

## Summary

Replace the 11 current `sheets.*` actions in `packages/plugin-google-workspace/` with 37 actions ported from the google-docs-mcp reference implementation. The current minimal set (read/write/append/clear/format/create/add-sheet/delete-sheet) is expanded with sheet management (rename, duplicate, copy-to), tables (structured data ranges), charts, conditional formatting, validation, protection, row grouping, cell borders, column/row sizing, and freeze panes. The porting translation pattern is identical to the Docs port (see `2026-04-23-google-workspace-docs-port-design.md`).

## Tools Being Adopted

| Action ID | Params (summary) | Description | Risk | Guard |
|-----------|------------------|-------------|------|-------|
| `sheets.read_spreadsheet` | `spreadsheetId`, `range`, `format?` (text/json) | Read cell values from a range | low | READ_GET |
| `sheets.write_spreadsheet` | `spreadsheetId`, `range`, `data` (2D array) | Write values to a range | medium | WRITE_MODIFY |
| `sheets.append_rows` | `spreadsheetId`, `range`, `data` (2D array) | Append rows after last data row | medium | WRITE_MODIFY |
| `sheets.create_spreadsheet` | `title`, `sheetTitles?` | Create a new spreadsheet | medium | CREATE |
| `sheets.get_spreadsheet_info` | `spreadsheetId` | Get spreadsheet metadata, sheet list, properties | low | READ_GET |
| `sheets.list_spreadsheets` | `query?`, `maxResults?` | Search for spreadsheets via Drive API | low | LIST_SEARCH |
| `sheets.batch_write` | `spreadsheetId`, `ranges` (array of range+data) | Write to multiple ranges in one call | medium | WRITE_MODIFY |
| `sheets.clear_range` | `spreadsheetId`, `range` | Clear all values from a range | medium | WRITE_MODIFY |
| `sheets.add_sheet` | `spreadsheetId`, `title` | Add a new sheet/tab | medium | WRITE_MODIFY |
| `sheets.delete_sheet` | `spreadsheetId`, `sheetId` | Delete a sheet/tab | high | WRITE_MODIFY |
| `sheets.rename_sheet` | `spreadsheetId`, `sheetId`, `title` | Rename a sheet/tab | medium | WRITE_MODIFY |
| `sheets.duplicate_sheet` | `spreadsheetId`, `sheetId`, `title?` | Duplicate a sheet within the same spreadsheet | medium | WRITE_MODIFY |
| `sheets.copy_sheet_to` | `sourceSpreadsheetId`, `sheetId`, `destinationSpreadsheetId` | Copy a sheet to a different spreadsheet | medium | WRITE_MODIFY |
| `sheets.format_cells` | `spreadsheetId`, `range`, `format` | Apply formatting (colors, bold, borders, alignment, number format) | medium | WRITE_MODIFY |
| `sheets.read_cell_format` | `spreadsheetId`, `range` | Read formatting from a range | low | READ_GET |
| `sheets.copy_formatting` | `spreadsheetId`, `sourceRange`, `destinationRange` | Copy formatting from one range to another | medium | WRITE_MODIFY |
| `sheets.set_column_widths` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `width` | Set column widths in pixels | medium | WRITE_MODIFY |
| `sheets.set_row_heights` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `height` | Set row heights in pixels | medium | WRITE_MODIFY |
| `sheets.auto_resize_columns` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex` | Auto-fit column widths to content | medium | WRITE_MODIFY |
| `sheets.auto_resize_rows` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex` | Auto-fit row heights to content | medium | WRITE_MODIFY |
| `sheets.set_cell_borders` | `spreadsheetId`, `range`, `borders` | Set border styles on a range | medium | WRITE_MODIFY |
| `sheets.freeze_rows_and_columns` | `spreadsheetId`, `sheetId`, `frozenRowCount?`, `frozenColumnCount?` | Freeze rows and/or columns | medium | WRITE_MODIFY |
| `sheets.create_table` | `spreadsheetId`, `sheetId`, `range`, `columns` | Create a structured table with named columns | medium | CREATE |
| `sheets.get_table` | `spreadsheetId`, `sheetId`, `tableId` | Get table metadata and data | low | READ_GET |
| `sheets.list_tables` | `spreadsheetId`, `sheetId` | List all tables on a sheet | low | LIST_SEARCH |
| `sheets.delete_table` | `spreadsheetId`, `sheetId`, `tableId` | Delete a table | high | WRITE_MODIFY |
| `sheets.update_table_range` | `spreadsheetId`, `sheetId`, `tableId`, `range`, `data` | Update data within a table range | medium | WRITE_MODIFY |
| `sheets.append_table_rows` | `spreadsheetId`, `sheetId`, `tableId`, `rows` | Append rows to a table | medium | WRITE_MODIFY |
| `sheets.group_rows` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex` | Group rows (collapsible outline) | medium | WRITE_MODIFY |
| `sheets.ungroup_all_rows` | `spreadsheetId`, `sheetId` | Remove all row grouping on a sheet | medium | WRITE_MODIFY |
| `sheets.insert_chart` | `spreadsheetId`, `sheetId`, `chartType`, `sourceRange`, `options?` | Insert a chart | medium | WRITE_MODIFY |
| `sheets.delete_chart` | `spreadsheetId`, `chartId` | Delete a chart | medium | WRITE_MODIFY |
| `sheets.add_conditional_formatting` | `spreadsheetId`, `range`, `rule` | Add a conditional formatting rule | medium | WRITE_MODIFY |
| `sheets.delete_conditional_formatting` | `spreadsheetId`, `sheetId`, `index` | Delete a conditional formatting rule by index | medium | WRITE_MODIFY |
| `sheets.get_conditional_formatting` | `spreadsheetId`, `sheetId` | List conditional formatting rules on a sheet | low | READ_GET |
| `sheets.set_dropdown_validation` | `spreadsheetId`, `range`, `values` | Set data validation dropdown on a range | medium | WRITE_MODIFY |
| `sheets.protect_range` | `spreadsheetId`, `range`, `description?`, `editors?` | Protect a range from editing (with optional editor list) | medium | WRITE_MODIFY |

## Tools Being Dropped

| Current Action ID | Reason |
|-------------------|--------|
| `sheets.get_spreadsheet` | Replaced by `sheets.get_spreadsheet_info` (same purpose, new ID) |
| `sheets.read_range` | Replaced by `sheets.read_spreadsheet` (same purpose, new ID, gains `format` param) |
| `sheets.read_multiple_ranges` | Subsumed by `sheets.batch_write` for reads; individual `read_spreadsheet` calls suffice |
| `sheets.write_range` | Replaced by `sheets.write_spreadsheet` (cleaner name) |
| `sheets.read_formatting` | Replaced by `sheets.read_cell_format` (same purpose, new ID) |

## Porting Translation

Same pattern as the Docs port (see `2026-04-23-google-workspace-docs-port-design.md`). Key differences:

- **Sheets API base URL:** `https://sheets.googleapis.com/v4/spreadsheets`
- **Drive API calls** for `list_spreadsheets`: `https://www.googleapis.com/drive/v3/files` with `mimeType='application/vnd.google-apps.spreadsheet'`
- **`batchUpdate` pattern:** many Sheets actions use `spreadsheets/{id}:batchUpdate` with request objects -- same REST pattern as current code
- The `googleSheetsApiHelpers.ts` functions (`a1ToRowCol`, etc.) are ported to `sheets-helpers.ts`
- The reference repo's Sheets tools are self-contained (no shared helper module like Docs), so most logic ports inline into the switch cases

## Files Changed

### Create
- `packages/plugin-google-workspace/src/actions/sheets-actions.ts` (rewrite with 37 new actions)
- `packages/plugin-google-workspace/src/actions/sheets-helpers.ts` (ported helper functions using fetch)

### Modify
- `packages/plugin-google-workspace/src/actions/labels-guard.ts` (update all four classification arrays for new Sheets action IDs)
- `packages/plugin-google-workspace/skills/google-sheets.md` (full rewrite)

### Delete
- `packages/plugin-google-workspace/src/actions/sheets-api.ts` (replaced by inline fetch in sheets-actions.ts + sheets-helpers.ts)
- `packages/plugin-google-workspace/src/actions/formatting.ts` (formatting logic moves into sheets-helpers.ts or inline into format_cells action)

## Skill Updates

`packages/plugin-google-workspace/skills/google-sheets.md` needs a full rewrite:

- New tool names and IDs throughout
- Document new capabilities: tables, charts, conditional formatting, validation, protection, row grouping
- Document sheet management: rename, duplicate, copy-to
- Document formatting: cell borders, column/row sizing, freeze panes, copy formatting
- Workflow guidance for structured tables vs raw ranges

## Migration / Breaking Changes

All 11 current `sheets.*` action IDs change. The labels-guard completeness test will enforce that all 37 new IDs are classified before the build passes.

Specific ID renames:
- `sheets.get_spreadsheet` -> `sheets.get_spreadsheet_info`
- `sheets.read_range` -> `sheets.read_spreadsheet`
- `sheets.read_multiple_ranges` -> removed
- `sheets.write_range` -> `sheets.write_spreadsheet`
- `sheets.append_rows` -> `sheets.append_rows` (same)
- `sheets.clear_range` -> `sheets.clear_range` (same)
- `sheets.create_spreadsheet` -> `sheets.create_spreadsheet` (same)
- `sheets.add_sheet` -> `sheets.add_sheet` (same)
- `sheets.delete_sheet` -> `sheets.delete_sheet` (same)
- `sheets.read_formatting` -> `sheets.read_cell_format`
- `sheets.format_cells` -> `sheets.format_cells` (same, but params change -- drops per-cell formats grid, uses reference repo's format schema)

The `formatting.ts` module's `cellFormatSchema`, `mergeSchema`, and related helpers are replaced by the reference repo's formatting approach. The `@valet/sdk` Zod schema types remain unchanged.
