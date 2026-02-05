import { Hono } from 'hono';
import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
// @ts-expect-error — binary import handled by wrangler
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

import type { Env, Variables } from '../env.js';
import { getSession, getShareLink, getSessionGitState } from '../lib/db.js';

let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (!wasmInitialized) {
    await initWasm(resvgWasm);
    wasmInitialized = true;
  }
}

// DM Sans font — loaded lazily and cached in module scope
let fontData: ArrayBuffer | null = null;

async function getFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  // Fetch DM Sans 600 weight from Google Fonts
  const css = await fetch(
    'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  ).then((r) => r.text());

  // Extract the first woff2 URL for weight 600 or 700
  const urlMatch = css.match(/src:\s*url\(([^)]+\.woff2)\)/);
  if (!urlMatch) throw new Error('Could not find font URL');

  const data = await fetch(urlMatch[1]).then((r) => r.arrayBuffer());
  fontData = data;
  return data;
}

export const ogRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /og/meta/session/:id
 * Returns OG metadata for a session (public, no auth)
 */
ogRouter.get('/meta/session/:id', async (c) => {
  const { id } = c.req.param();

  const session = await getSession(c.env.DB, id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const gitState = await getSessionGitState(c.env.DB, id);

  const title = session.title || 'Untitled Session';
  const parts: string[] = [];
  if (gitState?.sourceRepoFullName) parts.push(gitState.sourceRepoFullName);
  if (session.workspace) parts.push(session.workspace);
  const description = parts.length > 0 ? parts.join(' · ') : 'Agent Ops session';

  // Build absolute image URL based on the request origin
  const url = new URL(c.req.url);
  const imageUrl = `${url.origin}/og/image/session/${id}`;

  return c.json({ title, description, imageUrl });
});

/**
 * GET /og/meta/session-token/:token
 * Resolves a share token to session metadata
 */
ogRouter.get('/meta/session-token/:token', async (c) => {
  const { token } = c.req.param();

  const link = await getShareLink(c.env.DB, token);
  if (!link) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  // Redirect to the session ID variant
  const url = new URL(c.req.url);
  return c.redirect(`${url.origin}/og/meta/session/${link.sessionId}`);
});

/**
 * GET /og/image/session/:id
 * Generates a dynamic OG image (PNG) for a session
 */
ogRouter.get('/image/session/:id', async (c) => {
  const { id } = c.req.param();

  const session = await getSession(c.env.DB, id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const gitState = await getSessionGitState(c.env.DB, id);

  const title = session.title || 'Untitled Session';
  const repo = gitState?.sourceRepoFullName || '';
  const workspace = session.workspace || '';

  const font = await getFont();
  await ensureWasmInitialized();

  // satori accepts virtual DOM objects — cast to satisfy React types
  const svg = await satori(
    ({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '1200px',
          height: '630px',
          backgroundColor: '#0a0a0a',
          padding: '60px',
          fontFamily: 'DM Sans',
          color: '#fafafa',
        },
        children: [
          // Top: branding
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      width: '40px',
                      height: '40px',
                      backgroundColor: '#22d3ee',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '24px',
                      fontWeight: 700,
                      color: '#0a0a0a',
                    },
                    children: 'A',
                  },
                },
                {
                  type: 'span',
                  props: {
                    style: {
                      fontSize: '24px',
                      fontWeight: 600,
                      color: '#a1a1aa',
                    },
                    children: 'Agent Ops',
                  },
                },
              ],
            },
          },
          // Center: session title
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: title.length > 60 ? '36px' : '48px',
                      fontWeight: 700,
                      lineHeight: 1.2,
                      color: '#fafafa',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                    children: title,
                  },
                },
              ],
            },
          },
          // Bottom: repo + workspace
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                gap: '24px',
                fontSize: '20px',
                color: '#71717a',
              },
              children: [
                ...(repo
                  ? [
                      {
                        type: 'span',
                        props: {
                          style: { color: '#a1a1aa' },
                          children: repo,
                        },
                      },
                    ]
                  : []),
                ...(workspace
                  ? [
                      {
                        type: 'span',
                        props: {
                          children: workspace,
                        },
                      },
                    ]
                  : []),
              ],
            },
          },
        ],
      },
    }) as React.ReactNode,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'DM Sans',
          data: font,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'DM Sans',
          data: font,
          weight: 600,
          style: 'normal',
        },
        {
          name: 'DM Sans',
          data: font,
          weight: 700,
          style: 'normal',
        },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache',
    },
  });
});
