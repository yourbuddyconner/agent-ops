/**
 * Shared helpers for Google Sheets actions.
 *
 * Ported from google-docs-mcp reference repo (googleSheetsApiHelpers.ts).
 * All API helpers use raw fetch() with Bearer token instead of googleapis client.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ─── Low-Level Fetch ───────────────────────────────────────────────────────

/** Stateless authenticated fetch against the Sheets API v4. */
export async function sheetsFetch(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${SHEETS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/** Build a descriptive error from a failed Sheets API response. */
export async function sheetsError(res: Response): Promise<{ success: false; error: string }> {
  let detail = '';
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    detail = json?.error?.message || body.slice(0, 200);
  } catch {
    detail = res.statusText;
  }
  return { success: false, error: `Sheets API ${res.status}: ${detail}` };
}

// ─── Pure A1 Notation Utilities ────────────────────────────────────────────

/**
 * Convert A1 notation to 0-based row/col indices.
 * Example: "A1" -> {row: 0, col: 0}, "B2" -> {row: 1, col: 1}
 */
export function a1ToRowCol(a1: string): { row: number; col: number } {
  const match = a1.match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new Error(`Invalid A1 notation: ${a1}`);
  const row = parseInt(match[2], 10) - 1;
  let col = 0;
  const colStr = match[1].toUpperCase();
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  return { row, col: col - 1 };
}

/**
 * Convert 0-based row/col indices to A1 notation.
 * Example: (0, 0) -> "A1", (1, 1) -> "B2"
 */
export function rowColToA1(row: number, col: number): string {
  let colStr = '';
  let colNum = col + 1;
  while (colNum > 0) {
    colNum -= 1;
    colStr = String.fromCharCode(65 + (colNum % 26)) + colStr;
    colNum = Math.floor(colNum / 26);
  }
  return `${colStr}${row + 1}`;
}

/**
 * Convert column letters to a 0-based index.
 * Example: "A" -> 0, "B" -> 1, "Z" -> 25, "AA" -> 26
 */
export function colLettersToIndex(col: string): number {
  let index = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Convert a 0-based column index to column letters.
 * Example: 0 -> "A", 25 -> "Z", 26 -> "AA"
 */
export function colIndexToLetters(index: number): string {
  let s = '';
  let i = index;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

/**
 * Parse an A1 range string to extract sheet name and cell range.
 * Returns {sheetName, a1Range} where a1Range is just the cell part.
 */
export function parseRange(range: string): { sheetName: string | null; a1Range: string } {
  const idx = range.indexOf('!');
  if (idx !== -1) {
    return {
      sheetName: range.slice(0, idx).replace(/^'|'$/g, ''),
      a1Range: range.slice(idx + 1),
    };
  }
  return { sheetName: null, a1Range: range };
}

/** Normalize a range to include a sheet name. */
export function normalizeRange(range: string, sheetName?: string): string {
  if (range.includes('!')) return range;
  if (sheetName) return `${sheetName}!${range}`;
  return `Sheet1!${range}`;
}

// ─── Grid Range ────────────────────────────────────────────────────────────

export interface GridRange {
  sheetId: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

/**
 * Parse an A1-notation cell range into a GridRange object.
 * Supports standard ("A1:B2"), whole-row ("1:3"), and whole-column ("A:C").
 */
export function parseA1ToGridRange(a1Range: string, sheetId: number): GridRange {
  // Whole-row pattern: "1:3" or "1"
  const rowOnlyMatch = a1Range.match(/^(\d+)(?::(\d+))?$/);
  if (rowOnlyMatch) {
    const startRow = parseInt(rowOnlyMatch[1], 10) - 1;
    const endRow = rowOnlyMatch[2] ? parseInt(rowOnlyMatch[2], 10) : startRow + 1;
    return { sheetId, startRowIndex: startRow, endRowIndex: endRow };
  }

  // Whole-column pattern: "A:C" or "A"
  const colOnlyMatch = a1Range.match(/^([A-Z]+)(?::([A-Z]+))?$/i);
  if (colOnlyMatch && !/\d/.test(a1Range)) {
    const startCol = colLettersToIndex(colOnlyMatch[1]);
    const endCol = colOnlyMatch[2] ? colLettersToIndex(colOnlyMatch[2]) + 1 : startCol + 1;
    return { sheetId, startColumnIndex: startCol, endColumnIndex: endCol };
  }

  // Standard A1 pattern: "A1" or "A1:B2"
  const standardMatch = a1Range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!standardMatch) {
    throw new Error(`Invalid range format: "${a1Range}"`);
  }

  const startCol = colLettersToIndex(standardMatch[1]);
  const startRow = parseInt(standardMatch[2], 10) - 1;
  const endCol = standardMatch[3] ? colLettersToIndex(standardMatch[3]) + 1 : startCol + 1;
  const endRow = standardMatch[4] ? parseInt(standardMatch[4], 10) : startRow + 1;

  return {
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: startCol,
    endColumnIndex: endCol,
  };
}

/** Convert hex color to RGB (0-1 range). */
export function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  if (!hex) return null;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  const bigint = parseInt(h, 16);
  if (isNaN(bigint)) return null;
  return {
    red: ((bigint >> 16) & 255) / 255,
    green: ((bigint >> 8) & 255) / 255,
    blue: (bigint & 255) / 255,
  };
}

/**
 * Normalize a color value that may be either a hex string or an RGB object.
 * Returns an RGB object with 0-1 range values, or null if invalid.
 */
export function normalizeColor(
  color: string | { red: number; green: number; blue: number },
): { red: number; green: number; blue: number } | null {
  if (typeof color === 'string') {
    return hexToRgb(color);
  }
  if (color && typeof color === 'object' && 'red' in color) {
    return { red: color.red, green: color.green, blue: color.blue };
  }
  return null;
}

/** Convert RGB (0-1 range) to hex. */
export function rgbToHex(rgb: { red?: number; green?: number; blue?: number } | null | undefined): string {
  if (!rgb) return '#000000';
  const r = Math.round((rgb.red ?? 0) * 255);
  const g = Math.round((rgb.green ?? 0) * 255);
  const b = Math.round((rgb.blue ?? 0) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

// ─── API Helpers ───────────────────────────────────────────────────────────

/** Resolve a sheet name to its numeric sheet ID (first sheet if omitted). */
export async function resolveSheetId(
  token: string,
  spreadsheetId: string,
  sheetName?: string | null,
): Promise<number> {
  const qs = new URLSearchParams({ fields: 'sheets.properties' });
  const res = await sheetsFetch(`/${encodeURIComponent(spreadsheetId)}?${qs}`, token);
  if (!res.ok) throw new Error(`Failed to resolve sheet ID: ${res.status}`);

  const data = (await res.json()) as {
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  };

  if (sheetName) {
    const sheet = data.sheets?.find((s) => s.properties.title === sheetName);
    if (!sheet || sheet.properties.sheetId == null) {
      throw new Error(`Sheet "${sheetName}" not found in spreadsheet`);
    }
    return sheet.properties.sheetId;
  }

  const first = data.sheets?.[0];
  if (!first || first.properties.sheetId == null) {
    throw new Error('Spreadsheet has no sheets');
  }
  return first.properties.sheetId;
}

/** Read values from a spreadsheet range. */
export async function readRange(
  token: string,
  spreadsheetId: string,
  range: string,
  valueRenderOption: string = 'FORMATTED_VALUE',
): Promise<{ range: string; values: unknown[][] }> {
  const qs = new URLSearchParams({ valueRenderOption });
  const res = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${qs}`,
    token,
  );
  if (!res.ok) throw new Error(`Failed to read range: ${res.status}`);
  const data = (await res.json()) as { range: string; values?: unknown[][] };
  return { range: data.range, values: data.values || [] };
}

/** Write values to a spreadsheet range. */
export async function writeRange(
  token: string,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  valueInputOption: string = 'USER_ENTERED',
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ valueInputOption });
  const res = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${qs}`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
    },
  );
  if (!res.ok) throw new Error(`Failed to write range: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Append values after the last row in a range. */
export async function appendValues(
  token: string,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  valueInputOption: string = 'USER_ENTERED',
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ valueInputOption, insertDataOption: 'INSERT_ROWS' });
  const res = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?${qs}`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
    },
  );
  if (!res.ok) throw new Error(`Failed to append values: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Clear values from a range. */
export async function clearRange(
  token: string,
  spreadsheetId: string,
  range: string,
): Promise<Record<string, unknown>> {
  const res = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
    token,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (!res.ok) throw new Error(`Failed to clear range: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Get spreadsheet metadata (no grid data). */
export async function getSpreadsheetMetadata(
  token: string,
  spreadsheetId: string,
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ includeGridData: 'false' });
  const res = await sheetsFetch(`/${encodeURIComponent(spreadsheetId)}?${qs}`, token);
  if (!res.ok) throw new Error(`Failed to get spreadsheet metadata: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Execute a batchUpdate request against the Sheets API. */
export async function sheetsBatchUpdate(
  token: string,
  spreadsheetId: string,
  requests: unknown[],
): Promise<Record<string, unknown>> {
  const res = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ requests }),
    },
  );
  if (!res.ok) throw new Error(`Batch update failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// ─── Format Cells Helper ───────────────────────────────────────────────────

export async function formatCells(
  token: string,
  spreadsheetId: string,
  range: string,
  format: {
    backgroundColor?: { red: number; green: number; blue: number };
    textFormat?: {
      foregroundColor?: { red: number; green: number; blue: number };
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
    };
    horizontalAlignment?: string;
    verticalAlignment?: string;
    wrapStrategy?: string;
    numberFormat?: { type: string; pattern?: string };
  },
): Promise<Record<string, unknown>> {
  const { sheetName, a1Range } = parseRange(range);
  const sheetId = await resolveSheetId(token, spreadsheetId, sheetName);
  const gridRange = parseA1ToGridRange(a1Range, sheetId);

  const userEnteredFormat: Record<string, unknown> = {};
  if (format.backgroundColor) {
    userEnteredFormat.backgroundColor = { ...format.backgroundColor, alpha: 1 };
  }
  if (format.textFormat) {
    const tf: Record<string, unknown> = {};
    if (format.textFormat.foregroundColor) {
      tf.foregroundColor = { ...format.textFormat.foregroundColor, alpha: 1 };
    }
    if (format.textFormat.fontSize !== undefined) tf.fontSize = format.textFormat.fontSize;
    if (format.textFormat.bold !== undefined) tf.bold = format.textFormat.bold;
    if (format.textFormat.italic !== undefined) tf.italic = format.textFormat.italic;
    userEnteredFormat.textFormat = tf;
  }
  if (format.horizontalAlignment) userEnteredFormat.horizontalAlignment = format.horizontalAlignment;
  if (format.verticalAlignment) userEnteredFormat.verticalAlignment = format.verticalAlignment;
  if (format.wrapStrategy) userEnteredFormat.wrapStrategy = format.wrapStrategy;
  if (format.numberFormat) {
    userEnteredFormat.numberFormat = {
      type: format.numberFormat.type,
      pattern: format.numberFormat.pattern ?? '',
    };
  }

  const fields = [
    'backgroundColor',
    'textFormat',
    'horizontalAlignment',
    'verticalAlignment',
    'wrapStrategy',
    ...(format.numberFormat ? ['numberFormat'] : []),
  ].join(',');

  return sheetsBatchUpdate(token, spreadsheetId, [
    {
      repeatCell: {
        range: gridRange,
        cell: { userEnteredFormat },
        fields: `userEnteredFormat(${fields})`,
      },
    },
  ]);
}

// ─── Freeze Rows/Columns Helper ────────────────────────────────────────────

export async function freezeRowsAndColumns(
  token: string,
  spreadsheetId: string,
  sheetName?: string | null,
  frozenRows?: number,
  frozenColumns?: number,
): Promise<Record<string, unknown>> {
  const sheetId = await resolveSheetId(token, spreadsheetId, sheetName);

  const gridProperties: Record<string, number> = {};
  const fieldParts: string[] = [];

  if (frozenRows !== undefined) {
    gridProperties.frozenRowCount = frozenRows;
    fieldParts.push('gridProperties.frozenRowCount');
  }
  if (frozenColumns !== undefined) {
    gridProperties.frozenColumnCount = frozenColumns;
    fieldParts.push('gridProperties.frozenColumnCount');
  }

  return sheetsBatchUpdate(token, spreadsheetId, [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties },
        fields: fieldParts.join(','),
      },
    },
  ]);
}

