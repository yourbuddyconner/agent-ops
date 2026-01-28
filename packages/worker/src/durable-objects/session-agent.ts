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
  type: 'message' | 'stream' | 'chunk' | 'question' | 'status' | 'pong' | 'error' | 'user.joined' | 'user.left';
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
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER -- unix timestamp, NULL means no timeout
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

  CREATE TABLE IF NOT EXISTS connected_users (
    user_id TEXT PRIMARY KEY,
    connected_at INTEGER NOT NULL DEFAULT (unixepoch())
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
      case '/clear-queue':
        return this.handleClearQueue();
      case '/prompt': {
        // HTTP-based prompt submission (alternative to WebSocket)
        const body = await request.json() as { content: string };
        if (!body.content) {
          return new Response(JSON.stringify({ error: 'Missing content' }), { status: 400 });
        }
        await this.handlePrompt(body.content);
        return Response.json({ success: true });
      }
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

    // Track connected user
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO connected_users (user_id) VALUES (?)',
      userId
    );

    // Send full session state as a single init message (prevents duplicates on reconnect)
    const messages = this.ctx.storage.sql
      .exec('SELECT id, role, content, parts, created_at FROM messages ORDER BY created_at ASC')
      .toArray();

    const status = this.getStateValue('status') || 'idle';
    const sandboxId = this.getStateValue('sandboxId');
    const connectedUsers = this.getConnectedUserIds();
    const sessionId = this.getStateValue('sessionId');
    const workspace = this.getStateValue('workspace') || '';

    server.send(JSON.stringify({
      type: 'init',
      session: {
        id: sessionId,
        status,
        workspace,
        messages: messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          parts: msg.parts ? JSON.parse(msg.parts as string) : undefined,
          createdAt: msg.created_at,
        })),
      },
      data: {
        sandboxRunning: !!sandboxId,
        connectedClients: this.getClientSockets().length + 1,
        connectedUsers,
      },
    }));

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

    // Notify other clients that a user joined
    this.broadcastToClients({
      type: 'user.joined',
      userId,
      connectedUsers,
    });

    // Notify EventBus
    this.notifyEventBus({
      type: 'session.update',
      sessionId: this.getStateValue('sessionId'),
      userId,
      data: { event: 'user.joined', connectedUsers },
      timestamp: new Date().toISOString(),
    });

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

    console.log(`[SessionAgentDO] WebSocket message: isRunner=${isRunner}, type=${parsed.type}, data=${data.slice(0, 200)}`);

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
      // Revert any processing prompt back to queued so it can be retried
      this.ctx.storage.sql.exec(
        "UPDATE prompt_queue SET status = 'queued' WHERE status = 'processing'"
      );
      this.setStateValue('runnerBusy', 'false');

      const queueLength = this.getQueueLength();
      this.broadcastToClients({
        type: 'status',
        data: {
          runnerConnected: false,
          queuedPrompts: queueLength,
          runnerDisconnected: true,
        },
      });
    } else {
      // Extract userId from tag like "client:abc123"
      const clientTag = tags.find((t) => t.startsWith('client:'));
      if (clientTag) {
        const userId = clientTag.replace('client:', '');

        // Check if user has other connections still open
        const remaining = this.ctx.getWebSockets(`client:${userId}`).filter((s) => s !== ws);
        if (remaining.length === 0) {
          // Last connection for this user — remove from connected_users
          this.ctx.storage.sql.exec('DELETE FROM connected_users WHERE user_id = ?', userId);

          const connectedUsers = this.getConnectedUserIds();
          this.broadcastToClients({
            type: 'user.left',
            userId,
            connectedUsers,
          });

          this.notifyEventBus({
            type: 'session.update',
            sessionId: this.getStateValue('sessionId'),
            userId,
            data: { event: 'user.left', connectedUsers },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // The socket is already closed when webSocketClose fires in hibernation mode.
    // Only attempt close with valid codes (1000-4999, excluding reserved 1005/1006/1015).
    try {
      ws.close(code || 1000, reason || 'Connection closed');
    } catch {
      // Socket already closed or invalid close code — ignore
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('WebSocket error:', error);
    ws.close(1011, 'Internal error');
  }

  // ─── Alarm Handler ────────────────────────────────────────────────────

  async alarm() {
    // Expire pending questions that have timed out
    const now = Math.floor(Date.now() / 1000);
    const expired = this.ctx.storage.sql
      .exec(
        "SELECT id, text FROM questions WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
        now
      )
      .toArray();

    for (const q of expired) {
      this.ctx.storage.sql.exec(
        "UPDATE questions SET status = 'expired' WHERE id = ?",
        q.id as string
      );

      this.broadcastToClients({
        type: 'status',
        data: { questionExpired: q.id },
      });

      // Tell runner the question timed out (treated as no answer)
      this.sendToRunner({
        type: 'answer',
        questionId: q.id as string,
        answer: '__expired__',
      });
    }

    // If there are still pending questions with future expiry, schedule next alarm
    const nextExpiry = this.ctx.storage.sql
      .exec(
        "SELECT MIN(expires_at) as next FROM questions WHERE status = 'pending' AND expires_at IS NOT NULL"
      )
      .toArray();

    if (nextExpiry.length > 0 && nextExpiry[0].next) {
      const nextMs = (nextExpiry[0].next as number) * 1000;
      if (nextMs > Date.now()) {
        this.ctx.storage.setAlarm(nextMs);
      }
    }
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
    // Only answer if still pending
    const existing = this.ctx.storage.sql
      .exec("SELECT status FROM questions WHERE id = ?", questionId)
      .toArray();
    if (existing.length === 0 || existing[0].status !== 'pending') {
      return; // Already answered or expired
    }

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
      data: { questionAnswered: questionId, answer: String(answer) },
    });

    // Notify EventBus
    this.notifyEventBus({
      type: 'question.answered',
      sessionId: this.getStateValue('sessionId'),
      data: { questionId, answer: String(answer) },
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Runner Message Handling ───────────────────────────────────────────

  private async handleRunnerMessage(msg: RunnerMessage) {
    console.log(`[SessionAgentDO] Runner message: type=${msg.type}`);

    switch (msg.type) {
      case 'stream':
        // Forward stream chunks to all clients (don't store)
        // Client expects 'chunk' type for streaming content
        this.broadcastToClients({
          type: 'chunk',
          content: msg.content,
        });
        break;

      case 'result': {
        // Store final assistant message and broadcast
        // Always generate a new ID - msg.messageId is the prompt ID which is already used for the user message
        const resultId = crypto.randomUUID();
        console.log(`[SessionAgentDO] Storing assistant result: id=${resultId}, content length=${(msg.content || '').length}`);
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
        console.log(`[SessionAgentDO] Assistant result stored and broadcast`);
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
        const QUESTION_TIMEOUT_SECS = 5 * 60; // 5 minutes
        const expiresAt = Math.floor(Date.now() / 1000) + QUESTION_TIMEOUT_SECS;
        this.ctx.storage.sql.exec(
          "INSERT INTO questions (id, text, options, status, expires_at) VALUES (?, ?, ?, 'pending', ?)",
          qId, msg.text || '', msg.options ? JSON.stringify(msg.options) : null, expiresAt
        );
        this.broadcastToClients({
          type: 'question',
          questionId: qId,
          text: msg.text,
          options: msg.options,
          expiresAt,
        });

        // Schedule an alarm to expire the question if unanswered
        this.ctx.storage.setAlarm(Date.now() + QUESTION_TIMEOUT_SECS * 1000);

        // Notify EventBus
        this.notifyEventBus({
          type: 'question.asked',
          sessionId: this.getStateValue('sessionId'),
          data: { questionId: qId, text: msg.text || '' },
          timestamp: new Date().toISOString(),
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
        const errorText = msg.error || msg.content || 'Unknown error';
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
          errId, 'system', `Error: ${errorText}`
        );
        this.broadcastToClients({
          type: 'error',
          messageId: errId,
          error: msg.error || msg.content,
        });
        // Publish session.errored to EventBus
        this.notifyEventBus({
          type: 'session.errored',
          sessionId: this.getStateValue('sessionId') || undefined,
          userId: this.getStateValue('userId') || undefined,
          data: { error: errorText, messageId: errId },
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case 'complete':
        // Prompt finished — check queue for next
        console.log(`[SessionAgentDO] Complete received, processing queue`);
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

    // Publish session.started to EventBus
    this.notifyEventBus({
      type: 'session.started',
      sessionId: body.sessionId,
      userId: body.userId,
      data: { workspace: body.workspace, sandboxId: body.sandboxId },
      timestamp: new Date().toISOString(),
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

    // Publish session.completed to EventBus
    this.notifyEventBus({
      type: 'session.completed',
      sessionId: sessionId || undefined,
      userId: this.getStateValue('userId') || undefined,
      data: { sandboxId: sandboxId || null, reason: 'user_stopped' },
      timestamp: new Date().toISOString(),
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
    const connectedUsers = this.getConnectedUserIds();

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
      connectedUsers,
    });
  }

  private async handleClearQueue(): Promise<Response> {
    const cleared = this.getQueueLength();
    this.ctx.storage.sql.exec("DELETE FROM prompt_queue WHERE status = 'queued'");

    this.broadcastToClients({
      type: 'status',
      data: { queueCleared: true, cleared },
    });

    return Response.json({ success: true, cleared });
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

  private getConnectedUserIds(): string[] {
    return this.ctx.storage.sql
      .exec('SELECT user_id FROM connected_users ORDER BY connected_at ASC')
      .toArray()
      .map((row) => row.user_id as string);
  }

  private notifyEventBus(event: {
    type: string;
    sessionId?: string;
    userId?: string;
    data: Record<string, unknown>;
    timestamp: string;
  }): void {
    // Fire-and-forget notification to EventBusDO
    try {
      const id = this.env.EVENT_BUS.idFromName('global');
      const stub = this.env.EVENT_BUS.get(id);
      stub.fetch(new Request('https://event-bus/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: event.userId,
          event,
        }),
      })).catch(() => {
        // Ignore EventBus errors — non-critical
      });
    } catch {
      // EventBus not available
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
