/**
 * Google Docs API helpers — ported from reference MCP server to raw fetch().
 *
 * Every function that previously took `docs: Docs` (the googleapis client)
 * now takes `token: string` as the first parameter.
 */

import type { DocsRequest } from './docs-markdown.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const DOCS_API = 'https://docs.googleapis.com/v1';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_BATCH_UPDATE_REQUESTS = 50;

const DELETE_TYPES = new Set(['deleteContentRange']);
const INSERT_TYPES = new Set([
  'insertText',
  'insertTable',
  'insertPageBreak',
  'insertInlineImage',
  'insertSectionBreak',
]);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TextStyleArgs {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  linkUrl?: string;
}

export interface ParagraphStyleArgs {
  alignment?: 'START' | 'END' | 'CENTER' | 'JUSTIFIED';
  indentStart?: number;
  indentEnd?: number;
  spaceAbove?: number;
  spaceBelow?: number;
  namedStyleType?:
    | 'NORMAL_TEXT'
    | 'TITLE'
    | 'SUBTITLE'
    | 'HEADING_1'
    | 'HEADING_2'
    | 'HEADING_3'
    | 'HEADING_4'
    | 'HEADING_5'
    | 'HEADING_6';
  keepWithNext?: boolean;
}

/** Metadata returned by executeBatchUpdateWithSplitting for observability. */
export interface BatchUpdateMetadata {
  totalRequests: number;
  phases: {
    delete: { requests: number; apiCalls: number; elapsedMs: number };
    insert: { requests: number; apiCalls: number; elapsedMs: number };
    format: { requests: number; apiCalls: number; elapsedMs: number };
  };
  totalApiCalls: number;
  totalElapsedMs: number;
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface TabWithLevel {
  level: number;
  tabProperties?: { tabId?: string; title?: string; [key: string]: unknown };
  documentTab?: {
    body?: { content?: unknown[] };
    lists?: Record<string, unknown>;
    [key: string]: unknown;
  };
  childTabs?: Tab[];
  [key: string]: unknown;
}

// Minimal tab shape for recursion
interface Tab {
  tabProperties?: { tabId?: string; title?: string; [key: string]: unknown };
  documentTab?: {
    body?: { content?: unknown[] };
    lists?: Record<string, unknown>;
    [key: string]: unknown;
  };
  childTabs?: Tab[];
  [key: string]: unknown;
}

// Minimal document shape used by tab helpers
interface DocsDocument {
  tabs?: Tab[];
  body?: { content?: unknown[] };
  [key: string]: unknown;
}

// ─── Raw Fetch Helpers ──────────────────────────────────────────────────────

/** Authenticated fetch against Google Docs API v1. */
export async function docsFetch(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${DOCS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/** Authenticated fetch against Google Drive API v3 (for document discovery). */
export async function driveFetchForDocs(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/** Build descriptive error from a failed API response. */
export async function apiError(
  res: Response,
  api: string,
): Promise<{ success: false; error: string }> {
  let detail = '';
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    detail = json?.error?.message || body.slice(0, 500);
  } catch {
    detail = res.statusText;
  }
  return { success: false, error: `${api} API ${res.status}: ${detail}` };
}

// ─── Document ID Normalization ──────────────────────────────────────────────

/**
 * Normalize a Google Docs URL or bare ID to a document ID.
 * Accepts both full URLs (e.g. https://docs.google.com/document/d/ID/edit)
 * and bare document IDs.
 */
export function normalizeDocumentId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? trimmed;
}

// ─── Hex Color Conversion ───────────────────────────────────────────────────

/**
 * Convert a hex color string to Google's RgbColor format.
 * Handles "#FF0000", "FF0000", "#F00", and "F00".
 */
export function hexToRgbColor(hex: string): RgbColor | null {
  if (!hex) return null;
  let hexClean = hex.startsWith('#') ? hex.slice(1) : hex;

  // Expand shorthand (e.g. "F00" -> "FF0000")
  if (hexClean.length === 3) {
    hexClean = hexClean[0] + hexClean[0] + hexClean[1] + hexClean[1] + hexClean[2] + hexClean[2];
  }
  if (hexClean.length !== 6) return null;

  const bigint = parseInt(hexClean, 16);
  if (isNaN(bigint)) return null;

  return {
    red: ((bigint >> 16) & 255) / 255,
    green: ((bigint >> 8) & 255) / 255,
    blue: (bigint & 255) / 255,
  };
}

// ─── Core Batch Update ──────────────────────────────────────────────────────

/**
 * Extract the primary index from a request for sorting.
 * Deletes use startIndex, inserts use index, format requests use startIndex from range.
 */
function extractRequestIndex(req: DocsRequest): number {
  const key = Object.keys(req)[0];
  const value = req[key] as Record<string, unknown>;

  if (key === 'deleteContentRange') {
    const range = value.range as { startIndex?: number } | undefined;
    return range?.startIndex ?? -1;
  }

  if ('location' in value) {
    const location = value.location as { index?: number } | undefined;
    return location?.index ?? -1;
  }

  if ('range' in value) {
    const range = value.range as { startIndex?: number } | undefined;
    return range?.startIndex ?? -1;
  }

  return -1;
}

/** Sort requests by descending index (highest first = "write backwards"). */
function sortByReverseIndex(requests: DocsRequest[]): DocsRequest[] {
  return [...requests].sort((a, b) => extractRequestIndex(b) - extractRequestIndex(a));
}

/**
 * Execute batchUpdate requests in three phases: delete -> insert -> format.
 * Splits large batches into chunks of MAX_BATCH_UPDATE_REQUESTS max.
 *
 * When `preserveOrder` is true, requests are sent in the order given
 * (useful when the caller has already ordered them correctly).
 */
export async function executeBatchUpdate(
  documentId: string,
  token: string,
  requests: DocsRequest[],
  options?: { preserveOrder?: boolean },
): Promise<{ success: boolean; error?: string }> {
  if (requests.length === 0) {
    return { success: true };
  }

  if (options?.preserveOrder) {
    for (let i = 0; i < requests.length; i += MAX_BATCH_UPDATE_REQUESTS) {
      const chunk = requests.slice(i, i + MAX_BATCH_UPDATE_REQUESTS);
      const res = await docsFetch(
        `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
        token,
        { method: 'POST', body: JSON.stringify({ requests: chunk }) },
      );
      if (!res.ok) {
        return apiError(res, 'Docs batchUpdate');
      }
    }
    return { success: true };
  }

  // Categorize requests into three phases
  const deleteRequests: DocsRequest[] = [];
  const insertRequests: DocsRequest[] = [];
  const formatRequests: DocsRequest[] = [];

  for (const req of requests) {
    const key = Object.keys(req)[0];
    if (DELETE_TYPES.has(key)) {
      deleteRequests.push(req);
    } else if (INSERT_TYPES.has(key)) {
      insertRequests.push(req);
    } else {
      formatRequests.push(req);
    }
  }

  // Sort each phase by reverse index ("write backwards" per Google's recommendation)
  const phases = [
    sortByReverseIndex(deleteRequests),
    sortByReverseIndex(insertRequests),
    sortByReverseIndex(formatRequests),
  ];

  for (const phaseRequests of phases) {
    for (let i = 0; i < phaseRequests.length; i += MAX_BATCH_UPDATE_REQUESTS) {
      const chunk = phaseRequests.slice(i, i + MAX_BATCH_UPDATE_REQUESTS);
      const res = await docsFetch(
        `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
        token,
        { method: 'POST', body: JSON.stringify({ requests: chunk }) },
      );
      if (!res.ok) {
        return apiError(res, 'Docs batchUpdate');
      }
    }
  }

  return { success: true };
}

// ─── Batch Update with Splitting & Metadata ─────────────────────────────────

/**
 * Execute batch updates with automatic splitting for large request arrays.
 * Separates requests into delete/insert/format phases, each chunked at 50 max.
 * Returns metadata about request counts, API calls, and timing.
 */
export async function executeBatchUpdateWithSplitting(
  token: string,
  documentId: string,
  requests: DocsRequest[],
): Promise<BatchUpdateMetadata> {
  const overallStart = performance.now();

  if (!requests || requests.length === 0) {
    return {
      totalRequests: 0,
      phases: {
        delete: { requests: 0, apiCalls: 0, elapsedMs: 0 },
        insert: { requests: 0, apiCalls: 0, elapsedMs: 0 },
        format: { requests: 0, apiCalls: 0, elapsedMs: 0 },
      },
      totalApiCalls: 0,
      totalElapsedMs: 0,
    };
  }

  const MAX_BATCH = MAX_BATCH_UPDATE_REQUESTS;

  // Separate requests into three categories
  const deleteReqs = requests.filter((r) => {
    const key = Object.keys(r)[0];
    return DELETE_TYPES.has(key);
  });
  const insertReqs = requests.filter((r) => {
    const key = Object.keys(r)[0];
    return INSERT_TYPES.has(key);
  });
  const formatReqs = requests.filter((r) => {
    const key = Object.keys(r)[0];
    return !DELETE_TYPES.has(key) && !INSERT_TYPES.has(key);
  });

  let totalApiCalls = 0;

  async function runPhase(phaseRequests: DocsRequest[]): Promise<number> {
    const start = performance.now();
    for (let i = 0; i < phaseRequests.length; i += MAX_BATCH) {
      const batch = phaseRequests.slice(i, i + MAX_BATCH);
      const res = await docsFetch(
        `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
        token,
        { method: 'POST', body: JSON.stringify({ requests: batch }) },
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Docs API ${res.status}: ${err}`);
      }
      totalApiCalls++;
    }
    return Math.round(performance.now() - start);
  }

  const deleteElapsed = deleteReqs.length > 0 ? await runPhase(deleteReqs) : 0;
  const insertElapsed = insertReqs.length > 0 ? await runPhase(insertReqs) : 0;
  const formatElapsed = formatReqs.length > 0 ? await runPhase(formatReqs) : 0;

  return {
    totalRequests: requests.length,
    phases: {
      delete: {
        requests: deleteReqs.length,
        apiCalls: deleteReqs.length > 0 ? Math.ceil(deleteReqs.length / MAX_BATCH) : 0,
        elapsedMs: deleteElapsed,
      },
      insert: {
        requests: insertReqs.length,
        apiCalls: insertReqs.length > 0 ? Math.ceil(insertReqs.length / MAX_BATCH) : 0,
        elapsedMs: insertElapsed,
      },
      format: {
        requests: formatReqs.length,
        apiCalls: formatReqs.length > 0 ? Math.ceil(formatReqs.length / MAX_BATCH) : 0,
        elapsedMs: formatElapsed,
      },
    },
    totalApiCalls,
    totalElapsedMs: Math.round(performance.now() - overallStart),
  };
}

// ─── Text Finding ───────────────────────────────────────────────────────────

/**
 * Find the Nth instance of a text string in a document and return its
 * {startIndex, endIndex} range within the document's character indices.
 */
export async function findTextRange(
  token: string,
  documentId: string,
  textToFind: string,
  instance: number = 1,
  tabId?: string,
): Promise<{ startIndex: number; endIndex: number } | null> {
  const needsTabsContent = !!tabId;
  const fields = needsTabsContent
    ? 'tabs(tabProperties(tabId),documentTab(body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex))))'
    : 'body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex))';

  const qs = new URLSearchParams({ fields });
  if (needsTabsContent) qs.set('includeTabsContent', 'true');

  const res = await docsFetch(
    `/documents/${encodeURIComponent(documentId)}?${qs}`,
    token,
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Docs API ${res.status}: ${err}`);
  }
  const doc = (await res.json()) as DocsDocument & { body?: { content?: unknown[] } };

  // Get body content from the correct tab or default
  let bodyContent: unknown[] | undefined;
  if (tabId) {
    const targetTab = findTabById(doc, tabId);
    if (!targetTab) throw new Error(`Tab with ID "${tabId}" not found in document.`);
    const tabBody = (targetTab as Tab).documentTab?.body;
    if (!tabBody?.content) throw new Error(`Tab "${tabId}" does not have content.`);
    bodyContent = tabBody.content;
  } else {
    bodyContent = doc.body?.content;
  }

  if (!bodyContent) return null;

  // Collect text segments with their document indices
  const segments: { text: string; start: number; end: number }[] = [];
  let fullText = '';

  const collectTextFromContent = (content: unknown[]) => {
    for (const element of content as Record<string, unknown>[]) {
      if ((element as { paragraph?: { elements?: unknown[] } }).paragraph) {
        const para = element.paragraph as { elements?: Record<string, unknown>[] };
        if (para.elements) {
          for (const pe of para.elements) {
            const textRun = pe.textRun as { content?: string } | undefined;
            if (textRun?.content && pe.startIndex !== undefined && pe.endIndex !== undefined) {
              fullText += textRun.content;
              segments.push({
                text: textRun.content,
                start: pe.startIndex as number,
                end: pe.endIndex as number,
              });
            }
          }
        }
      }

      // Recurse into tables
      const table = (element as { table?: { tableRows?: unknown[] } }).table;
      if (table?.tableRows) {
        for (const row of table.tableRows as Record<string, unknown>[]) {
          const cells = (row as { tableCells?: Record<string, unknown>[] }).tableCells;
          if (cells) {
            for (const cell of cells) {
              if ((cell as { content?: unknown[] }).content) {
                collectTextFromContent((cell as { content: unknown[] }).content);
              }
            }
          }
        }
      }
    }
  };

  collectTextFromContent(bodyContent);
  segments.sort((a, b) => a.start - b.start);

  // Find the specified instance of the text
  let foundCount = 0;
  let searchStartIndex = 0;

  while (foundCount < instance) {
    const currentIndex = fullText.indexOf(textToFind, searchStartIndex);
    if (currentIndex === -1) break;

    foundCount++;
    if (foundCount === instance) {
      const targetStartInFullText = currentIndex;
      const targetEndInFullText = currentIndex + textToFind.length;
      let currentPosInFullText = 0;
      let startIndex = -1;
      let endIndex = -1;

      for (const seg of segments) {
        const segStartInFullText = currentPosInFullText;
        const segEndInFullText = segStartInFullText + seg.text.length;

        if (
          startIndex === -1 &&
          targetStartInFullText >= segStartInFullText &&
          targetStartInFullText < segEndInFullText
        ) {
          startIndex = seg.start + (targetStartInFullText - segStartInFullText);
        }

        if (targetEndInFullText > segStartInFullText && targetEndInFullText <= segEndInFullText) {
          endIndex = seg.start + (targetEndInFullText - segStartInFullText);
          break;
        }

        currentPosInFullText = segEndInFullText;
      }

      if (startIndex === -1 || endIndex === -1) return null;
      return { startIndex, endIndex };
    }

    searchStartIndex = currentIndex + 1;
  }

  return null;
}

// ─── Simple Insert/Create Helpers ───────────────────────────────────────────

/** Insert text at a specific index in a document. */
export async function insertText(
  token: string,
  documentId: string,
  text: string,
  index: number,
): Promise<{ success: boolean; error?: string }> {
  if (!text) return { success: true };
  return executeBatchUpdate(documentId, token, [
    { insertText: { location: { index }, text } },
  ]);
}

/** Create a table at a specific index in a document. */
export async function createTable(
  token: string,
  documentId: string,
  rows: number,
  columns: number,
  index: number,
  tabId?: string,
): Promise<{ success: boolean; error?: string }> {
  if (rows < 1 || columns < 1) {
    throw new Error('Table must have at least 1 row and 1 column.');
  }
  const location: Record<string, unknown> = { index };
  if (tabId) location.tabId = tabId;

  return executeBatchUpdate(documentId, token, [
    { insertTable: { location, rows, columns } },
  ]);
}

/** Insert an inline image from a publicly accessible URL. */
export async function insertInlineImage(
  token: string,
  documentId: string,
  imageUrl: string,
  index: number,
  width?: number,
  height?: number,
  tabId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    new URL(imageUrl);
  } catch {
    throw new Error(`Invalid image URL format: ${imageUrl}`);
  }

  const location: Record<string, unknown> = { index };
  if (tabId) location.tabId = tabId;

  const request: DocsRequest = {
    insertInlineImage: {
      location,
      uri: imageUrl,
      ...(width && height && {
        objectSize: {
          height: { magnitude: height, unit: 'PT' },
          width: { magnitude: width, unit: 'PT' },
        },
      }),
    },
  };

  return executeBatchUpdate(documentId, token, [request]);
}

// ─── Table Cell Helper ──────────────────────────────────────────────────────

/**
 * Find the content range of a specific table cell.
 * Returns the start and end indices of the cell's text content
 * (excluding trailing newline to protect cell structure).
 */
export async function getTableCellRange(
  token: string,
  documentId: string,
  tableStartIndex: number,
  rowIndex: number,
  columnIndex: number,
  tabId?: string,
): Promise<{ startIndex: number; endIndex: number }> {
  const qs = tabId
    ? new URLSearchParams({ includeTabsContent: 'true' })
    : undefined;
  const path = `/documents/${encodeURIComponent(documentId)}${qs ? `?${qs}` : ''}`;
  const res = await docsFetch(path, token);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Docs API ${res.status}: ${err}`);
  }
  const doc = (await res.json()) as DocsDocument & { body?: { content?: unknown[] } };

