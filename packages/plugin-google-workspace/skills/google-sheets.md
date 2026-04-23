---
name: google-sheets
description: How to use Google Sheets tools effectively -- 37 actions covering data, sheet management, formatting, tables, charts, conditional formatting, validation, and protection.
---

# Google Sheets

You have full read/write access to Google Sheets through the Google Workspace integration with 37 tools.

## Available Tools

### Reading Data

- **`sheets.read_spreadsheet`** -- Read cell values from a range using A1 notation (returns 2D array).
- **`sheets.get_spreadsheet_info`** -- Get spreadsheet metadata: title, URL, sheet names, dimensions, sheet IDs. Always start here.
- **`sheets.list_spreadsheets`** -- List spreadsheets in Drive, optionally filtered by name.

### Writing Data

- **`sheets.write_spreadsheet`** -- Write values to a specific range (overwrites existing data).
- **`sheets.append_rows`** -- Append rows after the last row with data. Use for adding entries to tables/logs.
- **`sheets.batch_write`** -- Write data to multiple ranges in a single API call (more efficient for bulk updates).
- **`sheets.clear_range`** -- Clear values from a range without deleting cells (formatting preserved).
- **`sheets.create_spreadsheet`** -- Create a new spreadsheet with a title and optional sheet names.

### Sheet Management

- **`sheets.add_sheet`** -- Add a new sheet/tab to an existing spreadsheet.
- **`sheets.delete_sheet`** -- Delete a sheet by its numeric ID (use `get_spreadsheet_info` to find sheet IDs).
- **`sheets.rename_sheet`** -- Rename a sheet/tab.
- **`sheets.duplicate_sheet`** -- Duplicate a sheet within a spreadsheet (copies values, formulas, formatting).
- **`sheets.copy_sheet_to`** -- Copy a sheet from one spreadsheet to another.

### Cell Formatting

- **`sheets.format_cells`** -- Apply formatting to a range: bold, italic, font size, colors, alignment, number format, wrap strategy.
- **`sheets.read_cell_format`** -- Read formatting/style of cells (bold, colors, borders, alignment, number format).
- **`sheets.copy_formatting`** -- Copy formatting (not values) from a source range to a destination range.
- **`sheets.set_column_widths`** -- Set column widths in pixels for one or more columns.
- **`sheets.set_row_heights`** -- Set fixed pixel height for row ranges.
- **`sheets.auto_resize_columns`** -- Auto-resize columns to fit their content.
- **`sheets.auto_resize_rows`** -- Auto-resize rows to fit their content.
- **`sheets.set_cell_borders`** -- Set borders on a range (each side independently: top, bottom, left, right, innerHorizontal, innerVertical).
- **`sheets.freeze_rows_and_columns`** -- Pin rows/columns so they stay visible when scrolling.

### Tables

- **`sheets.create_table`** -- Create a named table with structured columns.
- **`sheets.get_table`** -- Get table details (columns, range, properties).
- **`sheets.list_tables`** -- List all tables in a spreadsheet.
- **`sheets.delete_table`** -- Delete a table (optionally clear data too).
- **`sheets.update_table_range`** -- Modify a table's dimensions by updating its range.
- **`sheets.append_table_rows`** -- Append rows to a table using table-aware insertion.

### Charts

- **`sheets.insert_chart`** -- Insert a chart (BAR, LINE, AREA, COLUMN, SCATTER, COMBO, PIE) with configurable data range and position.
- **`sheets.delete_chart`** -- Delete a chart by its chart ID.

### Conditional Formatting

- **`sheets.add_conditional_formatting`** -- Add a conditional formatting rule (NUMBER_GREATER, TEXT_CONTAINS, CUSTOM_FORMULA, BLANK, NOT_BLANK, etc.).
- **`sheets.delete_conditional_formatting`** -- Delete a conditional formatting rule by index.
- **`sheets.get_conditional_formatting`** -- List all conditional formatting rules for a sheet.

### Data Validation

- **`sheets.set_dropdown_validation`** -- Add or remove dropdown lists on a range. Omit values to clear.

### Protection

- **`sheets.protect_range`** -- Lock a range or entire sheet to prevent accidental edits. Supports warning-only mode.

### Row Grouping

