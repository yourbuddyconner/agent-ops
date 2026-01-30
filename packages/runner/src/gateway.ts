/**
 * Auth gateway proxy on port 9000 inside the sandbox.
 *
 * Routes:
 *   /vscode/*  → localhost:8080 (code-server)
 *   /vnc/*     → localhost:6080 (noVNC via websockify)
 *   /ttyd/*    → localhost:7681 (TTYD web terminal)
 *   /health    → 200 OK (no auth)
 *
 * Authentication:
 *   - Initial requests use JWT token via ?token= query param or Authorization header
 *   - After JWT validation, a session cookie is set for subsequent requests
 *   - This allows code-server/ttyd/novnc to load assets without token in URL
 */

import { Hono } from "hono";

const app = new Hono();

// Session cookie name
const SESSION_COOKIE = "gateway_session";
// Cookie max age (15 minutes, matching JWT expiry)
const COOKIE_MAX_AGE = 15 * 60;

// In-memory session store (valid for this sandbox instance)
const validSessions = new Map<string, { userId: string; sessionId: string; expiresAt: number }>();

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

// ─── Session Management ──────────────────────────────────────────────────

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function createSession(userId: string, sessionId: string): string {
  const token = generateSessionToken();
  const expiresAt = Date.now() + COOKIE_MAX_AGE * 1000;
  validSessions.set(token, { userId, sessionId, expiresAt });
  return token;
}

function validateSession(token: string): boolean {
  const session = validSessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    validSessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  }
  return cookies;
}

// ─── Middleware ───────────────────────────────────────────────────────────

function jwtSecret(): string {
  return process.env.JWT_SECRET || "";
}

// Track if we need to set a session cookie on this request
let pendingSessionCookie: string | null = null;

async function authMiddleware(c: any, next: () => Promise<void>) {
  pendingSessionCookie = null;

  // Check for existing session cookie first
  const cookies = parseCookies(c.req.header("Cookie"));
  const sessionToken = cookies[SESSION_COOKIE];

  if (sessionToken && validateSession(sessionToken)) {
    // Valid session cookie - proceed without setting new cookie
    await next();
    return;
  }

  // No valid session cookie - need JWT token
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

  // Create a session for subsequent requests
  pendingSessionCookie = createSession(payload.sub, payload.sid);

  await next();
}

// ─── Helper: Strip compression headers for clean proxying ────────────────

function createProxyHeaders(rawHeaders: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of rawHeaders.entries()) {
    // Skip compression-related headers to avoid encoding issues through tunnels
    // Also skip hop-by-hop headers that shouldn't be forwarded
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "accept-encoding" ||
      lowerKey === "content-encoding" ||
      lowerKey === "transfer-encoding" ||
      lowerKey === "connection" ||
      lowerKey === "keep-alive" ||
      lowerKey === "host"
    ) {
      continue;
    }
    headers.set(key, value);
  }
  // Request uncompressed content from backend
  headers.set("Accept-Encoding", "identity");
  return headers;
}

// ─── Helper: Add session cookie to response ──────────────────────────────

function addSessionCookie(response: Response): Response {
  if (!pendingSessionCookie) return response;

  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${pendingSessionCookie}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=None; Secure`
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", service: "gateway" }));

// OpenCode proxy — no auth (accessed server-to-server from the DO, which has already authenticated)
app.all("/opencode/*", async (c) => {
  const path = c.req.path.replace(/^\/opencode/, "") || "/";
  const url = new URL(c.req.url);
  const searchParams = new URLSearchParams(url.search);
  const cleanSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const target = `http://127.0.0.1:4096${path}${cleanSearch}`;

  try {
    const res = await fetch(target, {
      method: c.req.method,
      headers: createProxyHeaders(c.req.raw.headers),
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
    });

    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`[Gateway] OpenCode proxy error for ${target}:`, err);
    return new Response(`OpenCode proxy error: ${err}`, { status: 502 });
  }
});

// Apply auth middleware to all proxied routes
app.use("/vscode/*", authMiddleware);
app.use("/vnc/*", authMiddleware);
app.use("/ttyd/*", authMiddleware);

