// docs-to-markdown.ts — Convert Google Docs JSON to Markdown

// --- Inline type definitions (no googleapis dependency) ---

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  link?: { url?: string };
  weightedFontFamily?: { fontFamily?: string };
}

export interface TextRun {
  content?: string;
  textStyle?: TextStyle;
}

export interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: TextRun;
  inlineObjectElement?: { inlineObjectId?: string };
}

export interface ParagraphStyle {
  namedStyleType?: string;
}

export interface Bullet {
  listId?: string;
  nestingLevel?: number;
}

export interface Paragraph {
  elements?: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
  bullet?: Bullet;
}

export interface TableCell {
  content?: StructuralElement[];
  tableCellStyle?: {
    backgroundColor?: {
      color?: { rgbColor?: { red?: number; green?: number; blue?: number } };
    };
  };
}

export interface TableRow {
  tableCells?: TableCell[];
}

export interface Table {
  rows?: number;
  columns?: number;
  tableRows?: TableRow[];
}

export interface StructuralElement {
  paragraph?: Paragraph;
  table?: Table;
  sectionBreak?: Record<string, unknown>;
}

export interface DocsBody {
  content?: StructuralElement[];
}

interface NestingLevel {
  glyphType?: string;
  glyphSymbol?: string;
}

interface ListProperties {
  nestingLevels?: NestingLevel[];
}

export interface DocsLists {
  [listId: string]: { listProperties?: ListProperties };
}

// --- Constants ---

/**
 * Font families used by the markdown-to-docs direction for code styling.
 * When these are detected on a text run, we render backtick code in markdown.
 */
const CODE_FONT_FAMILIES = new Set([
  'Roboto Mono',
  'Courier New',
  'Consolas',
  'monospace',
]);

// --- Main Conversion ---

/**
 * Convert a Google Docs document body to markdown.
 *
 * Handles headings, paragraphs, text formatting (bold, italic, strikethrough,
 * underline, links, code), ordered & unordered lists with nesting, tables,
 * and section breaks.
 */
export function docsToMarkdown(body: DocsBody, lists?: DocsLists): string {
  if (!body?.content) {
    return '';
  }

  const resolvedLists: DocsLists = lists ?? {};
  let markdown = '';

  for (const element of body.content) {
    if (element.paragraph) {
      markdown += convertParagraph(element.paragraph, resolvedLists);
    } else if (element.table) {
      markdown += convertTable(element.table);
    } else if (element.sectionBreak) {
      markdown += '\n---\n\n';
    }
  }

  return markdown.trim();
}

// --- Paragraph Conversion ---

function convertParagraph(paragraph: Paragraph, lists: DocsLists): string {
  // 1. Determine paragraph type
  const headingLevel = getHeadingLevel(paragraph);
  const listInfo = getListInfo(paragraph, lists);

  // 2. Extract text content with inline formatting
  const elements: ParagraphElement[] = paragraph.elements ?? [];
  const text = extractFormattedText(elements);

  // 3. Format based on type
  if (headingLevel && text.trim()) {
    const hashes = '#'.repeat(Math.min(headingLevel, 6));
    return `${hashes} ${text.trim()}\n\n`;
  }

  if (listInfo && text.trim()) {
    const indent = '  '.repeat(listInfo.nestingLevel);
    const marker = listInfo.ordered ? `1.` : `-`;
    return `${indent}${marker} ${text.trim()}\n`;
  }

  if (text.trim()) {
    return `${text.trim()}\n\n`;
  }

  return '\n';
}

// --- Heading Detection ---

function getHeadingLevel(paragraph: Paragraph): number | null {
  const styleType = paragraph.paragraphStyle?.namedStyleType;
  if (!styleType) return null;

  if (styleType === 'TITLE') return 1;
  if (styleType === 'SUBTITLE') return 2;

  const match = styleType.match(/^HEADING_(\d)$/);
  return match ? parseInt(match[1], 10) : null;
}

// --- List Detection ---

interface ListInfo {
  ordered: boolean;
  nestingLevel: number;
}

function getListInfo(paragraph: Paragraph, lists: DocsLists): ListInfo | null {
  if (!paragraph.bullet) return null;

  const nestingLevel: number = paragraph.bullet.nestingLevel ?? 0;
  const listId: string | undefined = paragraph.bullet.listId;
  let ordered = false;

  if (listId && lists[listId]?.listProperties?.nestingLevels) {
    const nestingLevels = lists[listId].listProperties!.nestingLevels!;
    const level = nestingLevels[nestingLevel];
    if (level) {
      // glyphType is set for ordered lists (e.g., DECIMAL, ALPHA, ROMAN)
      // glyphSymbol is set for unordered lists (e.g., bullet characters)
      // If glyphType is present and not empty, it's ordered
      if (level.glyphType && level.glyphType !== 'GLYPH_TYPE_UNSPECIFIED') {
        ordered = true;
      }
    }
  }

  return { ordered, nestingLevel };
}

// --- Text Run Conversion ---