- **`sheets.group_rows`** -- Create collapsible row groups.
- **`sheets.ungroup_all_rows`** -- Remove all row groupings from a sheet.

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
1. sheets.get_spreadsheet_info({ spreadsheetId: "..." })
2. sheets.read_spreadsheet({ spreadsheetId: "...", range: "Sheet1!A1:Z1" })  // headers
3. sheets.read_spreadsheet({ spreadsheetId: "...", range: "Sheet1!A1:Z10" }) // sample data
4. sheets.write_spreadsheet({ ... })  // now write with confidence
```

### Appending Data

Use `append_rows` to add rows to the end of a table:

```
sheets.append_rows({
  spreadsheetId: "...",
  range: "Sheet1!A:D",
  data: [
    ["2026-03-15", "New item", 42, "active"],
    ["2026-03-15", "Another item", 17, "pending"]
  ]
})
```

### Batch Writing

When updating multiple ranges, use `batch_write` for efficiency:

```
sheets.batch_write({
  spreadsheetId: "...",
  data: [
    { range: "Sheet1!A1:B1", values: [["Header1", "Header2"]] },
    { range: "Sheet2!A1:A3", values: [["X"], ["Y"], ["Z"]] }
  ]
})
```

### Working with Tables

Tables provide structured data with named columns. Use tables for data that needs column-level operations:

```
1. sheets.create_table({ spreadsheetId: "...", name: "Sales", range: "Sheet1!A1:D10", columns: ["Date", "Product", "Qty", "Total"] })
2. sheets.append_table_rows({ spreadsheetId: "...", tableId: "...", values: [["2026-04-01", "Widget", 5, 25.00]] })
3. sheets.list_tables({ spreadsheetId: "..." })  // see all tables
```

### Formatting

Apply formatting after writing data:

```
sheets.format_cells({
  spreadsheetId: "...",
  range: "Sheet1!A1:D1",
  format: {
    backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11 },
    horizontalAlignment: "LEFT"
  }
})
```

Read existing formatting to match styles:

```
sheets.read_cell_format({ spreadsheetId: "...", range: "Sheet1!A5:F5" })
```

Copy formatting from one range to another:

```
sheets.copy_formatting({
  spreadsheetId: "...",
  sourceRange: "Sheet1!A1:D1",
  destinationRange: "Sheet1!A10:D10"
})
```

### Charts

Insert a chart from data:

```
sheets.insert_chart({
  spreadsheetId: "...",
  chartType: "BAR",
  sourceRange: "Sheet1!A1:C10",
  title: "Sales by Region"
})
```

### Conditional Formatting

Highlight cells meeting conditions:

```
sheets.add_conditional_formatting({
  spreadsheetId: "...",
  range: "Sheet1!C2:C100",
  conditionType: "NUMBER_GREATER",
  conditionValues: ["100"],
  format: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 } }
})
```

Use `CUSTOM_FORMULA` for complex conditions:

```
sheets.add_conditional_formatting({
  spreadsheetId: "...",
  range: "Sheet1!A2:D100",
  conditionType: "CUSTOM_FORMULA",
  conditionValues: ["=$D2>1000"],
  format: { textFormat: { bold: true } }
})
```

### Dropdown Validation

Create dropdown lists:

```
sheets.set_dropdown_validation({
  spreadsheetId: "...",
  range: "Sheet1!B2:B100",
  values: ["Open", "In Progress", "Done"],
  strict: true,
  inputMessage: "Select a status"
})
```

### Protection

Lock header rows:

```
sheets.protect_range({
  spreadsheetId: "...",
  range: "Sheet1!1:1",
  description: "Header row - do not edit",
  warningOnly: false
})
```

## Tips

- **Check structure first**: Always call `get_spreadsheet_info` before writing.
- **Append vs Write**: Use `append_rows` to add to the end. Use `write_spreadsheet` to overwrite a specific location.
- **Sheet IDs vs Names**: Most tools use sheet names in A1 notation. `delete_sheet`, `rename_sheet`, `duplicate_sheet` use numeric sheet IDs (from `get_spreadsheet_info`).
- **Empty cells**: Empty cells appear as `""`. When writing, use `""` or `null`.
- **Border styles**: SOLID, SOLID_MEDIUM, SOLID_THICK, DASHED, DOTTED, DOUBLE, NONE.
- **Colors**: RGB floats from 0 to 1. Black = `{red:0, green:0, blue:0}`, White = `{red:1, green:1, blue:1}`.
- **Hex colors in borders**: `set_cell_borders` accepts hex strings like `"#FF0000"` for color.
