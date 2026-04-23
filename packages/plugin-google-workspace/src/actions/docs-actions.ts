/**
 * Google Docs actions — core read/write operations (8 of 25).
 *
 * Ported from the reference MCP server tools. Uses raw fetch() via
 * docs-helpers.ts and markdown conversion via docs-markdown.ts.
 *
 * Subsequent tasks will add the remaining 17 actions.
 */

import { z } from 'zod';
import type { ActionDefinition, ActionContext, ActionResult } from '@valet/sdk';
import {
  docsFetch,
  apiError,
  normalizeDocumentId,
  executeBatchUpdate,
  findTextRange,
  findTabById,
  buildUpdateTextStyleRequest,
} from './docs-helpers.js';
import type { DocsRequest } from './docs-markdown.js';
import {
  docsJsonToMarkdown,
  convertMarkdownToRequests,
  insertMarkdown,
  formatInsertResult,
} from './docs-markdown.js';
import type { DocsBody, DocsLists } from './docs-markdown.js';

// ─── Action Definitions ──────────────────────────────────────────────────────

const allActions: ActionDefinition[] = [
  {
    id: 'docs.read_document',
    name: 'Read Document',
    description:
      'Read document content as text, markdown, or JSON (JSON includes character indices for surgical editing)',
    riskLevel: 'low',
    params: z.object({
      documentId: z.string().describe('Document ID or full Google Docs URL'),
      format: z
        .enum(['text', 'json', 'markdown'])
        .optional()
        .default('text'),
      maxLength: z
        .number()
        .optional()
        .describe('Maximum character limit for output'),
      tabId: z.string().optional(),
    }),
  },
  {
    id: 'docs.insert_text',
    name: 'Insert Text',
    description: 'Insert text at a specific 1-based character index',
    riskLevel: 'medium',
    params: z.object({
      documentId: z.string(),
      text: z.string().min(1),
      index: z.number().int().min(1),
      tabId: z.string().optional(),
    }),
  },
  {
    id: 'docs.append_text',
    name: 'Append Text',
    description: 'Append plain text to the end of a document',
    riskLevel: 'medium',
    params: z.object({
      documentId: z.string(),
      text: z.string().min(1),
      addNewlineIfNeeded: z.boolean().optional().default(true),
      tabId: z.string().optional(),
    }),
  },
  {
    id: 'docs.modify_text',
    name: 'Modify Text',
    description:
      'Replace, insert, or format text in one atomic operation. Target by character range, text search, or insertion index.',
    riskLevel: 'medium',
    params: z.object({
      documentId: z.string(),
      target: z.union([
        z.object({
          startIndex: z.number().int().min(1),
          endIndex: z.number().int().min(1),
        }),
        z.object({
          textToFind: z.string().min(1),
          matchInstance: z.number().int().min(1).optional(),
        }),
        z.object({
          insertionIndex: z.number().int().min(1),
        }),
      ]),
      text: z.string().optional(),
      style: z
        .object({
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          underline: z.boolean().optional(),
          strikethrough: z.boolean().optional(),
          fontSize: z.number().optional(),
          fontFamily: z.string().optional(),
          foregroundColor: z.string().optional(),
          backgroundColor: z.string().optional(),
          linkUrl: z.string().optional(),
        })
        .optional(),
      tabId: z.string().optional(),
    }),
  },
  {
    id: 'docs.delete_range',
    name: 'Delete Range',
    description: 'Delete content within a character range [startIndex, endIndex)',
    riskLevel: 'high',
    params: z.object({
      documentId: z.string(),
      startIndex: z.number().int().min(1),
      endIndex: z.number().int().min(1),
      tabId: z.string().optional(),
    }),
  },
  {
    id: 'docs.find_and_replace',
    name: 'Find and Replace',
    description:
      'Replace all occurrences of a text string throughout the document',
    riskLevel: 'medium',
    params: z.object({
      documentId: z.string(),
      findText: z.string().min(1),
      replaceText: z.string(),
      matchCase: z.boolean().optional(),
      tabId: z.string().optional(),
    }),
  },
  {
    id: 'docs.append_markdown',
    name: 'Append Markdown',
    description: 'Append formatted markdown content to the end of a document',
    riskLevel: 'medium',
    params: z.object({
      documentId: z.string(),
      markdown: z.string().min(1),
      addNewlineIfNeeded: z.boolean().optional().default(true),
      tabId: z.string().optional(),
      firstHeadingAsTitle: z.boolean().optional(),
    }),
  },
  {
    id: 'docs.replace_document_with_markdown',
    name: 'Replace Document with Markdown',
    description:
      'Replace the entire document body with formatted markdown content',
    riskLevel: 'high',
    params: z.object({
      documentId: z.string(),
      markdown: z.string().min(1),
      preserveTitle: z.boolean().optional(),
      tabId: z.string().optional(),
      firstHeadingAsTitle: z.boolean().optional(),
    }),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Raw doc JSON from API
type DocJson = Record<string, any>;

/** Fetch a full document and return the parsed JSON. */
async function fetchDocument(
  token: string,
  documentId: string,
  options?: { includeTabsContent?: boolean; fields?: string },
): Promise<{ ok: true; doc: DocJson } | { ok: false; result: ActionResult }> {
  const qs = new URLSearchParams();
  if (options?.fields) qs.set('fields', options.fields);
  if (options?.includeTabsContent) qs.set('includeTabsContent', 'true');

  const qsStr = qs.toString();
  const path = `/documents/${encodeURIComponent(documentId)}${qsStr ? `?${qsStr}` : ''}`;
  const res = await docsFetch(path, token);
  if (!res.ok) {
    return { ok: false, result: await apiError(res, 'Docs') };
  }
  return { ok: true, doc: (await res.json()) as DocJson };
}

/** Get the body content from a doc response, optionally from a specific tab. */
function getBodyContent(
  doc: DocJson,
  tabId?: string,
): { body: unknown[]; lists?: DocsLists } | { error: string } {
  if (tabId) {
    const tab = findTabById(doc, tabId);
    if (!tab) return { error: `Tab with ID "${tabId}" not found in document.` };
    const dt = (tab as DocJson).documentTab as
      | { body?: { content?: unknown[] }; lists?: DocsLists }
      | undefined;
    if (!dt?.body?.content) {
      return { error: `Tab "${tabId}" does not have content.` };
    }
    return { body: dt.body.content, lists: dt.lists };
  }
  const body = (doc.body as { content?: unknown[] })?.content;
  if (!body) return { error: 'Document has no body content.' };
  return { body, lists: doc.lists as DocsLists | undefined };
}

/** Get the end index (last element's endIndex) from body content. */
function getEndIndex(bodyContent: unknown[]): number {
  if (bodyContent.length === 0) return 1;
  const lastElement = bodyContent[bodyContent.length - 1] as { endIndex?: number };
  return lastElement.endIndex ?? 1;
}

/** Extract plain text from body content elements. */
function extractPlainText(bodyContent: unknown[]): string {
  let text = '';
  for (const element of bodyContent as Record<string, unknown>[]) {
    const para = element.paragraph as { elements?: Record<string, unknown>[] } | undefined;
    if (para?.elements) {
      for (const pe of para.elements) {
        const textRun = pe.textRun as { content?: string } | undefined;
        if (textRun?.content) {
          text += textRun.content;
        }
      }
    }
    const table = element.table as { tableRows?: Record<string, unknown>[] } | undefined;
    if (table?.tableRows) {
      for (const row of table.tableRows) {
        const cells = (row as { tableCells?: Record<string, unknown>[] }).tableCells;
        if (cells) {
          for (const cell of cells) {
            const content = (cell as { content?: unknown[] }).content;
            if (content) {
              text += extractPlainText(content);
            }
          }
        }
      }
    }
  }
  return text;
}

// ─── Action Execution ────────────────────────────────────────────────────────

async function executeAction(
  actionId: string,
  params: unknown,
  ctx: ActionContext,
): Promise<ActionResult> {
  const token = ctx.credentials.access_token || '';
  if (!token) return { success: false, error: 'Missing access token' };

  try {
    switch (actionId) {
      // ── docs.read_document ──────────────────────────────────────────
      case 'docs.read_document': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          format: 'text' | 'json' | 'markdown';
          maxLength?: number;
          tabId?: string;
        };
        const docId = normalizeDocumentId(p.documentId);
        const needsTabsContent = !!p.tabId;

        // Determine fields to fetch
        const fields =
          p.format === 'json' || p.format === 'markdown'
            ? '*'
            : 'body(content(paragraph(elements(textRun(content)))))';

        const fetchResult = await fetchDocument(token, docId, {
          includeTabsContent: needsTabsContent,
          fields: needsTabsContent ? '*' : fields,
        });
        if (!fetchResult.ok) return fetchResult.result;
        const doc = fetchResult.doc;

        // Resolve content source (tab or root body)
        let contentSource: DocJson;
        if (p.tabId) {
          const tab = findTabById(doc, p.tabId);
          if (!tab) {
            return { success: false, error: `Tab with ID "${p.tabId}" not found in document.` };
          }
          const dt = (tab as DocJson).documentTab;
          if (!dt) {
            return {
              success: false,
              error: `Tab "${p.tabId}" does not have content (may not be a document tab).`,
            };
          }
          contentSource = { body: dt.body };
        } else {
          contentSource = doc;
        }

        // JSON format
        if (p.format === 'json') {
          const jsonContent = JSON.stringify(contentSource, null, 2);
          if (p.maxLength && jsonContent.length > p.maxLength) {
            return {
              success: true,
              data: {
                content:
                  jsonContent.substring(0, p.maxLength) +
                  `\n... [JSON truncated: ${jsonContent.length} total chars]`,
              },
            };
          }
          return { success: true, data: { content: jsonContent } };
        }

        // Markdown format
        if (p.format === 'markdown') {
          const body = (contentSource.body ?? {}) as DocsBody;
          const lists = contentSource.lists as DocsLists | undefined;
          const markdownContent = docsJsonToMarkdown(body, lists);
          const totalLength = markdownContent.length;

          if (p.maxLength && totalLength > p.maxLength) {
            return {
              success: true,
              data: {
                content:
                  markdownContent.substring(0, p.maxLength) +
                  `\n\n... [Markdown truncated to ${p.maxLength} chars of ${totalLength} total.]`,
              },
            };
          }
          return { success: true, data: { content: markdownContent } };
        }

        // Text format (default)
        const bodyContent = (contentSource.body as { content?: unknown[] })?.content;
        if (!bodyContent) {
          return { success: true, data: { content: 'Document found, but appears empty.' } };
        }

        const textContent = extractPlainText(bodyContent);
        if (!textContent.trim()) {
          return { success: true, data: { content: 'Document found, but appears empty.' } };
        }

        const totalLength = textContent.length;
        if (p.maxLength && totalLength > p.maxLength) {
          return {
            success: true,
            data: {
              content:
                `Content (truncated to ${p.maxLength} chars of ${totalLength} total):\n---\n` +
                textContent.substring(0, p.maxLength) +
                `\n\n... [Document continues for ${totalLength - p.maxLength} more characters.]`,
            },
          };
        }

        return {
          success: true,
          data: { content: `Content (${totalLength} characters):\n---\n${textContent}` },
        };
      }

      // ── docs.insert_text ────────────────────────────────────────────
      case 'docs.insert_text': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          text: string;
          index: number;
          tabId?: string;
        };
        const docId = normalizeDocumentId(p.documentId);

        // Verify tab exists if specified
        if (p.tabId) {
          const tabCheck = await fetchDocument(token, docId, {
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab)',
          });
          if (!tabCheck.ok) return tabCheck.result;
          const tab = findTabById(tabCheck.doc, p.tabId);
          if (!tab) {
            return { success: false, error: `Tab with ID "${p.tabId}" not found in document.` };
          }
        }

        const location: Record<string, unknown> = { index: p.index };
        if (p.tabId) location.tabId = p.tabId;

        const request: DocsRequest = {
          insertText: { location, text: p.text },
        };

        const batchResult = await executeBatchUpdate(docId, token, [request]);
        if (!batchResult.success) {
          return { success: false, error: batchResult.error || 'Failed to insert text' };
        }

        return {
          success: true,
          data: {
            message: `Successfully inserted text at index ${p.index}${p.tabId ? ` in tab ${p.tabId}` : ''}.`,
          },
        };
      }

      // ── docs.append_text ────────────────────────────────────────────
      case 'docs.append_text': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          text: string;
          addNewlineIfNeeded: boolean;
          tabId?: string;
        };
        const docId = normalizeDocumentId(p.documentId);

        // Get the current document body
        const fetchResult = await fetchDocument(token, docId, {
          includeTabsContent: !!p.tabId,
          fields: p.tabId ? 'tabs' : 'body(content(endIndex))',
        });
        if (!fetchResult.ok) return fetchResult.result;

        const bodyResult = getBodyContent(fetchResult.doc, p.tabId);
        if ('error' in bodyResult) return { success: false, error: bodyResult.error };

        let endIndex = getEndIndex(bodyResult.body);
        // Insert before the final newline
        endIndex = Math.max(1, endIndex - 1);

        const textToInsert = (p.addNewlineIfNeeded && endIndex > 1 ? '\n' : '') + p.text;
        if (!textToInsert) {
          return { success: true, data: { message: 'Nothing to append.' } };
        }

        const location: Record<string, unknown> = { index: endIndex };
        if (p.tabId) location.tabId = p.tabId;

        const request: DocsRequest = {
          insertText: { location, text: textToInsert },
        };
        const batchResult = await executeBatchUpdate(docId, token, [request]);
        if (!batchResult.success) {
          return { success: false, error: batchResult.error || 'Failed to append text' };
        }

        return {
          success: true,
          data: {
            message: `Successfully appended text to ${p.tabId ? `tab ${p.tabId} in ` : ''}document.`,
          },
        };
      }

      // ── docs.modify_text ────────────────────────────────────────────
      case 'docs.modify_text': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          target:
            | { startIndex: number; endIndex: number }
            | { textToFind: string; matchInstance?: number }
            | { insertionIndex: number };
          text?: string;
          style?: {
            bold?: boolean;
            italic?: boolean;
            underline?: boolean;
            strikethrough?: boolean;
            fontSize?: number;
            fontFamily?: string;
            foregroundColor?: string;
            backgroundColor?: string;
            linkUrl?: string;
          };
          tabId?: string;
        };

        if (p.text === undefined && p.style === undefined) {
          return { success: false, error: 'At least one of text or style must be provided.' };
        }

        const docId = normalizeDocumentId(p.documentId);

        // Verify tab exists if specified
        if (p.tabId) {
          const tabCheck = await fetchDocument(token, docId, {
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab)',
          });
          if (!tabCheck.ok) return tabCheck.result;
          const tab = findTabById(tabCheck.doc, p.tabId);
          if (!tab) {
            return { success: false, error: `Tab with ID "${p.tabId}" not found in document.` };
          }
        }

        // Resolve target to numeric indices
        let startIndex: number;
        let endIndex: number | undefined;

        if ('insertionIndex' in p.target) {
          if (p.text === undefined) {
            return {
              success: false,
              error: 'text is required when using insertionIndex target (no existing range to format).',
            };
          }
          startIndex = p.target.insertionIndex;
          endIndex = undefined;
        } else if ('textToFind' in p.target) {
          const range = await findTextRange(
            token,
            docId,
            p.target.textToFind,
            p.target.matchInstance ?? 1,
            p.tabId,
          );
          if (!range) {
            return {
              success: false,
              error: `Could not find instance ${p.target.matchInstance ?? 1} of text "${p.target.textToFind}"${p.tabId ? ` in tab ${p.tabId}` : ''}.`,
            };
          }
          startIndex = range.startIndex;
          endIndex = range.endIndex;
        } else {
          startIndex = p.target.startIndex;
          endIndex = p.target.endIndex;
        }

        if (startIndex < 1) startIndex = 1;

        // Build requests
        const requests: DocsRequest[] = [];

        // 1. Delete existing content (only when replacing, not insert-only)
        if (endIndex !== undefined && p.text !== undefined) {
          const range: Record<string, unknown> = { startIndex, endIndex };
          if (p.tabId) range.tabId = p.tabId;
          requests.push({ deleteContentRange: { range } });
        }

        // 2. Insert new text
        if (p.text !== undefined) {
          const location: Record<string, unknown> = { index: startIndex };
          if (p.tabId) location.tabId = p.tabId;
          requests.push({ insertText: { location, text: p.text } });
        }

        // 3. Apply formatting
        if (p.style) {
          const formatStart = startIndex;
          const formatEnd =
            p.text !== undefined
              ? startIndex + p.text.length
              : endIndex !== undefined
                ? endIndex
                : startIndex;

          if (formatEnd > formatStart) {
            const requestInfo = buildUpdateTextStyleRequest(
              formatStart,
              formatEnd,
              p.style,
              p.tabId,
            );
            if (requestInfo) {
              requests.push(requestInfo.request);
            }
          }
        }

        if (requests.length === 0) {
          return { success: true, data: { message: 'No operations to perform.' } };
        }

        const batchResult = await executeBatchUpdate(docId, token, requests, {
          preserveOrder: true,
        });
        if (!batchResult.success) {
          return { success: false, error: batchResult.error || 'Failed to modify text' };
        }

        const actions: string[] = [];
        if (endIndex !== undefined && p.text !== undefined) actions.push('replaced text');
        else if (p.text !== undefined) actions.push('inserted text');
        if (p.style) actions.push('applied formatting');

        return {
          success: true,
          data: {
            message: `Successfully ${actions.join(' and ')} at range ${startIndex}-${endIndex ?? startIndex + (p.text?.length ?? 0)}${p.tabId ? ` in tab ${p.tabId}` : ''}.`,
          },
        };
      }

      // ── docs.delete_range ───────────────────────────────────────────
      case 'docs.delete_range': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          startIndex: number;
          endIndex: number;
          tabId?: string;
        };
        const docId = normalizeDocumentId(p.documentId);

        if (p.endIndex <= p.startIndex) {
          return { success: false, error: 'endIndex must be greater than startIndex for deletion.' };
        }

        // Verify tab exists if specified
        if (p.tabId) {
          const tabCheck = await fetchDocument(token, docId, {
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab)',
          });
          if (!tabCheck.ok) return tabCheck.result;
          const tab = findTabById(tabCheck.doc, p.tabId);
          if (!tab) {
            return { success: false, error: `Tab with ID "${p.tabId}" not found in document.` };
          }
        }

        const range: Record<string, unknown> = {
          startIndex: p.startIndex,
          endIndex: p.endIndex,
        };
        if (p.tabId) range.tabId = p.tabId;

        const request: DocsRequest = { deleteContentRange: { range } };
        const batchResult = await executeBatchUpdate(docId, token, [request]);
        if (!batchResult.success) {
          return { success: false, error: batchResult.error || 'Failed to delete range' };
        }

        return {
          success: true,
          data: {
            message: `Successfully deleted content in range ${p.startIndex}-${p.endIndex}${p.tabId ? ` in tab ${p.tabId}` : ''}.`,
          },
        };
      }

      // ── docs.find_and_replace ───────────────────────────────────────
      case 'docs.find_and_replace': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          findText: string;
          replaceText: string;
          matchCase?: boolean;
          tabId?: string;
        };
        const docId = normalizeDocumentId(p.documentId);

        const request: DocsRequest = {
          replaceAllText: {
            containsText: {
              text: p.findText,
              matchCase: p.matchCase ?? false,
            },
            replaceText: p.replaceText,
            ...(p.tabId && { tabsCriteria: { tabIds: [p.tabId] } }),
          },
        };

        const batchResult = await executeBatchUpdate(docId, token, [request]);
        if (!batchResult.success) {
          return { success: false, error: batchResult.error || 'Failed to find and replace' };
        }

        return {
          success: true,
          data: {
            message: `Replaced occurrences of "${p.findText}" with "${p.replaceText}".`,
          },
        };
      }

      // ── docs.append_markdown ────────────────────────────────────────
      case 'docs.append_markdown': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          markdown: string;
          addNewlineIfNeeded: boolean;
          tabId?: string;
          firstHeadingAsTitle?: boolean;
        };
        const docId = normalizeDocumentId(p.documentId);

        // 1. Get document end index
        const fetchResult = await fetchDocument(token, docId, {
          includeTabsContent: !!p.tabId,
          fields: p.tabId ? 'tabs' : 'body(content(endIndex))',
        });
        if (!fetchResult.ok) return fetchResult.result;

        const bodyResult = getBodyContent(fetchResult.doc, p.tabId);
        if ('error' in bodyResult) return { success: false, error: bodyResult.error };

        let startIndex = getEndIndex(bodyResult.body) - 1;

        // 2. Add spacing if needed
        if (p.addNewlineIfNeeded && startIndex > 1) {
          const location: Record<string, unknown> = { index: startIndex };
          if (p.tabId) location.tabId = p.tabId;

          const spacingResult = await executeBatchUpdate(docId, token, [
            { insertText: { location, text: '\n\n' } },
          ]);
          if (!spacingResult.success) {
            return { success: false, error: spacingResult.error || 'Failed to add spacing' };
          }
          startIndex += 2;
        }

        // 3. Convert and append markdown
        const result = await insertMarkdown(token, docId, p.markdown, {
          startIndex,
          tabId: p.tabId,
          firstHeadingAsTitle: p.firstHeadingAsTitle,
        });

        const debugSummary = formatInsertResult(result);
        return {
          success: true,
          data: {
            message: `Successfully appended ${p.markdown.length} characters of markdown.\n\n${debugSummary}`,
          },
        };
      }

      // ── docs.replace_document_with_markdown ─────────────────────────
      case 'docs.replace_document_with_markdown': {
        const p = allActions.find((a) => a.id === actionId)!.params.parse(params) as {
          documentId: string;
          markdown: string;
          preserveTitle?: boolean;
          tabId?: string;
          firstHeadingAsTitle?: boolean;
        };
        const docId = normalizeDocumentId(p.documentId);

        // 1. Get document structure
        const fetchResult = await fetchDocument(token, docId, {
          includeTabsContent: !!p.tabId,
          fields: p.tabId ? 'tabs' : 'body(content(startIndex,endIndex))',
        });
        if (!fetchResult.ok) return fetchResult.result;

        const bodyResult = getBodyContent(fetchResult.doc, p.tabId);
        if ('error' in bodyResult) return { success: false, error: bodyResult.error };

        // 2. Calculate replacement range
        let startIndex = 1;
        let endIndex = getEndIndex(bodyResult.body) - 1;

        if (p.preserveTitle) {
          // Find first content element that's a heading or paragraph, skip past it
          for (const element of bodyResult.body as Record<string, unknown>[]) {
            const elemEnd = (element as { endIndex?: number }).endIndex;
            if ((element as { paragraph?: unknown }).paragraph && elemEnd) {
              startIndex = elemEnd;
              break;
            }
          }
        }

        // 3. Delete existing content
        if (endIndex > startIndex) {
          const deleteRange: Record<string, unknown> = { startIndex, endIndex };
          if (p.tabId) deleteRange.tabId = p.tabId;

          const deleteResult = await executeBatchUpdate(docId, token, [
            { deleteContentRange: { range: deleteRange } },
          ]);
          if (!deleteResult.success) {
            return { success: false, error: deleteResult.error || 'Failed to delete existing content' };
          }
        }

        // 4. Clean the surviving trailing paragraph
        //    deleteContentRange always leaves one trailing paragraph that cannot
        //    be deleted. If it has bullet list membership or text formatting from
        //    the old content, all subsequently inserted text inherits those
        //    properties. We strip both bullets and text styles from the survivor.
        {
          const afterDeleteResult = await fetchDocument(token, docId, {
            includeTabsContent: !!p.tabId,
            fields: p.tabId ? 'tabs' : 'body(content(startIndex,endIndex))',
          });
          if (!afterDeleteResult.ok) {
            // Non-fatal: proceed with insert anyway
          } else {
            const afterBody = getBodyContent(afterDeleteResult.doc, p.tabId);
            if (!('error' in afterBody)) {
              const survivorEnd = getEndIndex(afterBody.body);
              const survivorRange: Record<string, unknown> = {
                startIndex,
                endIndex: survivorEnd,
              };
              if (p.tabId) survivorRange.tabId = p.tabId;

              const cleanupRequests: DocsRequest[] = [
                { deleteParagraphBullets: { range: survivorRange } },
                {
                  updateTextStyle: {
                    range: survivorRange,
                    textStyle: {
                      underline: false,
                      bold: false,
                      italic: false,
                      strikethrough: false,
                      foregroundColor: {},
                      backgroundColor: {},
                    },
                    fields:
                      'underline,bold,italic,strikethrough,foregroundColor,backgroundColor',
                  },
                },
              ];

              // Non-fatal cleanup
              try {
                await executeBatchUpdate(docId, token, cleanupRequests, {
                  preserveOrder: true,
                });
              } catch {
                // Cleanup is best-effort
              }
            }
          }
        }

        // 5. Convert markdown and insert
        const result = await insertMarkdown(token, docId, p.markdown, {
          startIndex,
          tabId: p.tabId,
          firstHeadingAsTitle: p.firstHeadingAsTitle,
        });

        const debugSummary = formatInsertResult(result);
        return {
          success: true,
          data: {
            message: `Successfully replaced document content with ${p.markdown.length} characters of markdown.\n\n${debugSummary}`,
          },
        };
      }

      default:
        return { success: false, error: `Unknown action: ${actionId}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const docsActionDefs: ActionDefinition[] = allActions;
export { executeAction as executeDocsAction };
