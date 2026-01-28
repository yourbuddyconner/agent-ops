import type { Env } from '../env.js';

// ─── WebSocket Message Types ───────────────────────────────────────────────

/** Messages sent by browser clients to the DO */
interface ClientMessage {
  type: 'prompt' | 'answer' | 'ping';
  content?: string;
  questionId?: string;
  answer?: string | boolean;
}

/** Messages sent by the runner to the DO */
interface RunnerMessage {
  type: 'stream' | 'result' | 'tool' | 'question' | 'screenshot' | 'error' | 'complete';
  messageId?: string;
  content?: string;
  questionId?: string;
  text?: string;
  options?: string[];
  toolName?: string;
  args?: unknown;
  result?: unknown;
  data?: string; // base64 screenshot
  description?: string;
  error?: string;
}

/** Messages sent from DO to clients */
interface ClientOutbound {
  type: 'message' | 'stream' | 'question' | 'status' | 'pong' | 'error';
  [key: string]: unknown;
}

/** Messages sent from DO to runner */
interface RunnerOutbound {
  type: 'prompt' | 'answer' | 'stop';
  messageId?: string;
  content?: string;
  questionId?: string;
  answer?: string | boolean;
}

// ─── Durable SQLite Table Schemas ──────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    parts TEXT, -- JSON array of structured parts (tool calls, etc.)
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    options TEXT, -- JSON array of option strings
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'answered', 'expired')),
    answer TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS prompt_queue (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'processing', 'completed')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

// ─── SessionAgentDO ────────────────────────────────────────────────────────

export class SessionAgentDO {
  private ctx: DurableObjectState;
  private env: Env;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;

