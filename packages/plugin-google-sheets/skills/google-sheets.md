---
name: google-sheets
description: How to use Google Sheets tools effectively — reading/writing ranges, A1 notation, multi-range reads, spreadsheet structure, and common data patterns.
---

# Google Sheets

You have full read/write access to Google Sheets through the `google-sheets` plugin.

## Available Tools

### Reading

- **`sheets.get_spreadsheet`** — Get spreadsheet metadata: title, sheet names, grid dimensions. Always start here to understand the spreadsheet structure.
- **`sheets.read_range`** — Read a single range of cells (returns 2D array of values).
- **`sheets.read_multiple_ranges`** — Read multiple ranges in one call (more efficient than multiple single reads).

### Writing

- **`sheets.write_range`** — Write values to a specific range (overwrites existing data).
- **`sheets.append_rows`** — Append rows after the last row with data. Use for adding entries to tables/logs.
- **`sheets.clear_range`** — Clear values from a range without deleting cells.

### Spreadsheet Management

- **`sheets.create_spreadsheet`** — Create a new spreadsheet with a title and optional sheet names.
- **`sheets.add_sheet`** — Add a new sheet (tab) to an existing spreadsheet.
- **`sheets.delete_sheet`** — Delete a sheet by its numeric ID (use `get_spreadsheet` to find sheet IDs).

### Formatting

- **`sheets.read_formatting`** — Read cell formatting (colors, bold, borders, alignment) from a range. Always use this before writing to a styled spreadsheet so you can match existing styles.
- **`sheets.format_cells`** — Apply formatting to a range. Use `format` for uniform styling across all cells, or `formats` for per-cell control. Can also merge/unmerge cells.

**`sheets.write_range`** and **`sheets.append_rows`** also accept optional `format` or `formats` parameters to write values and styling in a single call.

## A1 Notation

All range parameters use A1 notation:

| Notation | Meaning |
|---|---|
| `Sheet1!A1:C10` | Cells A1 through C10 on Sheet1 |
| `Sheet1!A:C` | Entire columns A through C |
| `Sheet1!1:5` | Entire rows 1 through 5 |
| `A1:C10` | Range on the first sheet (omitting sheet name) |
| `Sheet1!A1` | Single cell |
| `'Sheet Name With Spaces'!A1:B2` | Quote sheet names with spaces |

## Common Patterns

### Understand Before Modifying

Always check the spreadsheet structure first:

```
1. sheets.get_spreadsheet({ spreadsheetId: "..." })     // see sheet names, dimensions
2. sheets.read_range({ spreadsheetId: "...", range: "Sheet1!A1:Z1" })  // read headers
3. sheets.read_range({ spreadsheetId: "...", range: "Sheet1!A1:Z10" }) // read sample data
4. sheets.write_range({ ... })  // now write with confidence
```

### Reading a Full Table

Read the header row first to understand columns, then read the data:

```
1. sheets.read_range({ range: "Sheet1!1:1" })           // headers
2. sheets.read_range({ range: "Sheet1!A2:Z" })          // all data rows
```

Or read everything at once:

```
sheets.read_range({ range: "Sheet1!A1:Z" })
```

### Multi-Range Reads

When you need data from different parts of a spreadsheet, use a single `read_multiple_ranges` call:

```
sheets.read_multiple_ranges({
  spreadsheetId: "...",
  ranges: ["Sheet1!A1:D10", "Summary!A1:B5", "Sheet1!F1:F10"]
})
```

### Appending Data

Use `append_rows` to add new rows to the end of a table. The range should cover the table area — Sheets finds the last row automatically:

```
sheets.append_rows({
  spreadsheetId: "...",
  range: "Sheet1!A:D",
  values: [
    ["2026-03-15", "New item", 42, "active"],
    ["2026-03-15", "Another item", 17, "pending"]
  ]
})
```

### Writing Data

Values are always a 2D array (rows of cells):

```
sheets.write_range({
  spreadsheetId: "...",
  range: "Sheet1!A1:C3",
  values: [
    ["Name", "Score", "Status"],
    ["Alice", 95, "Pass"],
    ["Bob", 82, "Pass"]
  ]
})
```

### Creating a New Spreadsheet

```
sheets.create_spreadsheet({
  title: "Q1 2026 Budget",
  sheetNames: ["Overview", "Monthly", "Categories"]
})
```

## Tips

- **Check structure first**: Always call `get_spreadsheet` before writing to understand the sheet names and dimensions.
- **Use `read_multiple_ranges`** when you need data from several places — it's one API call instead of many.
- **Append vs Write**: Use `append_rows` to add to the end of a table. Use `write_range` to overwrite a specific location.
- **Empty cells**: Empty cells appear as empty strings `""` in read results. When writing, use `""` or `null` for empty cells.
- **Sheet IDs vs Names**: Most tools use sheet names in A1 notation. `delete_sheet` uses numeric sheet IDs (found in `get_spreadsheet` metadata).

## Formatting

### Preserving Existing Styles

When editing a spreadsheet that already has styling, always match the existing formatting:

1. Read formatting from a reference row (usually the row above where you're inserting, or a representative data row):
   ```
   sheets.read_formatting({ spreadsheetId: "...", range: "Sheet1!A5:F5" })
   ```

2. If all columns share the same style, pass it as a uniform format:
   ```
   sheets.append_rows({
     spreadsheetId: "...",
     range: "Sheet1!A:F",
     values: [["New item", "Description", ...]],
     format: <format from step 1's formats[0][0]>
   })
   ```

3. If columns have different styles (e.g., column A is bold, column C has a color), use per-cell formatting to preserve column-specific styles:
   ```
   sheets.append_rows({
     spreadsheetId: "...",
     range: "Sheet1!A:F",
     values: [["New item", "Description", ...]],
     formats: [<formats[0] from step 1>]
   })
   ```

The `read_formatting` response returns normalized CellFormat objects that can be passed directly to write/append/format actions.

**Key rule:** When appending to a table, copy the format from the last data row — not the header or a section divider.

### Color Reference

Colors use RGB floats from 0 to 1. Common values:

| Color | Value |
|-------|-------|
| White | `{ red: 1, green: 1, blue: 1 }` |
| Black | `{ red: 0, green: 0, blue: 0 }` |
| Light gray (subtle bg) | `{ red: 0.95, green: 0.95, blue: 0.95 }` |
| Medium gray (borders) | `{ red: 0.7, green: 0.7, blue: 0.7 }` |
| Dark gray (header bg) | `{ red: 0.2, green: 0.2, blue: 0.2 }` |
| Light green | `{ red: 0.85, green: 0.95, blue: 0.85 }` |
| Light blue | `{ red: 0.85, green: 0.92, blue: 1 }` |
| Light yellow | `{ red: 1, green: 0.97, blue: 0.85 }` |
| Red (error/alert) | `{ red: 0.9, green: 0.2, blue: 0.2 }` |
| Green (success) | `{ red: 0.2, green: 0.66, blue: 0.33 }` |
| Blue (links/accent) | `{ red: 0.16, green: 0.38, blue: 0.71 }` |
| White text | `foregroundColor: { red: 1, green: 1, blue: 1 }` |

### Creating Well-Formatted Spreadsheets

**Professional header row:**
```
sheets.write_range({
  spreadsheetId: "...",
  range: "Sheet1!A1:D1",
  values: [["Name", "Role", "Status", "Score"]],
  format: {
    backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
    textFormat: {
      bold: true,
      foregroundColor: { red: 1, green: 1, blue: 1 },
      fontSize: 11
    },
    horizontalAlignment: "LEFT",
    borders: {
      bottom: { style: "SOLID_MEDIUM", color: { red: 0.4, green: 0.4, blue: 0.4 } }
    }
  }
})
```

**Section divider row** (dark background spanning all columns):
```
sheets.write_range({
  spreadsheetId: "...",
  range: "Sheet1!A10:D10",
  values: [["SECTION TITLE", "", "", ""]],
  format: {
    backgroundColor: { red: 0.25, green: 0.3, blue: 0.2 },
    textFormat: {
      bold: true,
      foregroundColor: { red: 1, green: 1, blue: 1 },
      fontSize: 11
    }
  }
})
```

**Alternating row colors** for readability:
```
// After writing data rows, apply striped background:
// Odd rows (1, 3, 5...): light gray
sheets.format_cells({
  spreadsheetId: "...",
  range: "Sheet1!A2:D2",
  format: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } }
})
// Even rows (2, 4, 6...): white (or skip — white is default)
```

**Standard data table recipe:**
1. Write header row with formatting (bold, dark bg, white text, bottom border)
2. Write data rows with `write_range` (values only or with per-row alternating colors)
3. Optionally apply a bottom border on the last data row to close the table

### Formatting Properties Reference

**CellFormat fields:**

| Property | Type | Example |
|----------|------|---------|
| `backgroundColor` | Color | `{ red: 0.95, green: 0.95, blue: 0.95 }` |
| `textFormat.bold` | boolean | `true` |
| `textFormat.italic` | boolean | `true` |
| `textFormat.strikethrough` | boolean | `true` |
| `textFormat.underline` | boolean | `true` |
| `textFormat.fontSize` | number | `12` |
| `textFormat.fontFamily` | string | `"Arial"` |
| `textFormat.foregroundColor` | Color | `{ red: 0, green: 0, blue: 0 }` |
| `horizontalAlignment` | enum | `"LEFT"`, `"CENTER"`, `"RIGHT"` |
| `verticalAlignment` | enum | `"TOP"`, `"MIDDLE"`, `"BOTTOM"` |
| `wrapStrategy` | enum | `"OVERFLOW_CELL"`, `"CLIP"`, `"WRAP"` |
| `numberFormat.type` | enum | `"NUMBER"`, `"CURRENCY"`, `"PERCENT"`, `"DATE"` |
| `numberFormat.pattern` | string | `"#,##0.00"`, `"yyyy-mm-dd"` |
| `borders.top` | Border | `{ style: "SOLID", color: { red: 0 } }` |
| `borders.bottom` | Border | `{ style: "SOLID_MEDIUM" }` |
| `borders.left` | Border | `{ style: "DASHED" }` |
| `borders.right` | Border | `{ style: "DOUBLE" }` |

**Border styles:** `NONE`, `SOLID`, `SOLID_MEDIUM`, `SOLID_THICK`, `DASHED`, `DOTTED`, `DOUBLE`

### Merge Coordinates

Merges use 0-based row and column indices (not A1 notation):
- Column A = 0, B = 1, ..., Z = 25, AA = 26
- Row 1 = 0, Row 2 = 1, etc.
- `endRowIndex` and `endColumnIndex` are exclusive (same as Python slice notation)

Example: merge A1:C1 on the first sheet:
```
{ sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }
```

### Formatting Best Practices

- **Always read before writing to styled sheets.** Use `read_formatting` on a nearby row and pass the result to `write_range` or `append_rows`.
- **Use `format` (uniform) when all cells share the same style.** Use `formats` (per-cell) when columns have different formatting.
- **Only set properties you intend to change.** Omitted properties are preserved — you don't need to specify every field.
- **For borders, set one side only.** The cell below doesn't also need a `top` border if the cell above has a `bottom` border.
- **Use `write_range` with formatting for one-call writes.** This avoids a window where data appears without styling.