  let bodyContent: unknown[] | undefined;
  if (tabId) {
    const allTabs = getAllTabs(doc);
    const tab = allTabs.find((t) => t.tabProperties?.tabId === tabId);
    if (!tab) throw new Error(`Tab with ID "${tabId}" not found.`);
    bodyContent = tab.documentTab?.body?.content;
  } else {
    bodyContent = doc.body?.content;
  }

  if (!bodyContent) {
    throw new Error(`No content found in document ${documentId}.`);
  }

  // Find the table element matching tableStartIndex
  const tableElement = (bodyContent as Record<string, unknown>[]).find(
    (el) => el.table && el.startIndex === tableStartIndex,
  );
  if (!tableElement || !tableElement.table) {
    throw new Error(
      `No table found at startIndex ${tableStartIndex}. Use readGoogleDoc with format='json' to find the correct table startIndex.`,
    );
  }

  const table = tableElement.table as { tableRows?: Record<string, unknown>[] };
  const rows = table.tableRows;
  if (!rows || rowIndex < 0 || rowIndex >= rows.length) {
    throw new Error(
      `Row index ${rowIndex} is out of range. Table has ${rows?.length ?? 0} rows (0-based).`,
    );
  }

  const cells = (rows[rowIndex] as { tableCells?: Record<string, unknown>[] }).tableCells;
  if (!cells || columnIndex < 0 || columnIndex >= cells.length) {
    throw new Error(
      `Column index ${columnIndex} is out of range. Row ${rowIndex} has ${cells?.length ?? 0} columns (0-based).`,
    );
  }

