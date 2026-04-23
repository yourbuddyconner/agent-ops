# Google Workspace Sheets Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 11 sheets actions with 37 ported from the google-docs-mcp reference repo, adding sheet management, tables, charts, conditional formatting, validation, protection, row grouping, cell borders, column/row sizing, and freeze panes.
**Architecture:** A new `sheets-helpers.ts` provides A1 notation parsing, range normalization, sheet ID resolution, grid range building, and formatting utilities using raw `fetch()`. All 37 actions are implemented in `sheets-actions.ts` as cases in an `executeSheetsAction` switch. The reference repo's helpers are self-contained per tool, so most logic ports inline into switch cases with shared helpers extracted to `sheets-helpers.ts`.
**Tech Stack:** TypeScript, Cloudflare Workers, Google REST APIs, Zod, Vitest

---

## Task 1: Port sheets helpers (`sheets-helpers.ts`)

**Read first:**
- `/tmp/google-docs-mcp/src/googleSheetsApiHelpers.ts` (full file, 1028 lines)

**Create:** `packages/plugin-google-workspace/src/actions/sheets-helpers.ts`
**Delete (later, in Task 8):**
- `packages/plugin-google-workspace/src/actions/sheets-api.ts`
- `packages/plugin-google-workspace/src/actions/formatting.ts`

### Functions to port

Each function takes `token: string` as first param instead of `sheets: Sheets`. Translate `sheets.spreadsheets.*` to `fetch()`.

| Function | Reference Method | REST Translation |
|----------|-----------------|------------------|
| `a1ToRowCol(a1)` | Pure function | Port as-is |
| `rowColToA1(row, col)` | Pure function | Port as-is |
| `normalizeRange(range, sheetName?)` | Pure function | Port as-is |
| `parseRange(range)` | Pure function -- splits `Sheet1!A1:B2` into `{ sheetName, a1Range }` | Port as-is |
| `colLettersToIndex(col)` | Pure function | Port as-is |
| `parseA1ToGridRange(a1Range, sheetId)` | Pure function -- converts A1 to `GridRange` object | Port as-is |
| `hexToRgb(hex)` | Pure function | Port as-is |
| `resolveSheetId(token, spreadsheetId, sheetName?)` | `sheets.spreadsheets.get(...)` | `GET https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties` |
| `readRange(token, spreadsheetId, range, valueRenderOption?)` | `sheets.spreadsheets.values.get(...)` | `GET https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=${...}` |
| `writeRange(token, spreadsheetId, range, values, valueInputOption?)` | `sheets.spreadsheets.values.update(...)` | `PUT https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=${...}` |
| `appendValues(token, spreadsheetId, range, values, valueInputOption?)` | `sheets.spreadsheets.values.append(...)` | `POST https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=${...}&insertDataOption=INSERT_ROWS` |
| `clearRange(token, spreadsheetId, range)` | `sheets.spreadsheets.values.clear(...)` | `POST https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear` |
| `getSpreadsheetMetadata(token, spreadsheetId)` | `sheets.spreadsheets.get({ includeGridData: false })` | `GET https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=false` |
| `sheetsBatchUpdate(token, spreadsheetId, requests)` | `sheets.spreadsheets.batchUpdate(...)` | `POST https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate` body: `{ requests }` |
| `formatCells(token, spreadsheetId, range, format)` | Uses `resolveSheetId` + `parseA1ToGridRange` + `batchUpdate` with `repeatCell` | Compose from helpers |
| `resolveTableIdentifier(token, spreadsheetId, tableIdentifier)` | Uses `getSpreadsheetMetadata` to search tables | Port as-is but use fetch-based metadata |
| `listAllTables(token, spreadsheetId, sheetNameFilter?)` | Uses `getSpreadsheetMetadata` | Port as-is |
| `addConditionalFormatRule(token, spreadsheetId, ranges, conditionType, conditionValues, format)` | `batchUpdate` with `addConditionalFormatRule` | Compose from `sheetsBatchUpdate` |
| `setDropdownValidation(token, spreadsheetId, range, values?, strict?, inputMessage?)` | `batchUpdate` with `setDataValidation` | Compose from helpers |
| `setColumnWidths(token, spreadsheetId, sheetName, columnWidths)` | `batchUpdate` with `updateDimensionProperties` | Compose from helpers |
| `freezeRowsAndColumns(token, spreadsheetId, sheetName?, frozenRows?, frozenColumns?)` | `batchUpdate` with `updateSheetProperties` | Compose from helpers |

