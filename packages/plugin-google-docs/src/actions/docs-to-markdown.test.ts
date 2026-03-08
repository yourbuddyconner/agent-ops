import { describe, it, expect } from 'vitest';
import { docsToMarkdown } from './docs-to-markdown.js';
import type { DocsBody, DocsLists } from './docs-to-markdown.js';

describe('docsToMarkdown', () => {
  it('returns empty string for empty document', () => {
    const body: DocsBody = { content: [] };
    expect(docsToMarkdown(body)).toBe('');
  });

  it('converts a simple paragraph', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'Hello world\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    };
    expect(docsToMarkdown(body)).toBe('Hello world');
  });

  it('converts HEADING_1 to markdown H1', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'Heading\n' } }],
            paragraphStyle: { namedStyleType: 'HEADING_1' },
          },
        },
      ],
    };
    expect(docsToMarkdown(body)).toBe('# Heading');
  });

  it('converts HEADING_2 to markdown H2', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'Heading\n' } }],
            paragraphStyle: { namedStyleType: 'HEADING_2' },
          },
        },
      ],
    };
    expect(docsToMarkdown(body)).toBe('## Heading');
  });

  it('converts TITLE to markdown H1', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'Title\n' } }],
            paragraphStyle: { namedStyleType: 'TITLE' },
          },
        },
      ],
    };
    expect(docsToMarkdown(body)).toBe('# Title');
  });

  it('renders bold text with double asterisks', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [
              { textRun: { content: 'bold\n', textStyle: { bold: true } } },
            ],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    };
    expect(docsToMarkdown(body)).toBe('**bold**');
  });

  it('renders italic text with asterisks', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [
              {
                textRun: { content: 'italic\n', textStyle: { italic: true } },
              },
            ],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    };
    const result = docsToMarkdown(body);
    expect(result === '*italic*' || result === '_italic_').toBe(true);
  });

  it('renders a link in markdown format', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [
              {
                textRun: {
                  content: 'click here\n',
                  textStyle: { link: { url: 'https://example.com' } },
                },
              },
            ],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    };
    expect(docsToMarkdown(body)).toBe('[click here](https://example.com)');
  });

  it('renders an unordered list item', () => {
    const lists: DocsLists = {
      list1: {
        listProperties: {
          nestingLevels: [{ glyphSymbol: '●' }],
        },
      },
    };
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'item\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            bullet: { listId: 'list1', nestingLevel: 0 },
          },
        },
      ],
    };
    expect(docsToMarkdown(body, lists)).toBe('- item');
  });

  it('renders an ordered list item', () => {
    const lists: DocsLists = {
      list1: {
        listProperties: {
          nestingLevels: [{ glyphType: 'DECIMAL' }],
        },
      },
    };
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'item\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            bullet: { listId: 'list1', nestingLevel: 0 },
          },
        },
      ],
    };
    expect(docsToMarkdown(body, lists)).toBe('1. item');
  });

  it('renders a section break as horizontal rule', () => {
    const body: DocsBody = {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: 'Before\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
        { sectionBreak: {} },
        {
          paragraph: {
            elements: [{ textRun: { content: 'After\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    };
    const result = docsToMarkdown(body);
    expect(result).toContain('---');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });
});