// VS Code (code-server) proxy
app.all("/vscode/*", async (c) => {
  const path = c.req.path.replace(/^\/vscode/, "") || "/";
  const url = new URL(c.req.url);
  // Strip the token param from proxied request
  const searchParams = new URLSearchParams(url.search);
  searchParams.delete("token");
  const cleanSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const target = `http://127.0.0.1:8080${path}${cleanSearch}`;

  try {
    const res = await fetch(target, {
      method: c.req.method,
      headers: createProxyHeaders(c.req.raw.headers),
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
    });

    // Return response without compression headers
    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");

    const response = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });

    return addSessionCookie(response);
  } catch (err) {
    console.error(`[Gateway] VS Code proxy error for ${target}:`, err);
    return new Response(`VS Code proxy error: ${err}`, { status: 502 });
  }
});

// VNC (noVNC via websockify) proxy
app.all("/vnc/*", async (c) => {
  const path = c.req.path.replace(/^\/vnc/, "") || "/";
  const url = new URL(c.req.url);
  // Keep VNC query params (like path=, autoconnect=, resize=) but strip token
  const searchParams = new URLSearchParams(url.search);
  searchParams.delete("token");
  const cleanSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const target = `http://127.0.0.1:6080${path}${cleanSearch}`;

  try {
    const res = await fetch(target, {
      method: c.req.method,
      headers: createProxyHeaders(c.req.raw.headers),
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
    });

    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");

    const response = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });

    return addSessionCookie(response);
  } catch (err) {
    console.error(`[Gateway] VNC proxy error for ${target}:`, err);
    return new Response(`VNC proxy error: ${err}`, { status: 502 });
  }
});

// TTYD (web terminal) proxy
app.all("/ttyd/*", async (c) => {
  const path = c.req.path.replace(/^\/ttyd/, "") || "/";
  const url = new URL(c.req.url);
  // Strip the token param from proxied request to TTYD
  const searchParams = new URLSearchParams(url.search);
  searchParams.delete("token");
  const cleanSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const target = `http://127.0.0.1:7681${path}${cleanSearch}`;

  try {
    const res = await fetch(target, {
      method: c.req.method,
      headers: createProxyHeaders(c.req.raw.headers),
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
    });

    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");

    const response = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });

    return addSessionCookie(response);
  } catch (err) {
    console.error(`[Gateway] TTYD proxy error for ${target}:`, err);
    return new Response(`TTYD proxy error: ${err}`, { status: 502 });
  }
});

// ─── WebSocket Proxy ──────────────────────────────────────────────────────

interface WSTarget {
  host: string;
  port: number;
  path: string;
}

function getWSTarget(pathname: string): WSTarget | null {
  if (pathname.startsWith("/vscode")) {
    return { host: "127.0.0.1", port: 8080, path: pathname.replace(/^\/vscode/, "") || "/" };
  }
  if (pathname.startsWith("/vnc")) {
    return { host: "127.0.0.1", port: 6080, path: pathname.replace(/^\/vnc/, "") || "/" };
  }
  if (pathname.startsWith("/ttyd")) {
    return { host: "127.0.0.1", port: 7681, path: pathname.replace(/^\/ttyd/, "") || "/" };
  }
  return null;
}

// ─── Server ──────────────────────────────────────────────────────────────

// ─── Image Upload (localhost-only, no auth) ──────────────────────────────

type OnImageCallback = (data: string, description: string) => void;