function extractFormattedText(elements: ParagraphElement[]): string {
  let result = '';

  for (const element of elements) {
    if (element.textRun) {
      result += convertTextRun(element.textRun);
    }
  }

  return result;
}

function convertTextRun(textRun: TextRun): string {
  let text: string = textRun.content ?? '';
  const style = textRun.textStyle;

  if (!style) return text;

  // Detect code-styled text (monospace font) -- wrap in backticks and skip
  // other formatting since markdown code spans don't support nested formatting.
  if (isCodeStyled(style)) {
    const trimmed = text.replace(/\n$/, '');
    if (trimmed) {
      return `\`${trimmed}\`${text.endsWith('\n') ? '\n' : ''}`;
    }
    return text;
  }

  // Strip trailing newline before applying formatting markers, then re-add.
  // This prevents markers from wrapping the newline (e.g., "**text\n**").
  const trailingNewline = text.endsWith('\n');
  const content = trailingNewline ? text.slice(0, -1) : text;

  if (!content) return text;

  let formatted = content;

  // Apply inline formatting (bold + italic combined, or individually)
  if (style.bold && style.italic) {
    formatted = `***${formatted}***`;
  } else if (style.bold) {
    formatted = `**${formatted}**`;
  } else if (style.italic) {
    formatted = `*${formatted}*`;
  }

  if (style.strikethrough) {
    formatted = `~~${formatted}~~`;
  }

  if (style.underline && !style.link) {
    formatted = `<u>${formatted}</u>`;
  }

  if (style.link?.url) {
    formatted = `[${formatted}](${style.link.url})`;
  }

  return formatted + (trailingNewline ? '\n' : '');
}

function isCodeStyled(style: TextStyle): boolean {
  const fontFamily = style.weightedFontFamily?.fontFamily;
  return typeof fontFamily === 'string' && CODE_FONT_FAMILIES.has(fontFamily);
}

// --- Table Conversion ---

function convertTable(table: Table): string {
  if (!table.tableRows || table.tableRows.length === 0) {
    return '';
  }

  // Detect code block tables (1x1 table with monospace font or gray background)
  if (isCodeBlockTable(table)) {
    return convertCodeBlockTable(table);
  }

  let markdown = '\n';
  let isFirstRow = true;

  for (const row of table.tableRows) {
    if (!row.tableCells) continue;

    let rowText = '|';
    for (const cell of row.tableCells) {
      const cellText = extractCellText(cell);
      rowText += ` ${cellText} |`;
    }
    markdown += rowText + '\n';

    // Add header separator after the first row
    if (isFirstRow) {
      let separator = '|';
      for (let i = 0; i < row.tableCells.length; i++) {
        separator += ' --- |';
      }
      markdown += separator + '\n';
      isFirstRow = false;
    }
  }

  return markdown + '\n';
}

/**
 * Detects if a table is a code block (1x1 table with monospace font or gray background).
 * Google Docs "Code Block" building blocks are represented as styled 1x1 tables.
 */
function isCodeBlockTable(table: Table): boolean {
  // Must be a 1x1 table
  if (!table.tableRows || table.tableRows.length !== 1) return false;
  const row = table.tableRows[0];
  if (!row.tableCells || row.tableCells.length !== 1) return false;

  const cell = row.tableCells[0];

  // Check for gray/colored background on the cell
  const cellStyle = cell.tableCellStyle;
  if (cellStyle?.backgroundColor?.color?.rgbColor) {
    const bg = cellStyle.backgroundColor.color.rgbColor;
    // Detect light gray backgrounds (typical of code blocks)
    const r = bg.red ?? 0;
    const g = bg.green ?? 0;
    const b = bg.blue ?? 0;
    if (r > 0.85 && g > 0.85 && b > 0.85 && r < 1 && g < 1 && b < 1) {
      return true;
    }
  }

  // Check for monospace font in cell content
  if (cell.content) {
    for (const element of cell.content) {
      if (element.paragraph?.elements) {
        for (const pe of element.paragraph.elements) {
          if (pe.textRun?.textStyle) {
            if (isCodeStyled(pe.textRun.textStyle)) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Converts a code block table (1x1 table) to a fenced markdown code block.
 */
function convertCodeBlockTable(table: Table): string {
  const cell = table.tableRows![0].tableCells![0];
  let codeText = '';

  if (cell.content) {
    for (const element of cell.content) {
      if (element.paragraph?.elements) {
        for (const pe of element.paragraph.elements) {
          if (pe.textRun?.content) {
            codeText += pe.textRun.content;
          }
        }
      }
    }
  }

  // Remove trailing newline (cells always end with one)
  if (codeText.endsWith('\n')) {
    codeText = codeText.slice(0, -1);
  }

  return '\n```\n' + codeText + '\n```\n\n';
}

function extractCellText(cell: TableCell): string {
  let text = '';
  if (!cell.content) return text;

  for (const element of cell.content) {
    if (element.paragraph?.elements) {
      for (const pe of element.paragraph.elements) {
        if (pe.textRun?.content) {
          text += pe.textRun.content.replace(/\n/g, ' ').trim();
        }
      }
    }
  }

  return text;
}
