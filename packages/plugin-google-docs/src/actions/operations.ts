import { z } from 'zod';
import type {
  DocsBody,
  StructuralElement,
  Table,
  TableCell,
  TableRow,
  ParagraphElement,
} from './docs-to-markdown.js';
import type { DocsRequest } from './markdown-to-docs.js';

export const replaceAllOperationSchema = z.object({
  type: z.literal('replaceAll'),
  find: z.string().describe('Text to find'),
  replace: z.string().describe('Replacement text'),
  matchCase: z.boolean().optional().describe('Case-sensitive match (default: true)'),
});

export const fillCellOperationSchema = z.object({
  type: z.literal('fillCell'),
  tableIndex: z.number().int().min(0).describe('0-based index of the table in the document'),
  row: z.number().int().min(0).describe('0-based row index'),
  col: z.number().int().min(0).describe('0-based column index'),
  text: z.string().describe('Text to put in the cell (replaces existing content)'),
});

export const insertTextOperationSchema = z.object({
  type: z.literal('insertText'),
  after: z.string().describe('Anchor text to find — new text is inserted immediately after this string'),
  text: z.string().describe('Text to insert'),
});

export const updateDocumentOperationSchema = z.union([
  replaceAllOperationSchema,
  fillCellOperationSchema,
  insertTextOperationSchema,
]);

export type UpdateDocumentOperation = z.infer<typeof updateDocumentOperationSchema>;

type DocRecord = Record<string, unknown>;

interface DocsTab {
  tabProperties?: { tabId?: string };
  body?: DocsBody;
  documentTab?: { body?: DocsBody };
}

interface TextSegment {
  text: string;
  startIndex: number;
}

export function parseUpdateOperation(input: unknown, index: number): UpdateDocumentOperation {
  const base = z.object({ type: z.string() }).passthrough().safeParse(input);
  if (!base.success) {
    throw new Error(`operation[${index}]: missing operation type`);
  }

  switch (base.data.type) {
    case 'replaceAll': {
      return replaceAllOperationSchema.parse(input);
    }
    case 'fillCell': {
      return fillCellOperationSchema.parse(input);
    }
    case 'insertText': {
      return insertTextOperationSchema.parse(input);
    }
    default:
      throw new Error(`Unknown operation type '${base.data.type}' at operations[${index}]`);
  }
}

export function requiresDocumentRead(operations: UpdateDocumentOperation[]): boolean {
  return operations.some((operation) => operation.type !== 'replaceAll');
}

export function translateUpdateOperations(
  operations: UpdateDocumentOperation[],
  doc?: DocRecord,
  tabId?: string,
): DocsRequest[] {
  const body = requiresDocumentRead(operations) ? getDocumentBody(doc, tabId) : undefined;
  const requests: DocsRequest[] = [];

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];

    if (operation.type === 'replaceAll') {
      requests.push({
        replaceAllText: {
          containsText: {
            text: operation.find,
            matchCase: operation.matchCase ?? true,
          },
          replaceText: operation.replace,
        },
      });
      continue;
    }

    if (!body) {
      throw new Error(`operation[${index}]: document body is required`);
    }

    if (operation.type === 'fillCell') {
      requests.push(...translateFillCellOperation(body, operation, index));
      continue;
    }

    if (operation.type === 'insertText') {
      requests.push(translateInsertTextOperation(body, operation, index));
      continue;
    }
  }

  return requests;
}

function getDocumentBody(doc: DocRecord | undefined, tabId?: string): DocsBody {
  if (!doc) {
    throw new Error('Document content is required for this operation');
  }

  if (!tabId) {
    return (doc.body ?? {}) as DocsBody;
  }

  const tabs = (doc.tabs ?? []) as DocsTab[];
  if (tabs.length === 0) {
    return (doc.body ?? {}) as DocsBody;
  }
  const tab = tabs.find((entry) => entry.tabProperties?.tabId === tabId);
  if (!tab) {
    throw new Error(`Tab '${tabId}' not found in document`);
  }

  return (tab.documentTab?.body ?? tab.body ?? {}) as DocsBody;
}