### Translation details for `sheetsBatchUpdate`

```
Reference:
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  return response.data;

Valet:
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    },
  );
  if (!res.ok) { ... handle errors ... }
  return await res.json();
```

### Error handling

All API helpers should return the `Response` object or throw, and the calling action code handles error translation to `{ success: false, error: message }`.

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port sheets helpers from reference repo

Port A1 notation parsing, range normalization, sheet ID resolution,
grid range building, formatting utilities, table helpers, and
conditional formatting helpers from google-docs-mcp reference repo.
Translates googleapis client calls to raw fetch() with Bearer token.
```

---

## Task 2: Port sheets actions -- core data (8 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/sheets/readSpreadsheet.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/writeSpreadsheet.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/appendSpreadsheetRows.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/createSpreadsheet.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/getSpreadsheetInfo.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/listGoogleSheets.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/batchWrite.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/clearSpreadsheetRange.ts`

**Replace:** `packages/plugin-google-workspace/src/actions/sheets-actions.ts` (start fresh, keeping the same export shape)

### Action definitions

**1. `sheets.read_spreadsheet`** -- riskLevel: `low`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range (e.g. "Sheet1!A1:D10")'),
  valueRenderOption: z.enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA']).optional(),
})
```
- REST: `GET https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=${...}`
- Uses `readRange()` from `sheets-helpers.ts`

**2. `sheets.write_spreadsheet`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range'),
  data: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('2D array of values'),
  valueInputOption: z.enum(['RAW', 'USER_ENTERED']).optional(),
})
```
- REST: `PUT https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=${...}`
- Uses `writeRange()` from `sheets-helpers.ts`

**3. `sheets.append_rows`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range to search for data'),
  data: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('2D array of rows'),
  valueInputOption: z.enum(['RAW', 'USER_ENTERED']).optional(),
})
```
- REST: `POST https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=${...}&insertDataOption=INSERT_ROWS`
- Uses `appendValues()` from `sheets-helpers.ts`

**4. `sheets.create_spreadsheet`** -- riskLevel: `medium`
```typescript
params: z.object({
  title: z.string().describe('Spreadsheet title'),
  sheetTitles: z.array(z.string()).optional().describe('Initial sheet names'),
})
```
- REST: `POST https://sheets.googleapis.com/v4/spreadsheets` body: `{ properties: { title }, sheets: [...] }`

**5. `sheets.get_spreadsheet_info`** -- riskLevel: `low`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
})
```
- REST: `GET https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties,sheets.properties`

**6. `sheets.list_spreadsheets`** -- riskLevel: `low`
```typescript
params: z.object({
  query: z.string().optional().describe('Search text'),
  maxResults: z.number().int().min(1).max(100).optional(),
})
```
- REST: `GET https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${query ? " and fullText contains '...'": ''}&fields=files(id,name,modifiedTime,webViewLink)&pageSize=${...}&supportsAllDrives=true&includeItemsFromAllDrives=true`
- Note: Uses Drive API, not Sheets API

**7. `sheets.batch_write`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  data: z.array(z.object({
    range: z.string().describe('A1 notation range'),
    values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  })).min(1).describe('Array of range+values pairs'),
  valueInputOption: z.enum(['RAW', 'USER_ENTERED']).optional(),
})
```
- REST: `POST https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate` body: `{ valueInputOption, data }`