  const cell = cells[columnIndex];
  const cellContent = (cell as { content?: Record<string, unknown>[] }).content;
  if (!cellContent || cellContent.length === 0) {
    throw new Error(`Cell (${rowIndex}, ${columnIndex}) has no content elements.`);
  }

  const firstParagraph = cellContent[0];
  const lastParagraph = cellContent[cellContent.length - 1];

  const cellStartIndex = firstParagraph.startIndex as number | undefined;
  const cellEndIndex = lastParagraph.endIndex as number | undefined;

  if (cellStartIndex == null || cellEndIndex == null) {
    throw new Error(
      `Could not determine content range for cell (${rowIndex}, ${columnIndex}).`,
    );
  }

  // Subtract 1 from endIndex to exclude trailing \n (protects cell structure)
  return { startIndex: cellStartIndex, endIndex: cellEndIndex - 1 };
}

// ─── Style Request Builders (pure functions) ────────────────────────────────

/**
 * Build an updateTextStyle batchUpdate request from a TextStyleArgs object.
 * Returns null if no style properties were provided.
 */
export function buildUpdateTextStyleRequest(
  startIndex: number,
  endIndex: number,
  style: TextStyleArgs,
  tabId?: string,
): { request: DocsRequest; fields: string[] } | null {
  const textStyle: Record<string, unknown> = {};
  const fieldsToUpdate: string[] = [];

  if (style.bold !== undefined) {
    textStyle.bold = style.bold;
    fieldsToUpdate.push('bold');
  }
  if (style.italic !== undefined) {
    textStyle.italic = style.italic;
    fieldsToUpdate.push('italic');
  }
  if (style.underline !== undefined) {
    textStyle.underline = style.underline;
    fieldsToUpdate.push('underline');
  }
  if (style.strikethrough !== undefined) {
    textStyle.strikethrough = style.strikethrough;
    fieldsToUpdate.push('strikethrough');
  }
  if (style.fontSize !== undefined) {
    textStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' };
    fieldsToUpdate.push('fontSize');
  }
  if (style.fontFamily !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: style.fontFamily };
    fieldsToUpdate.push('weightedFontFamily');
  }
  if (style.foregroundColor !== undefined) {
    const rgbColor = hexToRgbColor(style.foregroundColor);
    if (!rgbColor) throw new Error(`Invalid foreground hex color format: ${style.foregroundColor}`);
    textStyle.foregroundColor = { color: { rgbColor } };
    fieldsToUpdate.push('foregroundColor');
  }
  if (style.backgroundColor !== undefined) {
    const rgbColor = hexToRgbColor(style.backgroundColor);
    if (!rgbColor) throw new Error(`Invalid background hex color format: ${style.backgroundColor}`);
    textStyle.backgroundColor = { color: { rgbColor } };
    fieldsToUpdate.push('backgroundColor');
  }
  if (style.linkUrl !== undefined) {
    textStyle.link = { url: style.linkUrl };
    fieldsToUpdate.push('link');
  }

  if (fieldsToUpdate.length === 0) return null;

  const range: Record<string, unknown> = { startIndex, endIndex };
  if (tabId) range.tabId = tabId;

  return {
    request: {
      updateTextStyle: {
        range,
        textStyle,
        fields: fieldsToUpdate.join(','),
      },
    },
    fields: fieldsToUpdate,
  };
}

