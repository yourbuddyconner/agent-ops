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