**8. `sheets.clear_range`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range to clear'),
})
```
- REST: `POST https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`
- Uses `clearRange()` from `sheets-helpers.ts`

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port core sheets data actions (8 of 37)

Port read_spreadsheet, write_spreadsheet, append_rows, create_spreadsheet,
get_spreadsheet_info, list_spreadsheets, batch_write, and clear_range
from google-docs-mcp reference repo.
```

---

## Task 3: Port sheets actions -- sheet management (5 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/sheets/addSpreadsheetSheet.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/deleteSheet.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/renameSheet.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/duplicateSheet.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/copySheetTo.ts`

**Add to:** `packages/plugin-google-workspace/src/actions/sheets-actions.ts`

### Action definitions

**9. `sheets.add_sheet`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  title: z.string().describe('Sheet/tab title'),
})
```
- REST: `POST https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate` with `addSheet` request

**10. `sheets.delete_sheet`** -- riskLevel: `high`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetId: z.number().int().describe('Numeric sheet ID (from get_spreadsheet_info)'),
})
```
- REST: batchUpdate with `deleteSheet` request

**11. `sheets.rename_sheet`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetId: z.number().int().describe('Numeric sheet ID'),
  title: z.string().describe('New sheet title'),
})
```
- REST: batchUpdate with `updateSheetProperties` request, fields: `title`

**12. `sheets.duplicate_sheet`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetId: z.number().int().describe('Sheet ID to duplicate'),
  title: z.string().optional().describe('Title for the copy'),
})
```
- REST: batchUpdate with `duplicateSheet` request

**13. `sheets.copy_sheet_to`** -- riskLevel: `medium`
```typescript
params: z.object({
  sourceSpreadsheetId: z.string().describe('Source spreadsheet ID'),
  sheetId: z.number().int().describe('Sheet ID to copy'),
  destinationSpreadsheetId: z.string().describe('Target spreadsheet ID'),
})
```
- REST: `POST https://sheets.googleapis.com/v4/spreadsheets/${sourceSpreadsheetId}/sheets/${sheetId}:copyTo` body: `{ destinationSpreadsheetId }`

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port sheet management actions (5 of 37)

Port add_sheet, delete_sheet, rename_sheet, duplicate_sheet, and
copy_sheet_to from google-docs-mcp reference repo.
```

---

## Task 4: Port sheets actions -- cell formatting (9 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/sheets/formatCells.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/readCellFormat.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/copyFormatting.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/setColumnWidths.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/setRowHeights.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/autoResizeColumns.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/autoResizeRows.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/setCellBorders.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/freezeRowsAndColumns.ts`

**Add to:** `packages/plugin-google-workspace/src/actions/sheets-actions.ts`

### Action definitions

**14. `sheets.format_cells`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range'),
  format: z.object({
    backgroundColor: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional(),
    textFormat: z.object({
      foregroundColor: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional(),
      fontSize: z.number().optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
    }).optional(),
    horizontalAlignment: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional(),
    verticalAlignment: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional(),
    wrapStrategy: z.enum(['OVERFLOW_CELL', 'CLIP', 'WRAP']).optional(),
    numberFormat: z.object({ type: z.string(), pattern: z.string().optional() }).optional(),
  }).describe('Cell formatting properties'),
})
```
- Uses `formatCells()` from `sheets-helpers.ts`
- REST: batchUpdate with `repeatCell` request

**15. `sheets.read_cell_format`** -- riskLevel: `low`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range'),
})
```
- REST: `GET https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?ranges=${range}&fields=sheets.data.rowData.values.userEnteredFormat,sheets.merges`

**16. `sheets.copy_formatting`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sourceRange: z.string().describe('A1 notation source range'),
  destinationRange: z.string().describe('A1 notation destination range'),
})
```
- Read source formatting, then apply to destination via batchUpdate with `repeatCell`
- REST: GET metadata for source, then batchUpdate for destination

**17. `sheets.set_column_widths`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name (default: first sheet)'),
  columnWidths: z.array(z.object({
    column: z.string().describe('Column letter(s) or range, e.g. "A" or "A:C"'),
    width: z.number().describe('Width in pixels'),
  })).min(1),
})
```
- Uses `setColumnWidths()` from `sheets-helpers.ts`
- REST: batchUpdate with `updateDimensionProperties` requests