// ─── Column Widths Helper ──────────────────────────────────────────────────

export async function setColumnWidths(
  token: string,
  spreadsheetId: string,
  sheetName: string | null | undefined,
  columnWidths: Array<{ column: string; width: number }>,
): Promise<Record<string, unknown>> {
  const sheetId = await resolveSheetId(token, spreadsheetId, sheetName);

  const requests = columnWidths.map(({ column, width }) => {
    const colonIdx = column.indexOf(':');
    let startIndex: number;
    let endIndex: number;
    if (colonIdx !== -1) {
      startIndex = colLettersToIndex(column.slice(0, colonIdx).trim());
      endIndex = colLettersToIndex(column.slice(colonIdx + 1).trim()) + 1;
    } else {
      startIndex = colLettersToIndex(column.trim());
      endIndex = startIndex + 1;
    }
    return {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex, endIndex },
        properties: { pixelSize: width },
        fields: 'pixelSize',
      },
    };
  });

  return sheetsBatchUpdate(token, spreadsheetId, requests);
}

// ─── Dropdown Validation Helper ────────────────────────────────────────────

export async function setDropdownValidation(
  token: string,
  spreadsheetId: string,
  range: string,
  values?: string[],
  strict: boolean = true,
  inputMessage?: string,
): Promise<Record<string, unknown>> {
  const { sheetName, a1Range } = parseRange(range);
  const sheetId = await resolveSheetId(token, spreadsheetId, sheetName);
  const gridRange = parseA1ToGridRange(a1Range, sheetId);

  const rule =
    values && values.length > 0
      ? {
          condition: {
            type: 'ONE_OF_LIST' as const,
            values: values.map((v) => ({ userEnteredValue: v })),
          },
          showCustomUi: true,
          strict,
          inputMessage: inputMessage || null,
        }
      : undefined;

  return sheetsBatchUpdate(token, spreadsheetId, [
    { setDataValidation: { range: gridRange, rule } },
  ]);
}