export function startGateway(port: number, onImage?: OnImageCallback): void {
  console.log(`[Gateway] Starting auth gateway on port ${port}`);

  // Register the image upload route (unauthenticated — only reachable from within the sandbox)
  app.post("/api/image", async (c) => {
    if (!onImage) {
      return c.json({ error: "Image handler not configured" }, 500);
    }

    try {
      const body = await c.req.json() as { data: string; description?: string; mimeType?: string };
      if (!body.data) {
        return c.json({ error: "Missing 'data' field" }, 400);
      }

      onImage(body.data, body.description || "Image");
      return c.json({ ok: true });
    } catch (err) {
      console.error("[Gateway] Image upload error:", err);
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  Bun.serve({
    port,

    async fetch(req: Request, server: any): Promise<Response> {
      const url = new URL(req.url);
      const upgrade = req.headers.get("upgrade")?.toLowerCase();

      // Handle WebSocket upgrades
      if (upgrade === "websocket") {
        const target = getWSTarget(url.pathname);
        if (!target) {
          return new Response("Not found", { status: 404 });
        }

        // Check session cookie first for WebSocket connections
        const cookies = parseCookies(req.headers.get("Cookie"));
        const sessionToken = cookies[SESSION_COOKIE];

        if (sessionToken && validateSession(sessionToken)) {
          // Valid session - upgrade WebSocket
          const success = server.upgrade(req, {
            data: { target, url: url.toString() },
          });
          if (success) return undefined as any;
          return new Response("WebSocket upgrade failed", { status: 500 });
        }

        // No valid session - need JWT token
        const token = url.searchParams.get("token") || req.headers.get("authorization")?.replace("Bearer ", "");
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

        // Get the requested subprotocol from client (e.g., "tty" for TTYD)
        const requestedProtocol = req.headers.get("Sec-WebSocket-Protocol");

        // Upgrade to WebSocket and proxy to backend
        const success = server.upgrade(req, {
          data: { target, url: url.toString(), protocol: requestedProtocol },
          headers: requestedProtocol ? { "Sec-WebSocket-Protocol": requestedProtocol } : undefined,
        });

        if (success) {
          return undefined as any; // Bun will handle the upgrade
        }
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // Handle regular HTTP requests via Hono
      return app.fetch(req);
    },

    websocket: {
      open(ws: any) {
        const { target, url } = ws.data as { target: WSTarget; url: string };
        const parsedUrl = new URL(url);
        // Strip token from WebSocket URL - backend services don't need it
        const searchParams = new URLSearchParams(parsedUrl.search);
        searchParams.delete("token");
        const cleanSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
        const wsUrl = `ws://${target.host}:${target.port}${target.path}${cleanSearch}`;

        // Buffer for messages that arrive before backend is connected
        const messageBuffer: (string | Buffer)[] = [];
        (ws as any).messageBuffer = messageBuffer;
        (ws as any).backendReady = false;

        // Connect to backend WebSocket
        // TTYD requires the "tty" subprotocol to be specified
        const protocols = target.port === 7681 ? ["tty"] : undefined;
        const backend = protocols
          ? new WebSocket(wsUrl, protocols)
          : new WebSocket(wsUrl);
        // Ensure binary data is received as ArrayBuffer for proper forwarding
        backend.binaryType = "arraybuffer";

        backend.onopen = () => {
          (ws as any).backendReady = true;

          // Flush any buffered messages
          const buffer = (ws as any).messageBuffer as (string | Buffer)[];
          if (buffer.length > 0) {
            for (const msg of buffer) {
              backend.send(msg);
            }
            buffer.length = 0;
          }
        };

        backend.onmessage = (event) => {
          try {
            ws.send(event.data);
          } catch (e) {
            console.error("[Gateway] Error forwarding to client:", e);
          }
        };

        backend.onclose = (event) => {
          try {
            ws.close(event.code, event.reason);
          } catch {
            // Client may already be closed
          }
        };

        backend.onerror = (error) => {
          console.error("[Gateway] Backend WS error:", error);
          try {
            ws.close(1011, "Backend error");
          } catch {
            // Client may already be closed
          }
        };

        // Store backend connection for message forwarding
        (ws as any).backend = backend;
      },

      message(ws: any, message: string | Buffer) {
        const backend = (ws as any).backend as WebSocket;
        const backendReady = (ws as any).backendReady as boolean;
        const messageBuffer = (ws as any).messageBuffer as (string | Buffer)[];

        if (backendReady && backend && backend.readyState === WebSocket.OPEN) {
          backend.send(message);
        } else if (messageBuffer) {
          // Buffer message until backend is ready
          messageBuffer.push(message);
        }
      },

      close(ws: any, code: number, reason: string) {
        const backend = (ws as any).backend as WebSocket;
        if (backend) {
          try {
            backend.close(code, reason);
          } catch {
            // May already be closed
          }
        }
      },
    },
  });
}
