import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';

/**
 * Authentication middleware supporting:
 * 1. Cloudflare Access JWT (CF-Access-JWT-Assertion header)
 * 2. Bearer token (for API keys)
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next
) => {
  // Runner WebSocket connections authenticate via token validated by the DO itself
  const url = new URL(c.req.url);
  if (url.searchParams.get('role') === 'runner' && url.pathname.endsWith('/ws')) {
    return next();
  }

  // Check for Cloudflare Access JWT
  const cfAccessJwt = c.req.header('CF-Access-JWT-Assertion');
  if (cfAccessJwt) {
    const user = await validateCloudflareAccessJWT(cfAccessJwt, c.env);
    if (user) {
      c.set('user', user);
      return next();
    }
  }

  // Check for Bearer token (API key) — from header or query param
  // Browser WebSocket API cannot send custom headers, so we also accept ?token= query param
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : new URL(c.req.url).searchParams.get('token');

  if (bearerToken) {
    const user = await validateAPIKey(bearerToken, c.env);
    if (user) {
      c.set('user', user);
      return next();
    }
  }

  throw new UnauthorizedError('Missing or invalid authentication');
};

interface CFAccessPayload {
  email: string;
  sub: string;
  iat: number;
  exp: number;
  iss: string;
  common_name?: string;
}

async function validateCloudflareAccessJWT(
  token: string,
  env: Env
): Promise<{ id: string; email: string } | null> {
  try {
    // In production, validate JWT signature using Cloudflare Access public keys
    // For now, decode and trust (Cloudflare Access validates before forwarding)
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1])) as CFAccessPayload;

    // Check expiration
    if (payload.exp * 1000 < Date.now()) {
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
    };
  } catch {
    return null;
  }
}

async function validateAPIKey(
  token: string,
  env: Env
): Promise<{ id: string; email: string } | null> {
  try {
    // Look up API key in D1
    const result = await env.DB.prepare(
      `SELECT u.id, u.email
       FROM api_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE t.token_hash = ?
         AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))
         AND t.revoked_at IS NULL`
    )
      .bind(await hashToken(token))
      .first<{ id: string; email: string }>();

    if (result) {
      // Update last used timestamp
      await env.DB.prepare(`UPDATE api_tokens SET last_used_at = datetime('now') WHERE token_hash = ?`)
        .bind(await hashToken(token))
        .run();
    }

    return result || null;
  } catch {
    return null;
  }
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