/**
 * Build an updateParagraphStyle batchUpdate request from a ParagraphStyleArgs object.
 * Returns null if no style properties were provided.
 */
export function buildUpdateParagraphStyleRequest(
  startIndex: number,
  endIndex: number,
  style: ParagraphStyleArgs,
  tabId?: string,
): { request: DocsRequest; fields: string[] } | null {
  const paragraphStyle: Record<string, unknown> = {};
  const fieldsToUpdate: string[] = [];

  if (style.alignment !== undefined) {
    paragraphStyle.alignment = style.alignment;
    fieldsToUpdate.push('alignment');
  }
  if (style.indentStart !== undefined) {
    paragraphStyle.indentStart = { magnitude: style.indentStart, unit: 'PT' };
    fieldsToUpdate.push('indentStart');
  }
  if (style.indentEnd !== undefined) {
    paragraphStyle.indentEnd = { magnitude: style.indentEnd, unit: 'PT' };
    fieldsToUpdate.push('indentEnd');
  }
  if (style.spaceAbove !== undefined) {
    paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: 'PT' };
    fieldsToUpdate.push('spaceAbove');
  }
  if (style.spaceBelow !== undefined) {
    paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: 'PT' };
    fieldsToUpdate.push('spaceBelow');
  }
  if (style.namedStyleType !== undefined) {
    paragraphStyle.namedStyleType = style.namedStyleType;
    fieldsToUpdate.push('namedStyleType');
  }
  if (style.keepWithNext !== undefined) {
    paragraphStyle.keepWithNext = style.keepWithNext;
    fieldsToUpdate.push('keepWithNext');
  }

  if (fieldsToUpdate.length === 0) return null;

  const range: Record<string, unknown> = { startIndex, endIndex };
  if (tabId) range.tabId = tabId;

  return {
    request: {
      updateParagraphStyle: {
        range,
        paragraphStyle,
        fields: fieldsToUpdate.join(','),
      },
    },
    fields: fieldsToUpdate,
  };
}

