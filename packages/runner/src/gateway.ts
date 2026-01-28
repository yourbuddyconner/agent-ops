/**
 * Auth gateway proxy on port 9000.
 *
 * Phase 1: stub — just starts an HTTP server that returns 501.
 * Phase 2: JWT validation + proxy to code-server, VNC, TTYD.
 */

import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "gateway" }));

// Phase 2: will proxy /vscode/*, /vnc/*, /ttyd/* with JWT validation
app.all("/*", (c) => {
  return c.json({ error: "Gateway not implemented (Phase 2)" }, 501);
});

export function startGateway(port: number): void {
  console.log(`[Gateway] Starting auth gateway on port ${port} (stub)`);
  Bun.serve({
    port,
    fetch: app.fetch,
  });
}