// ─── Conditional Formatting Helper ─────────────────────────────────────────

export async function addConditionalFormatRule(
  token: string,
  spreadsheetId: string,
  ranges: GridRange[],
  conditionType: string,
  conditionValues: Array<{ userEnteredValue: string }>,
  format: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return sheetsBatchUpdate(token, spreadsheetId, [
    {
      addConditionalFormatRule: {
        rule: {
          ranges,
          booleanRule: {
            condition: { type: conditionType, values: conditionValues },
            format,
          },
        },
        index: 0,
      },
    },
  ]);
}

// ─── Table Helpers ─────────────────────────────────────────────────────────

interface TableInfo {
  table: Record<string, unknown>;
  sheetId: number;
  sheetName: string;
}

/** Resolve a table name or ID to a table object with sheet context. */
export async function resolveTableIdentifier(
  token: string,
  spreadsheetId: string,
  tableIdentifier: string,
): Promise<TableInfo> {
  const metadata = (await getSpreadsheetMetadata(token, spreadsheetId)) as {
    sheets?: Array<{
      properties?: { sheetId?: number; title?: string };
      tables?: Array<Record<string, unknown>>;
    }>;
  };

  for (const sheet of metadata.sheets || []) {
    if (sheet.properties?.sheetId == null) continue;
    const sheetName = sheet.properties.title || 'Unknown';
    for (const table of sheet.tables || []) {
      if (!table) continue;
      const idMatch = table.tableId === tableIdentifier;
      const nameMatch =
        typeof table.name === 'string'
          ? table.name.toLowerCase() === tableIdentifier.toLowerCase()
          : false;
      if (idMatch || nameMatch) {
        return { table, sheetId: sheet.properties.sheetId, sheetName };
      }
    }
  }

  throw new Error(`Table "${tableIdentifier}" not found. Use list_tables to see available tables.`);
}

/** List all tables across all sheets. */
export async function listAllTables(
  token: string,
  spreadsheetId: string,
  sheetNameFilter?: string,
): Promise<TableInfo[]> {
  const metadata = (await getSpreadsheetMetadata(token, spreadsheetId)) as {
    sheets?: Array<{
      properties?: { sheetId?: number; title?: string };
      tables?: Array<Record<string, unknown>>;
    }>;
  };

  const result: TableInfo[] = [];
  for (const sheet of metadata.sheets || []) {
    if (sheet.properties?.sheetId == null) continue;
    if (sheetNameFilter && sheet.properties.title !== sheetNameFilter) continue;
    const sheetName = sheet.properties.title || 'Unknown';
    for (const table of sheet.tables || []) {
      if (table) {
        result.push({ table, sheetId: sheet.properties.sheetId, sheetName });
      }
    }
  }

  return result;
}