**18. `sheets.set_row_heights`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name (default: first sheet)'),
  rowHeights: z.array(z.object({
    startRow: z.number().int().describe('Start row (1-based)'),
    endRow: z.number().int().describe('End row (1-based, inclusive)'),
    height: z.number().describe('Height in pixels'),
  })).min(1),
})
```
- REST: batchUpdate with `updateDimensionProperties` for ROWS dimension

**19. `sheets.auto_resize_columns`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name'),
  startColumn: z.string().describe('Start column letter, e.g. "A"'),
  endColumn: z.string().describe('End column letter, e.g. "D"'),
})
```
- REST: batchUpdate with `autoResizeDimensions` request for COLUMNS

**20. `sheets.auto_resize_rows`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name'),
  startRow: z.number().int().describe('Start row (1-based)'),
  endRow: z.number().int().describe('End row (1-based, inclusive)'),
})
```
- REST: batchUpdate with `autoResizeDimensions` request for ROWS

**21. `sheets.set_cell_borders`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range'),
  borders: z.object({
    top: z.object({ style: z.string(), color: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional() }).optional(),
    bottom: z.object({ style: z.string(), color: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional() }).optional(),
    left: z.object({ style: z.string(), color: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional() }).optional(),
    right: z.object({ style: z.string(), color: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional() }).optional(),
    innerHorizontal: z.object({ style: z.string(), color: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional() }).optional(),
    innerVertical: z.object({ style: z.string(), color: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional() }).optional(),
  }).describe('Border styles (style values: DOTTED, DASHED, SOLID, SOLID_MEDIUM, SOLID_THICK, DOUBLE)'),
})
```
- REST: batchUpdate with `updateBorders` request

**22. `sheets.freeze_rows_and_columns`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name'),
  frozenRowCount: z.number().int().min(0).optional().describe('Number of rows to freeze'),
  frozenColumnCount: z.number().int().min(0).optional().describe('Number of columns to freeze'),
})
```
- Uses `freezeRowsAndColumns()` from `sheets-helpers.ts`
- REST: batchUpdate with `updateSheetProperties` for gridProperties

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port cell formatting sheets actions (9 of 37)

Port format_cells, read_cell_format, copy_formatting, set_column_widths,
set_row_heights, auto_resize_columns, auto_resize_rows, set_cell_borders,
and freeze_rows_and_columns from google-docs-mcp reference repo.
```

---

## Task 5: Port sheets actions -- tables (6 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/sheets/createTable.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/getTable.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/listTables.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/deleteTable.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/updateTableRange.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/appendTableRows.ts`

**Add to:** `packages/plugin-google-workspace/src/actions/sheets-actions.ts`

### Action definitions

**23. `sheets.create_table`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name (default: first sheet)'),
  name: z.string().describe('Table name'),
  range: z.string().describe('A1 notation range for the table'),
  columns: z.array(z.string()).optional().describe('Column header names'),
})
```
- Uses `createTableHelper()` from `sheets-helpers.ts`
- REST: batchUpdate with `addTable` request

**24. `sheets.get_table`** -- riskLevel: `low`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  tableIdentifier: z.string().describe('Table ID or name'),
})
```
- Uses `resolveTableIdentifier()` from `sheets-helpers.ts`

**25. `sheets.list_tables`** -- riskLevel: `low`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Filter by sheet name'),
})
```
- Uses `listAllTables()` from `sheets-helpers.ts`

**26. `sheets.delete_table`** -- riskLevel: `high`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  tableId: z.string().describe('Table ID'),
})
```
- Uses `deleteTableHelper()` from `sheets-helpers.ts`
- REST: batchUpdate with `deleteTable` request

