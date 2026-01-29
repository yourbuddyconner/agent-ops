import { useCallback, useEffect, useState } from 'react';
import type { HighlighterCore } from 'shiki';

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;

const PRELOAD_LANGS = [
  'typescript',
  'javascript',
  'python',
  'bash',
  'json',
  'html',
  'css',
  'tsx',
  'jsx',
  'sql',
  'yaml',
  'markdown',
  'rust',
  'go',
] as const;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(async ({ createHighlighter }) => {
      const hl = await createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [...PRELOAD_LANGS],
      });
      highlighterInstance = hl;
      return hl;
    });
  }
  return highlighterPromise;
}

export function useShiki() {
  const [ready, setReady] = useState(highlighterInstance !== null);

  useEffect(() => {
    if (!ready) {
      getHighlighter().then(() => setReady(true));
    }
  }, [ready]);

  const highlightCode = useCallback(
    (code: string, lang: string): string | null => {
      if (!highlighterInstance) return null;

      try {
        return highlighterInstance.codeToHtml(code, {
          lang: lang || 'text',
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        });
      } catch {
        // Language not loaded — fall back
        return null;
      }
    },
    []
  );

  return { ready, highlightCode };
}