function translateFillCellOperation(
  body: DocsBody,
  operation: Extract<UpdateDocumentOperation, { type: 'fillCell' }>,
  operationIndex: number,
): DocsRequest[] {
  const tables = collectTables(body);
  const table = tables[operation.tableIndex];

  if (!table) {
    throw new Error(
      `operation[${operationIndex}]: table ${operation.tableIndex} not found; document has ${tables.length} table${tables.length === 1 ? '' : 's'}`,
    );
  }

  const rows = table.tableRows ?? [];
  if (operation.row >= rows.length) {
    throw new Error(
      `operation[${operationIndex}]: table ${operation.tableIndex} has ${rows.length} rows, row ${operation.row} is out of bounds`,
    );
  }

  const cells = rows[operation.row]?.tableCells ?? [];
  if (operation.col >= cells.length) {
    throw new Error(
      `operation[${operationIndex}]: table ${operation.tableIndex} row ${operation.row} has ${cells.length} columns, col ${operation.col} is out of bounds`,
    );
  }

  const cell = cells[operation.col];
  const range = getEditableCellRange(cell);
  if (!range) {
    throw new Error(
      `operation[${operationIndex}]: table ${operation.tableIndex} row ${operation.row} col ${operation.col} has no editable text range`,
    );
  }

  const requests: DocsRequest[] = [];
  if (range.deleteEndIndex > range.startIndex) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: range.startIndex,
          endIndex: range.deleteEndIndex,
        },
      },
    });
  }

  requests.push({
    insertText: {
      location: { index: range.startIndex },
      text: operation.text,
    },
  });

  return requests;
}

function translateInsertTextOperation(
  body: DocsBody,
  operation: Extract<UpdateDocumentOperation, { type: 'insertText' }>,
  operationIndex: number,
): DocsRequest {
  const segments = collectTextSegments(body.content ?? []);
  const fullText = segments.map((segment) => segment.text).join('');
  const anchorOffset = fullText.indexOf(operation.after);

  if (anchorOffset === -1) {
    throw new Error(`operation[${operationIndex}]: anchor '${operation.after}' not found`);
  }

  const indexMap = buildIndexMap(segments);
  const anchorEnd = anchorOffset + operation.after.length - 1;
  const insertIndex = indexMap[anchorEnd] + 1;

  return {
    insertText: {
      location: { index: insertIndex },
      text: operation.text,
    },
  };
}

function collectTables(body: DocsBody): Table[] {
  const tables: Table[] = [];
  for (const element of body.content ?? []) {
    collectTablesFromElement(element, tables);
  }
  return tables;
}

function collectTablesFromElement(element: StructuralElement, tables: Table[]): void {
  if (element.table) {
    tables.push(element.table);
    for (const row of element.table.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) {
        for (const child of cell.content ?? []) {
          collectTablesFromElement(child, tables);
        }
      }
    }
  }
}

function getEditableCellRange(cell: TableCell): { startIndex: number; deleteEndIndex: number } | null {
  const paragraphs = collectParagraphElements(cell.content ?? []);
  if (paragraphs.length === 0) {
    return null;
  }

  const startIndex = paragraphs[0].startIndex;
  const endIndex = paragraphs[paragraphs.length - 1].endIndex;

  if (startIndex === undefined || endIndex === undefined) {
    return null;
  }

  return {
    startIndex,
    deleteEndIndex: Math.max(startIndex, endIndex - 1),
  };
}

function collectParagraphElements(content: StructuralElement[]): ParagraphElement[] {
  const elements: ParagraphElement[] = [];

  for (const item of content) {
    if (item.paragraph?.elements) {
      elements.push(...item.paragraph.elements);
    }
    if (item.table?.tableRows) {
      for (const row of item.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          elements.push(...collectParagraphElements(cell.content ?? []));
        }
      }
    }
  }

  return elements.filter((element) => element.startIndex !== undefined && element.endIndex !== undefined);
}

function collectTextSegments(content: StructuralElement[]): TextSegment[] {
  const segments: TextSegment[] = [];

  for (const element of content) {
    if (element.paragraph?.elements) {
      for (const paragraphElement of element.paragraph.elements) {
        const text = paragraphElement.textRun?.content;
        if (text && paragraphElement.startIndex !== undefined) {
          segments.push({ text, startIndex: paragraphElement.startIndex });
        }
      }
    }

    if (element.table?.tableRows) {
      for (const row of element.table.tableRows) {
        collectTextSegmentsFromRow(row, segments);
      }
    }
  }

  return segments;
}

function collectTextSegmentsFromRow(row: TableRow, segments: TextSegment[]): void {
  for (const cell of row.tableCells ?? []) {
    segments.push(...collectTextSegments(cell.content ?? []));
  }
}

function buildIndexMap(segments: TextSegment[]): number[] {
  const indexMap: number[] = [];

  for (const segment of segments) {
    for (let offset = 0; offset < segment.text.length; offset++) {
      indexMap.push(segment.startIndex + offset);
    }
  }

  return indexMap;
}