    // Run schema migration on construction (blockConcurrencyWhile ensures it completes before any request)
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(SCHEMA_SQL);
      this.initialized = true;
    });
  }

  // ─── Entry Point ───────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request, url);
    }

    // Internal control endpoints
    switch (url.pathname) {
      case '/start':
        return this.handleStart(request);
      case '/stop':
        return this.handleStop();
      case '/status':
        return this.handleStatus();
    }

    // Proxy to sandbox
    if (url.pathname.startsWith('/proxy/')) {
      return this.handleProxy(request, url);
    }

    return new Response('Not found', { status: 404 });
  }

  // ─── WebSocket Upgrade ─────────────────────────────────────────────────

  private async handleWebSocketUpgrade(request: Request, url: URL): Promise<Response> {
    const role = url.searchParams.get('role');

    if (role === 'runner') {
      return this.upgradeRunner(request, url);
    }
    if (role === 'client') {
      return this.upgradeClient(request, url);
    }

    return new Response('Missing or invalid role parameter', { status: 400 });
  }

  private async upgradeClient(_request: Request, url: URL): Promise<Response> {
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response('Missing userId parameter', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Tag with client:{userId} for hibernation identification
    this.ctx.acceptWebSocket(server, [`client:${userId}`]);

    // Send message history to new client
    const messages = this.ctx.storage.sql
      .exec('SELECT id, role, content, parts, created_at FROM messages ORDER BY created_at ASC')
      .toArray();

    for (const msg of messages) {
      server.send(JSON.stringify({
        type: 'message',
        data: {
          id: msg.id,
          role: msg.role,
          content: msg.content,
          parts: msg.parts ? JSON.parse(msg.parts as string) : undefined,
          createdAt: msg.created_at,
        },
      }));
    }

    // Send any pending questions
    const pendingQuestions = this.ctx.storage.sql
      .exec("SELECT id, text, options FROM questions WHERE status = 'pending'")
      .toArray();

    for (const q of pendingQuestions) {
      server.send(JSON.stringify({
        type: 'question',
        questionId: q.id,
        text: q.text,
        options: q.options ? JSON.parse(q.options as string) : undefined,
      }));
    }

    // Send current status
    const status = this.getStateValue('status') || 'idle';
    const sandboxId = this.getStateValue('sandboxId');
    server.send(JSON.stringify({
      type: 'status',
      data: {
        status,
        sandboxRunning: !!sandboxId,
        connectedClients: this.getClientSockets().length + 1, // +1 for this new one
      },
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async upgradeRunner(_request: Request, url: URL): Promise<Response> {
    const token = url.searchParams.get('token');
    const expectedToken = this.getStateValue('runnerToken');

    if (!token || !expectedToken || token !== expectedToken) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Only one runner connection at a time — close existing
    const existingRunners = this.ctx.getWebSockets('runner');
    for (const ws of existingRunners) {
      try {
        ws.close(1000, 'Replaced by new runner connection');
      } catch {
        // ignore
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, ['runner']);

    // Check if there's a queued prompt to send immediately
    const queued = this.ctx.storage.sql
      .exec("SELECT id, content FROM prompt_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
      .toArray();

    if (queued.length > 0) {
      const prompt = queued[0];
      this.ctx.storage.sql.exec(
        "UPDATE prompt_queue SET status = 'processing' WHERE id = ?",
        prompt.id as string
      );
      server.send(JSON.stringify({
        type: 'prompt',
        messageId: prompt.id,
        content: prompt.content,
      }));
      this.setStateValue('runnerBusy', 'true');
    }

    this.broadcastToClients({
      type: 'status',
      data: { runnerConnected: true },
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Hibernation Handlers ──────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let parsed: ClientMessage | RunnerMessage;

    try {
      parsed = JSON.parse(data);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    // Determine if this is a runner or client socket
    const tags = this.ctx.getTags(ws);
    const isRunner = tags.includes('runner');

    if (isRunner) {
      await this.handleRunnerMessage(parsed as RunnerMessage);
    } else {
      await this.handleClientMessage(ws, parsed as ClientMessage);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
    const tags = this.ctx.getTags(ws);
    const isRunner = tags.includes('runner');

    if (isRunner) {
      this.broadcastToClients({
        type: 'status',
        data: { runnerConnected: false },
      });
    }

    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('WebSocket error:', error);
    ws.close(1011, 'Internal error');
  }

  // ─── Client Message Handling ───────────────────────────────────────────

  private async handleClientMessage(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case 'prompt':
        if (!msg.content) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing content' }));
          return;
        }
        await this.handlePrompt(msg.content);
        break;

      case 'answer':
        if (!msg.questionId || msg.answer === undefined) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing questionId or answer' }));
          return;
        }
        await this.handleAnswer(msg.questionId, msg.answer);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  private async handlePrompt(content: string) {
    // Store user message
    const messageId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
      messageId, 'user', content
    );

    // Broadcast user message to all clients
    this.broadcastToClients({
      type: 'message',
      data: {
        id: messageId,
        role: 'user',
        content,
        createdAt: Math.floor(Date.now() / 1000),
      },
    });

    // Check if runner is busy
    const runnerBusy = this.getStateValue('runnerBusy') === 'true';
    const runnerSockets = this.ctx.getWebSockets('runner');

    if (runnerSockets.length === 0) {
      // No runner connected — queue the prompt
      this.ctx.storage.sql.exec(
        "INSERT INTO prompt_queue (id, content, status) VALUES (?, ?, 'queued')",
        messageId, content
      );
      this.broadcastToClients({
        type: 'status',
        data: { promptQueued: true, queuePosition: this.getQueueLength() },
      });
      return;
    }

    if (runnerBusy) {
      // Runner is processing another prompt — queue
      this.ctx.storage.sql.exec(
        "INSERT INTO prompt_queue (id, content, status) VALUES (?, ?, 'queued')",
        messageId, content
      );
      this.broadcastToClients({
        type: 'status',
        data: { promptQueued: true, queuePosition: this.getQueueLength() },
      });
      return;
    }

    // Forward directly to runner
    this.setStateValue('runnerBusy', 'true');
    this.sendToRunner({
      type: 'prompt',
      messageId,
      content,
    });
  }

  private async handleAnswer(questionId: string, answer: string | boolean) {
    // Update question in DB
    this.ctx.storage.sql.exec(
      "UPDATE questions SET status = 'answered', answer = ? WHERE id = ?",
      String(answer), questionId
    );

    // Forward to runner
    this.sendToRunner({
      type: 'answer',
      questionId,
      answer,
    });

    // Broadcast to other clients that question was answered
    this.broadcastToClients({
      type: 'status',
      data: { questionAnswered: questionId },
    });
  }

  // ─── Runner Message Handling ───────────────────────────────────────────

  private async handleRunnerMessage(msg: RunnerMessage) {
    switch (msg.type) {
      case 'stream':
        // Forward stream chunks to all clients (don't store)
        this.broadcastToClients({
          type: 'stream',
          messageId: msg.messageId,
          content: msg.content,
        });
        break;

      case 'result': {
        // Store final assistant message and broadcast
        const resultId = msg.messageId || crypto.randomUUID();
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
          resultId, 'assistant', msg.content || ''
        );
        this.broadcastToClients({
          type: 'message',
          data: {
            id: resultId,
            role: 'assistant',
            content: msg.content,
            createdAt: Math.floor(Date.now() / 1000),
          },
        });
        break;
      }

      case 'tool': {
        // Store tool call and broadcast
        const toolId = crypto.randomUUID();
        const parts = JSON.stringify({
          toolName: msg.toolName,
          args: msg.args,
          result: msg.result,
        });
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content, parts) VALUES (?, ?, ?, ?)',
          toolId, 'tool', msg.content || `Tool: ${msg.toolName}`, parts
        );
        this.broadcastToClients({
          type: 'message',
          data: {
            id: toolId,
            role: 'tool',
            content: msg.content || `Tool: ${msg.toolName}`,
            parts: { toolName: msg.toolName, args: msg.args, result: msg.result },
            createdAt: Math.floor(Date.now() / 1000),
          },
        });
        break;
      }

      case 'question': {
        // Store question and broadcast to all clients
        const qId = msg.questionId || crypto.randomUUID();
        this.ctx.storage.sql.exec(
          "INSERT INTO questions (id, text, options, status) VALUES (?, ?, ?, 'pending')",
          qId, msg.text || '', msg.options ? JSON.stringify(msg.options) : null
        );
        this.broadcastToClients({
          type: 'question',
          questionId: qId,
          text: msg.text,
          options: msg.options,
        });
        break;
      }

      case 'screenshot': {
        // Store screenshot reference and broadcast
        const ssId = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content, parts) VALUES (?, ?, ?, ?)',
          ssId, 'system', msg.description || 'Screenshot',
          JSON.stringify({ type: 'screenshot', data: msg.data })
        );
        this.broadcastToClients({
          type: 'message',
          data: {
            id: ssId,
            role: 'system',
            content: msg.description || 'Screenshot',
            parts: { type: 'screenshot', data: msg.data },
            createdAt: Math.floor(Date.now() / 1000),
          },
        });
        break;
      }

      case 'error': {
        // Store error and broadcast
        const errId = msg.messageId || crypto.randomUUID();
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
          errId, 'system', `Error: ${msg.error || msg.content || 'Unknown error'}`
        );
        this.broadcastToClients({
          type: 'error',
          messageId: errId,
          error: msg.error || msg.content,
        });
        break;
      }

      case 'complete':
        // Prompt finished — check queue for next
        await this.handlePromptComplete();
        break;
    }
  }

  private async handlePromptComplete() {
    // Mark any processing prompt_queue entries as completed
    this.ctx.storage.sql.exec(
      "UPDATE prompt_queue SET status = 'completed' WHERE status = 'processing'"
    );

    // Check for next queued prompt
    const next = this.ctx.storage.sql
      .exec("SELECT id, content FROM prompt_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
      .toArray();

    if (next.length > 0) {
      const prompt = next[0];
      this.ctx.storage.sql.exec(
        "UPDATE prompt_queue SET status = 'processing' WHERE id = ?",
        prompt.id as string
      );
      this.sendToRunner({
        type: 'prompt',
        messageId: prompt.id as string,
        content: prompt.content as string,
      });
      this.broadcastToClients({
        type: 'status',
        data: { promptDequeued: true, remaining: this.getQueueLength() },
      });
    } else {
      // Runner is now idle
      this.setStateValue('runnerBusy', 'false');
      this.broadcastToClients({
        type: 'status',
        data: { runnerBusy: false },
      });
    }
  }

  // ─── Internal Endpoints ────────────────────────────────────────────────

  private async handleStart(request: Request): Promise<Response> {
    const body = await request.json() as {
      sessionId: string;
      userId: string;
      workspace: string;
      runnerToken: string;
      sandboxId?: string;
      tunnelUrls?: {
        opencode: string;
        gateway: string;
        vscode?: string;
        vnc?: string;
        ttyd?: string;
      };
    };

    // Store session state in durable SQLite
    this.setStateValue('sessionId', body.sessionId);
    this.setStateValue('userId', body.userId);
    this.setStateValue('workspace', body.workspace);
    this.setStateValue('runnerToken', body.runnerToken);
    this.setStateValue('status', 'initializing');
    this.setStateValue('runnerBusy', 'false');

    if (body.sandboxId) {
      this.setStateValue('sandboxId', body.sandboxId);
    }
    if (body.tunnelUrls) {
      this.setStateValue('tunnelUrls', JSON.stringify(body.tunnelUrls));
    }

    // Update status to running once sandbox info is stored
    this.setStateValue('status', 'running');

    // Notify connected clients
    this.broadcastToClients({
      type: 'status',
      data: {
        status: 'running',
        sandboxRunning: !!body.sandboxId,
        tunnelUrls: body.tunnelUrls,
      },
    });

    return Response.json({
      success: true,
      status: 'running',
    });
  }

  private async handleStop(): Promise<Response> {
    const sandboxId = this.getStateValue('sandboxId');
    const sessionId = this.getStateValue('sessionId');

    // Tell runner to stop
    this.sendToRunner({ type: 'stop' });

    // Close all runner connections
    const runnerSockets = this.ctx.getWebSockets('runner');
    for (const ws of runnerSockets) {
      try {
        ws.close(1000, 'Session terminated');
      } catch {
        // ignore
      }
    }

    // Update state
    this.setStateValue('status', 'terminated');
    this.setStateValue('sandboxId', '');
    this.setStateValue('tunnelUrls', '');
    this.setStateValue('runnerBusy', 'false');

    // Notify clients
    this.broadcastToClients({
      type: 'status',
      data: { status: 'terminated', sandboxRunning: false },
    });

    return Response.json({
      success: true,
      status: 'terminated',
      sandboxId,
      sessionId,
    });
  }

  private async handleStatus(): Promise<Response> {
    const status = this.getStateValue('status') || 'idle';
    const sandboxId = this.getStateValue('sandboxId');
    const sessionId = this.getStateValue('sessionId');
    const userId = this.getStateValue('userId');
    const workspace = this.getStateValue('workspace');
    const tunnelUrls = this.getStateValue('tunnelUrls');
    const runnerBusy = this.getStateValue('runnerBusy') === 'true';

    const messageCount = this.ctx.storage.sql
      .exec('SELECT COUNT(*) as count FROM messages')
      .toArray()[0]?.count ?? 0;

    const queueLength = this.getQueueLength();
    const clientCount = this.getClientSockets().length;
    const runnerConnected = this.ctx.getWebSockets('runner').length > 0;

    return Response.json({
      sessionId,
      userId,
      workspace,
      status,
      sandboxId: sandboxId || null,
      tunnelUrls: tunnelUrls ? JSON.parse(tunnelUrls) : null,
      runnerConnected,
      runnerBusy,
      messageCount,
      queuedPrompts: queueLength,
      connectedClients: clientCount,
    });
  }

  private async handleProxy(request: Request, url: URL): Promise<Response> {
    const tunnelUrlsRaw = this.getStateValue('tunnelUrls');
    if (!tunnelUrlsRaw) {
      return Response.json({ error: 'Sandbox not running' }, { status: 503 });
    }

    const tunnelUrls = JSON.parse(tunnelUrlsRaw);
    const opencodeUrl = tunnelUrls.opencode;
    if (!opencodeUrl) {
      return Response.json({ error: 'OpenCode URL not available' }, { status: 503 });
    }

    // Strip /proxy prefix
    const proxyPath = url.pathname.replace(/^\/proxy/, '') + url.search;
    const proxyUrl = opencodeUrl + proxyPath;

    try {
      return fetch(proxyUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    } catch (error) {
      console.error('Proxy error:', error);
      return Response.json({ error: 'Failed to reach sandbox' }, { status: 502 });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private getStateValue(key: string): string | undefined {
    const rows = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', key)
      .toArray();
    return rows.length > 0 ? (rows[0].value as string) : undefined;
  }

  private setStateValue(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key, value
    );
  }

  private getQueueLength(): number {
    const result = this.ctx.storage.sql
      .exec("SELECT COUNT(*) as count FROM prompt_queue WHERE status = 'queued'")
      .toArray();
    return (result[0]?.count as number) ?? 0;
  }

  private getClientSockets(): WebSocket[] {
    // Get all websockets, then filter to client-tagged ones
    const all = this.ctx.getWebSockets();
    return all.filter((ws) => {
      const tags = this.ctx.getTags(ws);
      return tags.some((t) => t.startsWith('client:'));
    });
  }

  private broadcastToClients(message: ClientOutbound): void {
    const payload = JSON.stringify(message);
    for (const ws of this.getClientSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Socket may be closed
      }
    }
  }

  private sendToRunner(message: RunnerOutbound): void {
    const runners = this.ctx.getWebSockets('runner');
    const payload = JSON.stringify(message);
    for (const ws of runners) {
      try {
        ws.send(payload);
      } catch {
        // Runner may have disconnected
      }
    }
  }
}
