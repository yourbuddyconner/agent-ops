import { describe, it, expect } from 'vitest';
import { convertMarkdownToRequests } from './markdown-to-docs.js';
import type { DocsRequest } from './markdown-to-docs.js';

function findRequest(
  requests: DocsRequest[],
  type: string,
): DocsRequest | undefined {
  return requests.find((r) => type in r);
}

function findAllRequests(requests: DocsRequest[], type: string): DocsRequest[] {
  return requests.filter((r) => type in r);
}

describe('convertMarkdownToRequests', () => {
  it('returns an array for any input', () => {
    const result = convertMarkdownToRequests('Hello');
    expect(Array.isArray(result)).toBe(true);
  });

  it('converts simple text to an insertText request at index 1', () => {
    const result = convertMarkdownToRequests('Hello world');
    const insertReq = findRequest(result, 'insertText');
    expect(insertReq).toBeDefined();

    const insert = insertReq!.insertText as {
      location: { index: number };
      text: string;
    };
    expect(insert.text).toContain('Hello world');
    expect(insert.location.index).toBe(1);
  });

  it('converts a heading to insertText + updateParagraphStyle with HEADING_1', () => {
    const result = convertMarkdownToRequests('# My Heading');

    const insertReqs = findAllRequests(result, 'insertText');
    expect(insertReqs.length).toBeGreaterThan(0);

    const textFound = insertReqs.some((r) => {
      const text = (r.insertText as { text: string }).text;
      return text.includes('My Heading');
    });
    expect(textFound).toBe(true);

    const paraStyleReq = findRequest(result, 'updateParagraphStyle');
    expect(paraStyleReq).toBeDefined();

    const paraStyle = paraStyleReq!.updateParagraphStyle as {
      paragraphStyle: { namedStyleType: string };
    };
    expect(paraStyle.paragraphStyle.namedStyleType).toContain('HEADING_1');
  });

  it('converts bold text to insertText + updateTextStyle with bold: true', () => {
    const result = convertMarkdownToRequests('**bold**');

    const insertReqs = findAllRequests(result, 'insertText');
    const textFound = insertReqs.some((r) => {
      const text = (r.insertText as { text: string }).text;
      return text.includes('bold');
    });
    expect(textFound).toBe(true);

    const textStyleReqs = findAllRequests(result, 'updateTextStyle');
    const boldReq = textStyleReqs.find((r) => {
      const ts = (r.updateTextStyle as { textStyle: { bold?: boolean } }).textStyle;
      return ts.bold === true;
    });
    expect(boldReq).toBeDefined();
  });

  it('uses custom startIndex when provided', () => {
    const result = convertMarkdownToRequests('text', { startIndex: 10 });
    const insertReq = findRequest(result, 'insertText');
    expect(insertReq).toBeDefined();

    const insert = insertReq!.insertText as {
      location: { index: number };
    };
    expect(insert.location.index).toBe(10);
  });

  it('returns empty array for empty string', () => {
    const result = convertMarkdownToRequests('');
    expect(result).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    const result = convertMarkdownToRequests('   \n  ');
    expect(result).toEqual([]);
  });
});

describe('style reset on insert', () => {
  it('emits updateTextStyle reset for heading paragraphs', () => {
    const result = convertMarkdownToRequests('# My Heading');

    const paraStyleReqs = findAllRequests(result, 'updateParagraphStyle');
    expect(paraStyleReqs.length).toBeGreaterThan(0);

    const headingParaStyle = paraStyleReqs.find((r) => {
      const ps = (r.updateParagraphStyle as { paragraphStyle: { namedStyleType?: string } })
        .paragraphStyle;
      return ps.namedStyleType === 'HEADING_1';
    });
    expect(headingParaStyle).toBeDefined();

    const textStyleReqs = findAllRequests(result, 'updateTextStyle');
    const resetReq = textStyleReqs.find((r) => {
      const ts = r.updateTextStyle as {
        fields: string;
        textStyle: Record<string, unknown>;
      };
      return (
        ts.fields === 'fontSize,weightedFontFamily' &&
        Object.keys(ts.textStyle).length === 0
      );
    });
    expect(resetReq).toBeDefined();
  });

  it('emits updateTextStyle reset for normal paragraphs', () => {
    const result = convertMarkdownToRequests('Just a paragraph of text.');

    const textStyleReqs = findAllRequests(result, 'updateTextStyle');
    const resetReq = textStyleReqs.find((r) => {
      const ts = r.updateTextStyle as {
        fields: string;
        textStyle: Record<string, unknown>;
      };
      return (
        ts.fields === 'fontSize,weightedFontFamily' &&
        Object.keys(ts.textStyle).length === 0
      );
    });
    expect(resetReq).toBeDefined();
  });

  it('emits reset with tabId when tabId is provided', () => {
    const result = convertMarkdownToRequests('# Heading', { tabId: 'tab-1' });

    const textStyleReqs = findAllRequests(result, 'updateTextStyle');
    const resetReq = textStyleReqs.find((r) => {
      const ts = r.updateTextStyle as {
        fields: string;
        range: { tabId?: string };
      };
      return ts.fields === 'fontSize,weightedFontFamily' && ts.range.tabId === 'tab-1';
    });
    expect(resetReq).toBeDefined();
  });
});
