/**
 * Auth gateway proxy on port 9000 inside the sandbox.
 *
 * Routes:
 *   /vscode/*  → localhost:8080 (code-server)
 *   /vnc/*     → localhost:6080 (noVNC via websockify)
 *   /ttyd/*    → localhost:7681 (TTYD web terminal)
 *   /health    → 200 OK (no auth)
 *
 * All routes except /health require a valid JWT token, passed as either:
 *   - ?token=<jwt> query parameter
 *   - Authorization: Bearer <jwt> header
 */

import { Hono } from "hono";

const app = new Hono();

// ─── JWT Validation ──────────────────────────────────────────────────────

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyJWT(
  token: string,
  secret: string,
): Promise<{ sub: string; sid: string; exp: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signature = base64UrlDecode(signatureB64);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature as ArrayBufferView<ArrayBuffer>,
    encoder.encode(signingInput),
  );
  if (!valid) return null;

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadB64)),
  ) as { sub: string; sid: string; exp: number };

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

// ─── Middleware ───────────────────────────────────────────────────────────

function jwtSecret(): string {
  return process.env.JWT_SECRET || "";
}

async function authMiddleware(c: any, next: () => Promise<void>) {
  // Extract token from query param or Authorization header
  const tokenParam = c.req.query("token");
  const authHeader = c.req.header("Authorization");
  const token = tokenParam || authHeader?.replace("Bearer ", "");

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = await verifyJWT(token, jwtSecret());
  if (!payload) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  await next();
}

// ─── Routes ──────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", service: "gateway" }));

// Apply auth middleware to all proxied routes
app.use("/vscode/*", authMiddleware);
app.use("/vnc/*", authMiddleware);
app.use("/ttyd/*", authMiddleware);

// VS Code (code-server) proxy
app.all("/vscode/*", async (c) => {
  const path = c.req.path.replace(/^\/vscode/, "") || "/";
  const url = new URL(c.req.url);
  const target = `http://127.0.0.1:8080${path}${url.search}`;

  return fetch(target, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
  });
});

// VNC (noVNC via websockify) proxy
app.all("/vnc/*", async (c) => {
  const path = c.req.path.replace(/^\/vnc/, "") || "/";
  const url = new URL(c.req.url);
  const target = `http://127.0.0.1:6080${path}${url.search}`;

  return fetch(target, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
  });
});

// TTYD (web terminal) proxy
app.all("/ttyd/*", async (c) => {
  const path = c.req.path.replace(/^\/ttyd/, "") || "/";
  const url = new URL(c.req.url);
  const target = `http://127.0.0.1:7681${path}${url.search}`;

  return fetch(target, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
  });
});

// ─── Server ──────────────────────────────────────────────────────────────

export function startGateway(port: number): void {
  console.log(`[Gateway] Starting auth gateway on port ${port}`);
  Bun.serve({
    port,
    fetch: app.fetch,
  });
}