// ─── Tab Management (pure functions) ────────────────────────────────────────

/**
 * Recursively collect all tabs from a document in a flat list with hierarchy info.
 */
export function getAllTabs(doc: DocsDocument): TabWithLevel[] {
  const allTabs: TabWithLevel[] = [];
  if (!doc.tabs || doc.tabs.length === 0) return allTabs;

  for (const tab of doc.tabs) {
    addCurrentAndChildTabs(tab, allTabs, 0);
  }
  return allTabs;
}

function addCurrentAndChildTabs(
  tab: Tab,
  allTabs: TabWithLevel[],
  level: number,
): void {
  allTabs.push({ ...tab, level });
  if (tab.childTabs && tab.childTabs.length > 0) {
    for (const childTab of tab.childTabs) {
      addCurrentAndChildTabs(childTab, allTabs, level + 1);
    }
  }
}

/**
 * Find a specific tab by ID in a document (searches recursively through child tabs).
 */
export function findTabById(doc: DocsDocument, tabId: string): Tab | null {
  if (!doc.tabs || doc.tabs.length === 0) return null;

  const searchTabs = (tabs: Tab[]): Tab | null => {
    for (const tab of tabs) {
      if (tab.tabProperties?.tabId === tabId) return tab;
      if (tab.childTabs && tab.childTabs.length > 0) {
        const found = searchTabs(tab.childTabs);
        if (found) return found;
      }
    }
    return null;
  };

  return searchTabs(doc.tabs);
}