**27. `sheets.update_table_range`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  tableId: z.string().describe('Table ID'),
  range: z.string().describe('New A1 notation range for the table'),
})
```
- Uses `updateTableRangeHelper()` from `sheets-helpers.ts`

**28. `sheets.append_table_rows`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  tableId: z.string().describe('Table ID'),
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('2D array of row values'),
})
```
- Uses `appendToTableHelper()` from `sheets-helpers.ts`

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port table sheets actions (6 of 37)

Port create_table, get_table, list_tables, delete_table,
update_table_range, and append_table_rows from reference repo.
```

---

## Task 6: Port sheets actions -- advanced (9 actions)

**Read first:**
- `/tmp/google-docs-mcp/src/tools/sheets/groupRows.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/ungroupAllRows.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/insertChart.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/deleteChart.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/addConditionalFormatting.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/deleteConditionalFormatting.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/getConditionalFormatting.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/setDropdownValidation.ts`
- `/tmp/google-docs-mcp/src/tools/sheets/protectRange.ts`

**Add to:** `packages/plugin-google-workspace/src/actions/sheets-actions.ts`

### Action definitions

**29. `sheets.group_rows`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name'),
  startRow: z.number().int().min(1).describe('Start row (1-based)'),
  endRow: z.number().int().min(1).describe('End row (1-based, inclusive)'),
})
```
- REST: batchUpdate with `addDimensionGroup` request (dimension: ROWS, startIndex: startRow-1, endIndex: endRow)

**30. `sheets.ungroup_all_rows`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name'),
})
```
- First GET metadata to find all row groups, then batchUpdate with `deleteDimensionGroup` for each

**31. `sheets.insert_chart`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name'),
  chartType: z.enum(['BAR', 'LINE', 'AREA', 'COLUMN', 'SCATTER', 'COMBO', 'PIE']).describe('Chart type'),
  sourceRange: z.string().describe('A1 notation data range'),
  title: z.string().optional().describe('Chart title'),
  position: z.object({
    anchorCell: z.string().optional().describe('A1 notation anchor cell for chart placement'),
  }).optional(),
})
```
- REST: batchUpdate with `addChart` request
- Build `basicChart` spec from chartType and sourceRange

**32. `sheets.delete_chart`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  chartId: z.number().int().describe('Chart ID (from get_spreadsheet_info)'),
})
```
- REST: batchUpdate with `deleteEmbeddedObject` request

**33. `sheets.add_conditional_formatting`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range'),
  conditionType: z.string().describe('Condition type (e.g. NUMBER_GREATER, TEXT_CONTAINS, CUSTOM_FORMULA)'),
  conditionValues: z.array(z.string()).describe('Condition values'),
  format: z.object({
    backgroundColor: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional(),
    textFormat: z.object({
      foregroundColor: z.object({ red: z.number(), green: z.number(), blue: z.number() }).optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
    }).optional(),
  }).describe('Format to apply when condition is met'),
})
```
- Uses `addConditionalFormatRule()` from `sheets-helpers.ts`

**34. `sheets.delete_conditional_formatting`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetId: z.number().int().describe('Sheet ID'),
  index: z.number().int().min(0).describe('Rule index (0-based, from get_conditional_formatting)'),
})
```
- REST: batchUpdate with `deleteConditionalFormatRule` request

**35. `sheets.get_conditional_formatting`** -- riskLevel: `low`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  sheetName: z.string().optional().describe('Sheet name'),
})
```
- REST: `GET https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties,conditionalFormats)`
- Filter by sheet name if provided