/**
 * Get the total character count from a DocumentTab's body content.
 */
export function getTabTextLength(
  documentTab: { body?: { content?: unknown[] } } | undefined,
): number {
  let totalLength = 0;
  if (!documentTab?.body?.content) return 0;

  for (const element of documentTab.body.content as Record<string, unknown>[]) {
    // Handle paragraphs
    const para = (element as { paragraph?: { elements?: Record<string, unknown>[] } }).paragraph;
    if (para?.elements) {
      for (const pe of para.elements) {
        const textRun = pe.textRun as { content?: string } | undefined;
        if (textRun?.content) {
          totalLength += textRun.content.length;
        }
      }
    }

    // Handle tables
    const table = (element as { table?: { tableRows?: Record<string, unknown>[] } }).table;
    if (table?.tableRows) {
      for (const row of table.tableRows) {
        const cells = (row as { tableCells?: Record<string, unknown>[] }).tableCells;
        if (cells) {
          for (const cell of cells) {
            const content = (cell as { content?: Record<string, unknown>[] }).content;
            if (content) {
              for (const cellElement of content) {
                const cellPara = (
                  cellElement as { paragraph?: { elements?: Record<string, unknown>[] } }
                ).paragraph;
                if (cellPara?.elements) {
                  for (const pe of cellPara.elements) {
                    const textRun = pe.textRun as { content?: string } | undefined;
                    if (textRun?.content) {
                      totalLength += textRun.content.length;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return totalLength;
}