**36. `sheets.set_dropdown_validation`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range'),
  values: z.array(z.string()).optional().describe('Dropdown values (omit to clear)'),
  strict: z.boolean().optional().describe('Reject invalid input (default: true)'),
  inputMessage: z.string().optional().describe('Help text shown on cell selection'),
})
```
- Uses `setDropdownValidation()` from `sheets-helpers.ts`

**37. `sheets.protect_range`** -- riskLevel: `medium`
```typescript
params: z.object({
  spreadsheetId: z.string().describe('Spreadsheet ID'),
  range: z.string().describe('A1 notation range to protect'),
  description: z.string().optional().describe('Protection description'),
  editors: z.array(z.string()).optional().describe('Email addresses of users who can edit'),
  warningOnly: z.boolean().optional().describe('Show warning instead of blocking (default: false)'),
})
```
- REST: batchUpdate with `addProtectedRange` request

### Test step
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): port advanced sheets actions (9 of 37)

Port group_rows, ungroup_all_rows, insert_chart, delete_chart,
add_conditional_formatting, delete_conditional_formatting,
get_conditional_formatting, set_dropdown_validation, and protect_range
from google-docs-mcp reference repo.
```

---

## Task 7: Update labels guard + aggregator + skill

**Modify:** `packages/plugin-google-workspace/src/actions/labels-guard.ts`

### Replace sheets classification arrays

All 37 sheets action IDs must be classified. The complete assignment:

**LIST_SEARCH:**
- `sheets.list_spreadsheets`
- `sheets.list_tables`
- `sheets.get_conditional_formatting`

**READ_GET:**
- `sheets.read_spreadsheet`
- `sheets.get_spreadsheet_info`
- `sheets.read_cell_format`
- `sheets.get_table`

**WRITE_MODIFY:**
- `sheets.write_spreadsheet`
- `sheets.append_rows`
- `sheets.batch_write`
- `sheets.clear_range`
- `sheets.add_sheet`
- `sheets.delete_sheet`
- `sheets.rename_sheet`
- `sheets.duplicate_sheet`
- `sheets.copy_sheet_to`
- `sheets.format_cells`
- `sheets.copy_formatting`
- `sheets.set_column_widths`
- `sheets.set_row_heights`
- `sheets.auto_resize_columns`
- `sheets.auto_resize_rows`
- `sheets.set_cell_borders`
- `sheets.freeze_rows_and_columns`
- `sheets.delete_table`
- `sheets.update_table_range`
- `sheets.append_table_rows`
- `sheets.group_rows`
- `sheets.ungroup_all_rows`
- `sheets.insert_chart`
- `sheets.delete_chart`
- `sheets.add_conditional_formatting`
- `sheets.delete_conditional_formatting`
- `sheets.set_dropdown_validation`
- `sheets.protect_range`

**CREATE:**
- `sheets.create_spreadsheet`
- `sheets.create_table`

### Update `extractFileId`

Sheets actions use `spreadsheetId` param -- this is already handled in the existing `extractFileId`. No change needed.

**Modify:** `packages/plugin-google-workspace/skills/google-sheets.md`
- Full rewrite for 37-action tool set
- Document new capabilities: tables, charts, conditional formatting, validation, protection, row grouping
- Document sheet management: rename, duplicate, copy-to
- Document formatting: cell borders, column/row sizing, freeze panes, copy formatting
- Workflow guidance: structured tables vs raw ranges

### Test step
- Run `cd packages/plugin-google-workspace && pnpm test` (labels-guard completeness)
- Run `cd packages/plugin-google-workspace && pnpm typecheck`

### Commit
```
feat(google-workspace): update labels guard and skill for 37 sheets actions

Update classification arrays in labels-guard.ts for new sheets action IDs.
Rewrite google-sheets.md skill with table, chart, formatting, and
validation workflows.
```

---

## Task 8: Clean up + verify

**Delete:**
- `packages/plugin-google-workspace/src/actions/sheets-api.ts`
- `packages/plugin-google-workspace/src/actions/formatting.ts`

**Verify:**
- `pnpm typecheck` from repo root passes
- `cd packages/plugin-google-workspace && pnpm test` passes (labels-guard completeness)
- No remaining imports from deleted files
- `make generate-registries` succeeds (plugin still exports correctly)

### Commit
```
chore(google-workspace): remove old sheets files

Delete sheets-api.ts and formatting.ts, replaced by sheets-helpers.ts
and inline formatting logic in sheets-actions.ts.
```
