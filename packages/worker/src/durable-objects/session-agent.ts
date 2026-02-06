import type { Env } from '../env.js';
import { updateSessionStatus, updateSessionMetrics, addActiveSeconds, updateSessionGitState, upsertSessionFileChanged, updateSessionTitle, createSession, createSessionGitState, getSession, getSessionGitState, getOAuthToken, getChildSessions, listOrchestratorMemories, createOrchestratorMemory, deleteOrchestratorMemory, boostMemoryRelevance, listOrgRepositories, listPersonas, getUserById } from '../lib/db.js';
import { decryptString } from '../lib/crypto.js';

// ─── WebSocket Message Types ───────────────────────────────────────────────

/** Messages sent by browser clients to the DO */
interface ClientMessage {
  type: 'prompt' | 'answer' | 'ping' | 'abort' | 'revert' | 'diff' | 'review';
  content?: string;
  model?: string;
  questionId?: string;
  answer?: string | boolean;
  messageId?: string;
  requestId?: string;
}

/** Agent status values for activity indication */
type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

/** Messages sent by the runner to the DO */
/** Tool call status values */
type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

interface RunnerMessage {
  type: 'stream' | 'result' | 'tool' | 'question' | 'screenshot' | 'error' | 'complete' | 'agentStatus' | 'create-pr' | 'update-pr' | 'list-pull-requests' | 'inspect-pull-request' | 'models' | 'aborted' | 'reverted' | 'diff' | 'review-result' | 'ping' | 'git-state' | 'pr-created' | 'files-changed' | 'child-session' | 'title' | 'spawn-child' | 'session-message' | 'session-messages' | 'terminate-child' | 'self-terminate' | 'memory-read' | 'memory-write' | 'memory-delete' | 'list-repos' | 'list-personas' | 'get-session-status' | 'list-child-sessions' | 'forward-messages' | 'model-switched';
  prNumber?: number;
  targetSessionId?: string;
  interrupt?: boolean;
  limit?: number;
  after?: string;
  task?: string;
  workspace?: string;
  repoUrl?: string;
  messageId?: string;
  content?: string;
  questionId?: string;
  text?: string;
  options?: string[];
  callID?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  data?: string | { files?: { path: string; status: string; diff?: string }[] } | Record<string, unknown>; // base64 screenshot, diff payload, or review result
  description?: string;
  error?: string;
  status?: AgentStatus | ToolCallStatus;
  detail?: string;
  branch?: string;
  title?: string;
  body?: string;
  base?: string;
  models?: { provider: string; models: { id: string; name: string }[] }[];
  requestId?: string;
  messageIds?: string[];
  files?: { path: string; status: string; diff?: string }[];
  number?: number;
  url?: string;
  baseBranch?: string;
  commitCount?: number;
  sourceType?: string;
  sourcePrNumber?: number;
  sourceIssueNumber?: number;
  sourceRepoFullName?: string;
  labels?: string[];
  state?: string;
  owner?: string;
  repo?: string;
  filesLimit?: number;
  commentsLimit?: number;
  childSessionId?: string;
  diffFiles?: unknown;
  // Orchestrator memory fields
  category?: string;
  query?: string;
  memoryId?: string;
  relevance?: number;
  source?: string;
  // Model failover fields
  fromModel?: string;
  toModel?: string;
  reason?: string;
  model?: string;
}

/** Messages sent from DO to clients */
interface ClientOutbound {
  type: 'message' | 'message.updated' | 'messages.removed' | 'stream' | 'chunk' | 'question' | 'status' | 'pong' | 'error' | 'user.joined' | 'user.left' | 'agentStatus' | 'models' | 'diff' | 'review-result' | 'git-state' | 'pr-created' | 'files-changed' | 'child-session' | 'title' | 'audit_log' | 'model-switched';
  [key: string]: unknown;
}

/** Messages sent from DO to runner */
interface RunnerOutbound {
  type: 'prompt' | 'answer' | 'stop' | 'abort' | 'revert' | 'diff' | 'review' | 'pong' | 'spawn-child-result' | 'session-message-result' | 'session-messages-result' | 'create-pr-result' | 'update-pr-result' | 'list-pull-requests-result' | 'inspect-pull-request-result' | 'terminate-child-result' | 'memory-read-result' | 'memory-write-result' | 'memory-delete-result' | 'list-repos-result' | 'list-personas-result' | 'get-session-status-result' | 'list-child-sessions-result' | 'forward-messages-result';
  messageId?: string;
  content?: string;
  model?: string;
  questionId?: string;
  answer?: string | boolean;
  requestId?: string;
  childSessionId?: string;
  success?: boolean;
  error?: string;
  messages?: Array<{ role: string; content: string; createdAt: string }>;
  number?: number;
  url?: string;
  title?: string;
  state?: string;
  // Author attribution (multiplayer)
  authorId?: string;
  authorEmail?: string;
  authorName?: string;
  gitName?: string;
  gitEmail?: string;
  // Orchestrator result fields
  memories?: unknown[];
  memory?: unknown;
  repos?: unknown[];
  personas?: unknown[];
  sessionStatus?: unknown;
  pulls?: unknown[];
  data?: unknown;
  // Forward messages result
  count?: number;
  sourceSessionId?: string;
  // Model failover
  modelPreferences?: string[];
}

// ─── Durable SQLite Table Schemas ──────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    parts TEXT, -- JSON array of structured parts (tool calls, etc.)
    author_id TEXT,
    author_email TEXT,
    author_name TEXT,
    author_avatar_url TEXT,
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
    author_id TEXT,
    author_email TEXT,
    author_name TEXT,
    author_avatar_url TEXT,
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

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    actor_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    flushed INTEGER NOT NULL DEFAULT 0
  );
`;

// ─── SessionAgentDO ────────────────────────────────────────────────────────

interface CachedUserDetails {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  gitName?: string;
  gitEmail?: string;
  modelPreferences?: string[];
}

export class SessionAgentDO {
  private ctx: DurableObjectState;
  private env: Env;
  private initialized = false;
  private userDetailsCache = new Map<string, CachedUserDetails>();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;

    // Run schema migration on construction (blockConcurrencyWhile ensures it completes before any request)
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(SCHEMA_SQL);

      // Migrate existing DOs: add author_avatar_url columns if missing
      try { this.ctx.storage.sql.exec('ALTER TABLE messages ADD COLUMN author_avatar_url TEXT'); } catch { /* already exists */ }
      try { this.ctx.storage.sql.exec('ALTER TABLE prompt_queue ADD COLUMN author_avatar_url TEXT'); } catch { /* already exists */ }

      this.initialized = true;
    });
  }

  private async getUserDetails(userId: string): Promise<CachedUserDetails | undefined> {
    const cached = this.userDetailsCache.get(userId);
    if (cached) return cached;

    try {
      const userRow = await getUserById(this.env.DB, userId);
      if (!userRow) return undefined;
      const details: CachedUserDetails = {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        avatarUrl: userRow.avatarUrl,
        gitName: userRow.gitName,
        gitEmail: userRow.gitEmail,
        modelPreferences: userRow.modelPreferences,
      };
      this.userDetailsCache.set(userId, details);
      return details;
    } catch (err) {
      console.error('[SessionAgentDO] Failed to fetch user details:', err);
      return undefined;
    }
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
      case '/wake':
        return this.handleWake();
      case '/hibernate':
        return this.handleHibernate();
      case '/clear-queue':
        return this.handleClearQueue();
      case '/flush-metrics':
        return this.handleFlushMetrics();
      case '/messages':
        return this.handleMessagesEndpoint(url);
      case '/gc':
        return this.handleGarbageCollect();
      case '/webhook-update':
        return this.handleWebhookUpdate(request);
      case '/models': {
        const raw = this.getStateValue('availableModels');
        const models = raw ? JSON.parse(raw) : [];
        return Response.json({ models });
      }
      case '/prompt': {
        // HTTP-based prompt submission (alternative to WebSocket)
        const body = await request.json() as { content: string; model?: string; interrupt?: boolean };
        if (!body.content) {
          return new Response(JSON.stringify({ error: 'Missing content' }), { status: 400 });
        }
        if (body.interrupt) {
          await this.handleInterruptPrompt(body.content, body.model);
        } else {
          await this.handlePrompt(body.content, body.model);
        }
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

    // Cache user details for author attribution (only fetch if not already cached)
    if (!this.userDetailsCache.has(userId)) {
      try {
        const userRow = await this.env.DB.prepare(
          'SELECT id, email, name, avatar_url, git_name, git_email, model_preferences FROM users WHERE id = ?'
        ).bind(userId).first<{ id: string; email: string; name: string | null; avatar_url: string | null; git_name: string | null; git_email: string | null; model_preferences: string | null }>();
        if (userRow) {
          this.userDetailsCache.set(userId, {
            id: userRow.id,
            email: userRow.email,
            name: userRow.name || undefined,
            avatarUrl: userRow.avatar_url || undefined,
            gitName: userRow.git_name || undefined,
            gitEmail: userRow.git_email || undefined,
            modelPreferences: userRow.model_preferences ? JSON.parse(userRow.model_preferences) : undefined,
          });
        }
      } catch (err) {
        console.error('Failed to fetch user details for cache:', err);
      }
    }

    // Send full session state as a single init message (prevents duplicates on reconnect)
    const messages = this.ctx.storage.sql
      .exec('SELECT id, role, content, parts, author_id, author_email, author_name, author_avatar_url, created_at FROM messages ORDER BY created_at ASC')
      .toArray();

    const status = this.getStateValue('status') || 'idle';
    const sandboxId = this.getStateValue('sandboxId');
    const connectedUsers = await this.getConnectedUsersWithDetails();
    const sessionId = this.getStateValue('sessionId');
    const workspace = this.getStateValue('workspace') || '';
    const title = this.getStateValue('title');

    const availableModelsRaw = this.getStateValue('availableModels');
    const availableModels = availableModelsRaw ? JSON.parse(availableModelsRaw) : undefined;

    // Load audit log for late joiners
    const auditLogRows = this.ctx.storage.sql
      .exec('SELECT event_type, summary, actor_id, metadata, created_at FROM audit_log ORDER BY id ASC')
      .toArray();

    server.send(JSON.stringify({
      type: 'init',
      session: {
        id: sessionId,
        status,
        workspace,
        title,
        messages: messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          parts: msg.parts ? JSON.parse(msg.parts as string) : undefined,
          authorId: msg.author_id || undefined,
          authorEmail: msg.author_email || undefined,
          authorName: msg.author_name || undefined,
          authorAvatarUrl: msg.author_avatar_url || undefined,
          createdAt: msg.created_at,
        })),
      },
      data: {
        sandboxRunning: !!sandboxId,
        runnerConnected: this.ctx.getWebSockets('runner').length > 0,
        runnerBusy: this.getStateValue('runnerBusy') === 'true',
        promptsQueued: this.getQueueLength(),
        connectedClients: this.getClientSockets().length + 1,
        connectedUsers,
        availableModels,
        auditLog: auditLogRows.map((row) => ({
          eventType: row.event_type,
          summary: row.summary,
          actorId: row.actor_id || undefined,
          metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
          createdAt: row.created_at,
        })),
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

    // Notify other clients that a user joined (with enriched user details)
    const userDetails = this.userDetailsCache.get(userId);
    this.broadcastToClients({
      type: 'user.joined',
      userId,
      userDetails: userDetails ? { name: userDetails.name, email: userDetails.email, avatarUrl: userDetails.avatarUrl } : undefined,
      connectedUsers,
    });

    this.appendAuditLog('user.joined', `${userDetails?.name || userDetails?.email || userId} joined`, userId);

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

    // DO not yet initialized — runner connected before /start was called (race condition)
    if (!expectedToken) {
      return new Response('Session not initialized yet', { status: 503 });
    }

    if (!token || token !== expectedToken) {
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
      .exec("SELECT id, content, author_id, author_email, author_name FROM prompt_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
      .toArray();

    if (queued.length > 0) {
      const prompt = queued[0];
      this.ctx.storage.sql.exec(
        "UPDATE prompt_queue SET status = 'processing' WHERE id = ?",
        prompt.id as string
      );
      const authorId = prompt.author_id as string | null;
      const authorDetails = authorId ? this.userDetailsCache.get(authorId) : undefined;
      if (authorId) {
        this.setStateValue('currentPromptAuthorId', authorId);
      }
      // Resolve model preferences from session owner
      const initOwnerId = this.getStateValue('userId');
      const initOwnerDetails = initOwnerId ? await this.getUserDetails(initOwnerId) : undefined;
      server.send(JSON.stringify({
        type: 'prompt',
        messageId: prompt.id,
        content: prompt.content,
        authorId: authorId || undefined,
        authorEmail: prompt.author_email || undefined,
        authorName: prompt.author_name || undefined,
        gitName: authorDetails?.gitName,
        gitEmail: authorDetails?.gitEmail,
        modelPreferences: initOwnerDetails?.modelPreferences,
      }));
      this.setStateValue('runnerBusy', 'true');
    } else {
      // Check for initial prompt (from create-from-PR/Issue)
      const initialPrompt = this.getStateValue('initialPrompt');
      if (initialPrompt) {
        // Clear it so it only fires once
        this.setStateValue('initialPrompt', '');
        // Queue it through the normal prompt flow
        const messageId = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
          messageId, 'user', initialPrompt
        );
        this.broadcastToClients({
          type: 'message',
          data: {
            id: messageId,
            role: 'user',
            content: initialPrompt,
            createdAt: Math.floor(Date.now() / 1000),
          },
        });
        const ipOwnerId = this.getStateValue('userId');
        const ipOwnerDetails = ipOwnerId ? await this.getUserDetails(ipOwnerId) : undefined;
        const initialModel = this.getStateValue('initialModel');
        if (initialModel) {
          this.setStateValue('initialModel', ''); // Clear so it only applies once
        }
        server.send(JSON.stringify({
          type: 'prompt',
          messageId,
          content: initialPrompt,
          model: initialModel || undefined,
          modelPreferences: ipOwnerDetails?.modelPreferences,
        }));
        this.setStateValue('runnerBusy', 'true');
      }
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

          // Grab user details before cleaning up the cache
          const departingUserDetails = this.userDetailsCache.get(userId);
          const connectedUsers = await this.getConnectedUsersWithDetails();
          this.broadcastToClients({
            type: 'user.left',
            userId,
            userDetails: departingUserDetails
              ? { name: departingUserDetails.name, email: departingUserDetails.email, avatarUrl: departingUserDetails.avatarUrl }
              : undefined,
            connectedUsers,
          });

          this.appendAuditLog('user.left', `${departingUserDetails?.name || departingUserDetails?.email || userId} left`, userId);

          // Clean up user details cache if no longer connected
          this.userDetailsCache.delete(userId);

          this.notifyEventBus({
            type: 'session.update',
            sessionId: this.getStateValue('sessionId'),
            userId,
            data: { event: 'user.left', connectedUsers: this.getConnectedUserIds() },
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
    const now = Date.now();
    const nowSecs = Math.floor(now / 1000);

    // ─── Idle Hibernate Check ─────────────────────────────────────────
    const status = this.getStateValue('status');
    const idleTimeoutMsStr = this.getStateValue('idleTimeoutMs');
    const lastActivityStr = this.getStateValue('lastUserActivityAt');

    if (status === 'running' && idleTimeoutMsStr && lastActivityStr) {
      const idleTimeoutMs = parseInt(idleTimeoutMsStr);
      const lastActivity = parseInt(lastActivityStr);

      if (now - lastActivity >= idleTimeoutMs) {
        // Trigger hibernate
        this.ctx.waitUntil(this.performHibernate());
        // Don't return — still process question expiry below
      }
    }

    // ─── Periodic Metrics Flush ──────────────────────────────────────
    this.ctx.waitUntil(this.flushMetrics());

    // ─── Question Expiry ──────────────────────────────────────────────
    const expired = this.ctx.storage.sql
      .exec(
        "SELECT id, text FROM questions WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
        nowSecs
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
      if (nextMs > now) {
        this.ctx.storage.setAlarm(nextMs);
      }
    }
  }

  // ─── Client Message Handling ───────────────────────────────────────────

  private async handleClientMessage(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case 'prompt': {
        if (!msg.content) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing content' }));
          return;
        }
        // Extract userId from WebSocket tag for authorship tracking
        const clientTag = this.ctx.getTags(ws).find((t: string) => t.startsWith('client:'));
        const userId = clientTag?.replace('client:', '');
        const userDetails = userId ? this.userDetailsCache.get(userId) : undefined;
        const author = userDetails ? {
          id: userDetails.id,
          email: userDetails.email,
          name: userDetails.name,
          avatarUrl: userDetails.avatarUrl,
          gitName: userDetails.gitName,
          gitEmail: userDetails.gitEmail,
        } : userId ? { id: userId, email: '', name: undefined, avatarUrl: undefined, gitName: undefined, gitEmail: undefined } : undefined;
        await this.handlePrompt(msg.content, msg.model, author);
        break;
      }

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

      case 'abort':
        await this.handleAbort();
        break;

      case 'revert':
        if (!msg.messageId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing messageId' }));
          return;
        }
        await this.handleRevert(msg.messageId);
        break;

      case 'diff':
        await this.handleDiff();
        break;

      case 'review': {
        const reviewRequestId = crypto.randomUUID();
        this.sendToRunner({ type: 'review', requestId: reviewRequestId });
        break;
      }
    }
  }

  private async handlePrompt(
    content: string,
    model?: string,
    author?: { id: string; email: string; name?: string; avatarUrl?: string; gitName?: string; gitEmail?: string }
  ) {
    // Update idle tracking
    this.setStateValue('lastUserActivityAt', String(Date.now()));
    this.rescheduleIdleAlarm();

    // Track the current prompt author for PR attribution (Part 6)
    if (author?.id) {
      this.setStateValue('currentPromptAuthorId', author.id);
    }

    // If hibernated, auto-trigger wake before processing
    const currentStatus = this.getStateValue('status');
    if (currentStatus === 'hibernated') {
      // Fire wake in background — prompt will be queued since runner won't be connected yet
      this.ctx.waitUntil(this.performWake());
    }

    // Store user message with author info
    const messageId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      'INSERT INTO messages (id, role, content, author_id, author_email, author_name, author_avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      messageId, 'user', content,
      author?.id || null, author?.email || null, author?.name || null, author?.avatarUrl || null
    );

    // Broadcast user message to all clients (includes author info)
    this.broadcastToClients({
      type: 'message',
      data: {
        id: messageId,
        role: 'user',
        content,
        authorId: author?.id,
        authorEmail: author?.email,
        authorName: author?.name,
        authorAvatarUrl: author?.avatarUrl,
        createdAt: Math.floor(Date.now() / 1000),
      },
    });

    this.appendAuditLog('user.prompt', content.slice(0, 120), author?.id);

    // Check if runner is busy
    const runnerBusy = this.getStateValue('runnerBusy') === 'true';
    const runnerSockets = this.ctx.getWebSockets('runner');

    if (runnerSockets.length === 0) {
      // No runner connected — queue the prompt with author info
      this.ctx.storage.sql.exec(
        "INSERT INTO prompt_queue (id, content, status, author_id, author_email, author_name, author_avatar_url) VALUES (?, ?, 'queued', ?, ?, ?, ?)",
        messageId, content,
        author?.id || null, author?.email || null, author?.name || null, author?.avatarUrl || null
      );
      this.broadcastToClients({
        type: 'status',
        data: { promptQueued: true, queuePosition: this.getQueueLength() },
      });
      return;
    }

    if (runnerBusy) {
      // Runner is processing another prompt — queue with author info
      this.ctx.storage.sql.exec(
        "INSERT INTO prompt_queue (id, content, status, author_id, author_email, author_name, author_avatar_url) VALUES (?, ?, 'queued', ?, ?, ?, ?)",
        messageId, content,
        author?.id || null, author?.email || null, author?.name || null, author?.avatarUrl || null
      );
      this.broadcastToClients({
        type: 'status',
        data: { promptQueued: true, queuePosition: this.getQueueLength() },
      });
      return;
    }

    // Forward directly to runner with author info
    this.setStateValue('runnerBusy', 'true');
    // Resolve model preferences: use the session owner's preferences
    const ownerId = this.getStateValue('userId');
    const ownerDetails = ownerId ? await this.getUserDetails(ownerId) : undefined;
    this.sendToRunner({
      type: 'prompt',
      messageId,
      content,
      model,
      authorId: author?.id,
      authorEmail: author?.email,
      authorName: author?.name,
      gitName: author?.gitName,
      gitEmail: author?.gitEmail,
      modelPreferences: ownerDetails?.modelPreferences,
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

    this.appendAuditLog('user.answer', `Answered question: ${String(answer).slice(0, 80)}`, undefined, { questionId });

    // Notify EventBus
    this.notifyEventBus({
      type: 'question.answered',
      sessionId: this.getStateValue('sessionId'),
      data: { questionId, answer: String(answer) },
      timestamp: new Date().toISOString(),
    });
  }

  private async handleAbort() {
    // Clear prompt queue
    this.ctx.storage.sql.exec("DELETE FROM prompt_queue WHERE status = 'queued'");

    // Forward abort to runner
    this.sendToRunner({ type: 'abort' });

    // Broadcast status immediately (runner will confirm with 'aborted')
    this.broadcastToClients({
      type: 'agentStatus',
      status: 'idle',
    });

    this.appendAuditLog('user.abort', 'User aborted agent');
  }

  private async handleInterruptPrompt(content: string, model?: string) {
    const runnerBusy = this.getStateValue('runnerBusy') === 'true';
    if (runnerBusy) {
      // Abort current work (clears queue, sends abort to runner)
      await this.handleAbort();
    }
    // Queue the new prompt — when the runner confirms abort, handlePromptComplete
    // will drain the queue and send this prompt to the runner
    await this.handlePrompt(content, model);
  }

  private async handleRevert(messageId: string) {
    // Find the message and all messages created at or after it
    const targetMsg = this.ctx.storage.sql
      .exec('SELECT created_at FROM messages WHERE id = ?', messageId)
      .toArray();

    if (targetMsg.length === 0) {
      return; // Message not found
    }

    const createdAt = targetMsg[0].created_at as number;
    const affectedMessages = this.ctx.storage.sql
      .exec('SELECT id FROM messages WHERE created_at >= ? ORDER BY created_at ASC', createdAt)
      .toArray();

    const removedIds = affectedMessages.map((m) => m.id as string);

    // Delete the messages from SQLite
    if (removedIds.length > 0) {
      const placeholders = removedIds.map(() => '?').join(',');
      this.ctx.storage.sql.exec(
        `DELETE FROM messages WHERE id IN (${placeholders})`,
        ...removedIds
      );
    }

    // Forward to runner so OpenCode can revert too
    this.sendToRunner({ type: 'revert', messageId });

    // Broadcast removal to all clients
    this.broadcastToClients({
      type: 'messages.removed',
      messageIds: removedIds,
    });
  }

  private async handleDiff() {
    const requestId = crypto.randomUUID();
    this.sendToRunner({ type: 'diff', requestId });
  }

  // ─── Runner Message Handling ───────────────────────────────────────────

  private async handleRunnerMessage(msg: RunnerMessage) {
    console.log(`[SessionAgentDO] Runner message: type=${msg.type}`);

    // Reset idle timer on any runner activity — agent work counts as session activity
    if (msg.type === 'tool' || msg.type === 'result' || msg.type === 'stream' || msg.type === 'agentStatus') {
      this.setStateValue('lastUserActivityAt', String(Date.now()));
      this.rescheduleIdleAlarm();
    }

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
        // Upsert tool call by callID — each tool gets one row that updates in place
        const toolId = msg.callID || crypto.randomUUID();
        const toolStatus = (msg.status as ToolCallStatus) || 'completed';
        const parts = JSON.stringify({
          toolName: msg.toolName,
          status: toolStatus,
          args: msg.args,
          result: msg.result,
        });
        const content = msg.content || `Tool: ${msg.toolName}`;

        // Check if this tool message already exists
        const existing = this.ctx.storage.sql
          .exec('SELECT id FROM messages WHERE id = ?', toolId)
          .toArray();

        if (existing.length === 0) {
          // First time seeing this callID — insert and broadcast as new message
          this.ctx.storage.sql.exec(
            'INSERT INTO messages (id, role, content, parts) VALUES (?, ?, ?, ?)',
            toolId, 'tool', content, parts
          );
          this.broadcastToClients({
            type: 'message',
            data: {
              id: toolId,
              role: 'tool',
              content,
              parts: { toolName: msg.toolName, status: toolStatus, args: msg.args, result: msg.result },
              createdAt: Math.floor(Date.now() / 1000),
            },
          });
          this.appendAuditLog('agent.tool_call', `${msg.toolName || 'unknown'}`, undefined, { toolId, toolName: msg.toolName });
        } else {
          // Update existing row and broadcast as message.updated
          this.ctx.storage.sql.exec(
            'UPDATE messages SET content = ?, parts = ? WHERE id = ?',
            content, parts, toolId
          );
          this.broadcastToClients({
            type: 'message.updated',
            data: {
              id: toolId,
              role: 'tool',
              content,
              parts: { toolName: msg.toolName, status: toolStatus, args: msg.args, result: msg.result },
              createdAt: Math.floor(Date.now() / 1000),
            },
          });
          if (toolStatus === 'completed' || toolStatus === 'error') {
            this.appendAuditLog('agent.tool_completed', `${msg.toolName || 'unknown'} ${toolStatus}`, undefined, { toolId, toolName: msg.toolName, status: toolStatus });
          }
        }
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
        // Always generate a new ID — msg.messageId is the prompt's user message ID,
        // which already exists in the messages table (PRIMARY KEY conflict).
        const errId = crypto.randomUUID();
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
        this.appendAuditLog('agent.error', errorText.slice(0, 120));

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
        // Flush metrics after each agent turn
        this.ctx.waitUntil(this.flushMetrics());
        break;

      case 'agentStatus':
        // Forward agent status to all clients for real-time activity indication
        this.broadcastToClients({
          type: 'agentStatus',
          status: msg.status,
          detail: msg.detail,
        });
        break;

      case 'create-pr': {
        // Runner requests PR creation — call GitHub API directly
        await this.handleCreatePR({
          requestId: msg.requestId,
          branch: msg.branch!,
          title: msg.title!,
          body: msg.body,
          base: msg.base,
        });
        break;
      }

      case 'update-pr': {
        // Runner requests PR update — call GitHub API directly
        await this.handleUpdatePR({
          requestId: msg.requestId,
          prNumber: msg.prNumber!,
          title: msg.title,
          body: msg.body,
          state: msg.state,
          labels: msg.labels,
        });
        break;
      }

      case 'models':
        // Runner discovered available models — store and broadcast to clients
        if (msg.models) {
          this.setStateValue('availableModels', JSON.stringify(msg.models));
          this.broadcastToClients({
            type: 'models',
            models: msg.models,
          });
          // Persist to D1 so the settings typeahead works without a running session
          const userId = this.getStateValue('userId');
          if (userId) {
            this.env.DB.prepare('UPDATE users SET discovered_models = ? WHERE id = ?')
              .bind(JSON.stringify(msg.models), userId)
              .run()
              .catch((err: unknown) => console.error('[SessionAgentDO] Failed to cache models to D1:', err));
          }
        }
        break;

      case 'model-switched': {
        // Runner switched models due to provider error — store notice and broadcast
        const switchId = crypto.randomUUID();
        const switchText = `Model switched from ${msg.fromModel} to ${msg.toModel}: ${msg.reason}`;
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
          switchId, 'system', switchText
        );
        this.broadcastToClients({
          type: 'model-switched',
          messageId: switchId,
          fromModel: msg.fromModel,
          toModel: msg.toModel,
          reason: msg.reason,
        });
        this.appendAuditLog('agent.error', switchText.slice(0, 120));
        break;
      }

      case 'aborted':
        // Runner confirmed abort — mark idle, broadcast
        this.setStateValue('runnerBusy', 'false');
        this.broadcastToClients({
          type: 'agentStatus',
          status: 'idle',
        });
        this.broadcastToClients({
          type: 'status',
          data: { runnerBusy: false, aborted: true },
        });
        // Drain the queue — if prompts were queued after abort, process them now
        await this.handlePromptComplete();
        break;

      case 'reverted':
        // Runner confirmed revert — log for now
        console.log(`[SessionAgentDO] Revert confirmed for messages: ${msg.messageIds?.join(', ')}`);
        break;

      case 'diff':
        // Runner returned diff data — broadcast to clients
        // Runner sends { type, requestId, data: { files } } or { type, requestId, files }
        const diffPayload = typeof msg.data === 'object' && msg.data !== null ? msg.data as Record<string, unknown> : null;
        const diffFiles = diffPayload?.files ?? msg.files ?? [];
        this.broadcastToClients({
          type: 'diff',
          requestId: msg.requestId,
          data: { files: diffFiles },
        });
        break;

      case 'review-result':
        // Runner returned structured review result — broadcast to clients (not stored in DB)
        this.broadcastToClients({
          type: 'review-result',
          requestId: msg.requestId,
          data: msg.data,
          diffFiles: msg.diffFiles,
          error: msg.error,
        });
        break;

      case 'git-state': {
        // Runner reports current git branch/commit state
        const sessionId = this.getStateValue('sessionId');
        if (sessionId) {
          const gitUpdates: Record<string, string | number> = {};
          if (msg.branch !== undefined) gitUpdates.branch = msg.branch;
          if (msg.baseBranch !== undefined) gitUpdates.baseBranch = msg.baseBranch;
          if (msg.commitCount !== undefined) gitUpdates.commitCount = msg.commitCount;

          if (Object.keys(gitUpdates).length > 0) {
            updateSessionGitState(this.env.DB, sessionId, gitUpdates as any).catch((err) =>
              console.error('[SessionAgentDO] Failed to update git state in D1:', err),
            );
          }
        }
        this.broadcastToClients({
          type: 'git-state',
          data: {
            branch: msg.branch,
            baseBranch: msg.baseBranch,
            commitCount: msg.commitCount,
          },
        } as any);
        break;
      }

      case 'pr-created': {
        // Runner reports a PR was created
        const sessionIdPr = this.getStateValue('sessionId');
        if (sessionIdPr && msg.number) {
          updateSessionGitState(this.env.DB, sessionIdPr, {
            prNumber: msg.number,
            prTitle: msg.title,
            prUrl: msg.url,
            prState: (msg.status as any) || 'open',
            prCreatedAt: new Date().toISOString(),
          }).catch((err) =>
            console.error('[SessionAgentDO] Failed to update PR state in D1:', err),
          );
        }
        this.broadcastToClients({
          type: 'pr-created',
          data: {
            number: msg.number,
            title: msg.title,
            url: msg.url,
            state: msg.status || 'open',
          },
        } as any);
        this.appendAuditLog('git.pr_created', `PR #${msg.number}: ${msg.title || ''}`, undefined, { prNumber: msg.number, prUrl: msg.url });
        break;
      }

      case 'files-changed': {
        // Runner reports files changed — upsert in D1, broadcast to clients
        const sessionIdFc = this.getStateValue('sessionId');
        const filesChanged = (msg as any).files as Array<{ path: string; status: string; additions?: number; deletions?: number }> | undefined;
        if (sessionIdFc && Array.isArray(filesChanged)) {
          for (const file of filesChanged) {
            upsertSessionFileChanged(this.env.DB, sessionIdFc, {
              filePath: file.path,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
            }).catch((err) =>
              console.error('[SessionAgentDO] Failed to upsert file changed:', err),
            );
          }
        }
        this.broadcastToClients({
          type: 'files-changed',
          files: filesChanged ?? [],
        } as any);
        break;
      }

      case 'child-session': {
        // Runner reports a child/sub-agent session was spawned
        this.broadcastToClients({
          type: 'child-session',
          childSessionId: (msg as any).childSessionId,
          title: msg.title,
        } as any);
        break;
      }

      case 'title': {
        // Runner reports session title update
        const sessionIdTitle = this.getStateValue('sessionId');
        const newTitle = msg.title || msg.content;
        if (sessionIdTitle && newTitle) {
          this.setStateValue('title', newTitle);
          updateSessionTitle(this.env.DB, sessionIdTitle, newTitle).catch((err) =>
            console.error('[SessionAgentDO] Failed to update session title:', err),
          );
        }
        this.broadcastToClients({
          type: 'title',
          title: newTitle,
        } as any);
        break;
      }

      case 'spawn-child':
        await this.handleSpawnChild(msg.requestId!, {
          task: msg.task!,
          workspace: msg.workspace!,
          repoUrl: msg.repoUrl,
          branch: msg.branch,
          title: msg.title,
          sourceType: msg.sourceType,
          sourcePrNumber: msg.sourcePrNumber,
          sourceIssueNumber: msg.sourceIssueNumber,
          sourceRepoFullName: msg.sourceRepoFullName,
          model: msg.model,
        });
        break;

      case 'session-message':
        await this.handleSessionMessage(msg.requestId!, msg.targetSessionId!, msg.content!, msg.interrupt);
        break;

      case 'session-messages':
        await this.handleSessionMessages(msg.requestId!, msg.targetSessionId!, msg.limit, msg.after);
        break;

      case 'terminate-child':
        await this.handleTerminateChild(msg.requestId!, msg.childSessionId!);
        break;

      case 'self-terminate':
        await this.handleSelfTerminate();
        break;

      // ─── Orchestrator Operations ──────────────────────────────────────
      case 'memory-read':
        await this.handleMemoryRead(msg.requestId!, msg.category, msg.query, msg.limit);
        break;

      case 'memory-write':
        await this.handleMemoryWrite(msg.requestId!, msg.content!, msg.category!);
        break;

      case 'memory-delete':
        await this.handleMemoryDelete(msg.requestId!, msg.memoryId!);
        break;

      case 'list-repos':
        await this.handleListRepos(msg.requestId!, msg.source);
        break;

      case 'list-pull-requests':
        await this.handleListPullRequests(msg.requestId!, {
          owner: msg.owner,
          repo: msg.repo,
          state: msg.state,
          limit: msg.limit,
        });
        break;

      case 'inspect-pull-request':
        await this.handleInspectPullRequest(msg.requestId!, {
          prNumber: msg.prNumber!,
          owner: msg.owner,
          repo: msg.repo,
          filesLimit: msg.filesLimit,
          commentsLimit: msg.commentsLimit,
        });
        break;

      case 'list-personas':
        await this.handleListPersonas(msg.requestId!);
        break;

      case 'get-session-status':
        await this.handleGetSessionStatus(msg.requestId!, msg.targetSessionId!);
        break;

      case 'list-child-sessions':
        await this.handleListChildSessions(msg.requestId!);
        break;

      case 'forward-messages':
        await this.handleForwardMessages(msg.requestId!, msg.targetSessionId!, msg.limit, msg.after);
        break;

      case 'ping':
        // Keepalive from runner — respond with pong
        this.sendToRunner({ type: 'pong' });
        break;
    }
  }

  // ─── Cross-Session Operations ─────────────────────────────────────────

  private async handleSpawnChild(
    requestId: string,
    params: {
      task: string; workspace: string; repoUrl?: string; branch?: string; title?: string;
      sourceType?: string; sourcePrNumber?: number; sourceIssueNumber?: number; sourceRepoFullName?: string;
      model?: string;
    },
  ) {
    try {
      const parentSessionId = this.getStateValue('sessionId')!;
      const userId = this.getStateValue('userId')!;
      const spawnRequestStr = this.getStateValue('spawnRequest');
      const backendUrl = this.getStateValue('backendUrl');
      const terminateUrl = this.getStateValue('terminateUrl');
      const hibernateUrl = this.getStateValue('hibernateUrl');
      const restoreUrl = this.getStateValue('restoreUrl');

      if (!spawnRequestStr || !backendUrl) {
        this.sendToRunner({ type: 'spawn-child-result', requestId, error: 'Session not configured for spawning children (missing spawnRequest or backendUrl)' });
        return;
      }

      const parentSpawnRequest = JSON.parse(spawnRequestStr);

      // Query parent's git state to use as defaults for the child
      const parentGitState = await getSessionGitState(this.env.DB, parentSessionId);

      // Merge: explicit params override parent defaults
      const mergedRepoUrl = params.repoUrl || parentGitState?.sourceRepoUrl || undefined;
      const mergedBranch = params.branch || parentGitState?.branch || undefined;
      const mergedSourceType = params.sourceType || parentGitState?.sourceType || undefined;
      const mergedSourcePrNumber = params.sourcePrNumber ?? parentGitState?.sourcePrNumber ?? undefined;
      const mergedSourceIssueNumber = params.sourceIssueNumber ?? parentGitState?.sourceIssueNumber ?? undefined;
      const mergedSourceRepoFullName = params.sourceRepoFullName || parentGitState?.sourceRepoFullName || undefined;

      // Generate child session identifiers
      const childSessionId = crypto.randomUUID();
      const childRunnerToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Create child session in D1
      await createSession(this.env.DB, {
        id: childSessionId,
        userId,
        workspace: params.workspace,
        title: params.title || params.workspace,
        parentSessionId,
      });

      // Create git state for child (always create if we have any git context)
      if (mergedRepoUrl || mergedSourceType) {
        // Derive sourceRepoFullName from URL if not explicitly set
        let derivedRepoFullName = mergedSourceRepoFullName;
        if (!derivedRepoFullName && mergedRepoUrl) {
          const match = mergedRepoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
          if (match) derivedRepoFullName = match[1];
        }

        await createSessionGitState(this.env.DB, {
          sessionId: childSessionId,
          sourceType: (mergedSourceType as any) || 'branch',
          sourceRepoUrl: mergedRepoUrl,
          sourceRepoFullName: derivedRepoFullName,
          branch: mergedBranch,
          sourcePrNumber: mergedSourcePrNumber,
          sourceIssueNumber: mergedSourceIssueNumber,
        });
      }

      // Build child DO WebSocket URL
      // Extract host from backendUrl or use the parent's DO WebSocket pattern
      const parentDoWsUrl = parentSpawnRequest.doWsUrl as string;
      // Replace parent sessionId with child sessionId in the URL
      const childDoWsUrl = parentDoWsUrl.replace(parentSessionId, childSessionId);

      // Build child spawn request, inheriting parent env vars
      const childSpawnRequest = {
        ...parentSpawnRequest,
        sessionId: childSessionId,
        doWsUrl: childDoWsUrl,
        runnerToken: childRunnerToken,
        workspace: params.workspace,
        envVars: {
          ...parentSpawnRequest.envVars,
          PARENT_SESSION_ID: parentSessionId,
        },
      };

      // Override repo-specific env vars if we have repo info (explicit or inherited)
      if (mergedRepoUrl) {
        childSpawnRequest.envVars = {
          ...childSpawnRequest.envVars,
          REPO_URL: mergedRepoUrl,
        };
        if (mergedBranch) {
          childSpawnRequest.envVars.REPO_BRANCH = mergedBranch;
        }

        // Inject git credentials if the parent doesn't have them (e.g. orchestrator)
        if (!childSpawnRequest.envVars.GITHUB_TOKEN) {
          try {
            const oauthToken = await getOAuthToken(this.env.DB, userId, 'github');
            if (oauthToken) {
              childSpawnRequest.envVars.GITHUB_TOKEN = await decryptString(
                oauthToken.encryptedAccessToken,
                this.env.ENCRYPTION_KEY,
              );
            }
          } catch (err) {
            console.warn('[SessionAgentDO] Failed to fetch GitHub token for child:', err);
          }
        }

        // Inject git user identity if missing
        if (!childSpawnRequest.envVars.GIT_USER_NAME || !childSpawnRequest.envVars.GIT_USER_EMAIL) {
          try {
            const userRow = await getUserById(this.env.DB, userId);
            if (userRow) {
              if (!childSpawnRequest.envVars.GIT_USER_NAME) {
                childSpawnRequest.envVars.GIT_USER_NAME = userRow.gitName || userRow.name || userRow.githubUsername || 'Agent Ops User';
              }
              if (!childSpawnRequest.envVars.GIT_USER_EMAIL) {
                childSpawnRequest.envVars.GIT_USER_EMAIL = userRow.gitEmail || userRow.email;
              }
            }
          } catch (err) {
            console.warn('[SessionAgentDO] Failed to fetch user info for child git config:', err);
          }
        }
      }

      // Initialize child SessionAgentDO
      const childDoId = this.env.SESSIONS.idFromName(childSessionId);
      const childDO = this.env.SESSIONS.get(childDoId);

      const idleTimeoutMsStr = this.getStateValue('idleTimeoutMs');
      const idleTimeoutMs = idleTimeoutMsStr ? parseInt(idleTimeoutMsStr) : 900_000;

      await childDO.fetch(new Request('http://do/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: childSessionId,
          userId,
          workspace: params.workspace,
          runnerToken: childRunnerToken,
          backendUrl,
          terminateUrl: terminateUrl || undefined,
          hibernateUrl: hibernateUrl || undefined,
          restoreUrl: restoreUrl || undefined,
          idleTimeoutMs,
          spawnRequest: childSpawnRequest,
          initialPrompt: params.task,
          initialModel: params.model,
        }),
      }));

      this.sendToRunner({ type: 'spawn-child-result', requestId, childSessionId });
    } catch (err) {
      console.error('[SessionAgentDO] Failed to spawn child:', err);
      this.sendToRunner({
        type: 'spawn-child-result',
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSessionMessage(requestId: string, targetSessionId: string, content: string, interrupt?: boolean) {
    try {
      const userId = this.getStateValue('userId')!;

      // Verify target session belongs to the same user
      const targetSession = await getSession(this.env.DB, targetSessionId);
      if (!targetSession || targetSession.userId !== userId) {
        this.sendToRunner({ type: 'session-message-result', requestId, error: 'Session not found or access denied' });
        return;
      }

      // Forward prompt to target DO
      const targetDoId = this.env.SESSIONS.idFromName(targetSessionId);
      const targetDO = this.env.SESSIONS.get(targetDoId);

      const resp = await targetDO.fetch(new Request('http://do/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, interrupt: interrupt ?? false }),
      }));

      if (!resp.ok) {
        const errText = await resp.text();
        this.sendToRunner({ type: 'session-message-result', requestId, error: `Target DO returned ${resp.status}: ${errText}` });
        return;
      }

      this.sendToRunner({ type: 'session-message-result', requestId, success: true });
    } catch (err) {
      console.error('[SessionAgentDO] Failed to send message:', err);
      this.sendToRunner({
        type: 'session-message-result',
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSessionMessages(requestId: string, targetSessionId: string, limit?: number, after?: string) {
    try {
      const userId = this.getStateValue('userId')!;

      // Verify target session belongs to the same user
      const targetSession = await getSession(this.env.DB, targetSessionId);
      if (!targetSession || targetSession.userId !== userId) {
        this.sendToRunner({ type: 'session-messages-result', requestId, error: 'Session not found or access denied' });
        return;
      }

      // Fetch messages from the target DO's local SQLite (not D1)
      const messages = await this.fetchMessagesFromDO(targetSessionId, limit || 20, after);

      this.sendToRunner({
        type: 'session-messages-result',
        requestId,
        messages: messages.map((m: { role: string; content: string; createdAt: string }) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      console.error('[SessionAgentDO] Failed to read messages:', err);
      this.sendToRunner({
        type: 'session-messages-result',
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleForwardMessages(requestId: string, targetSessionId: string, limit?: number, after?: string) {
    try {
      const userId = this.getStateValue('userId')!;

      // Verify target session belongs to the same user
      const targetSession = await getSession(this.env.DB, targetSessionId);
      if (!targetSession || targetSession.userId !== userId) {
        this.sendToRunner({ type: 'forward-messages-result', requestId, error: 'Session not found or access denied' });
        return;
      }

      // Fetch messages from target DO
      const messages = await this.fetchMessagesFromDO(targetSessionId, limit || 20, after);

      if (messages.length === 0) {
        this.sendToRunner({ type: 'forward-messages-result', requestId, count: 0, sourceSessionId: targetSessionId });
        return;
      }

      // Insert each message into our own messages table with forwarded metadata
      const sessionTitle = targetSession.title || targetSession.workspace || targetSessionId.slice(0, 8);
      for (const msg of messages) {
        const newId = crypto.randomUUID();
        const parts = JSON.stringify({
          forwarded: true,
          sourceSessionId: targetSessionId,
          sourceSessionTitle: sessionTitle,
          originalRole: msg.role,
          originalCreatedAt: msg.createdAt,
        });

        // Store all forwarded messages as 'assistant' role for consistent left-aligned rendering
        this.ctx.storage.sql.exec(
          'INSERT INTO messages (id, role, content, parts) VALUES (?, ?, ?, ?)',
          newId, 'assistant', msg.content, parts
        );

        this.broadcastToClients({
          type: 'message',
          data: {
            id: newId,
            role: 'assistant',
            content: msg.content,
            parts: {
              forwarded: true,
              sourceSessionId: targetSessionId,
              sourceSessionTitle: sessionTitle,
              originalRole: msg.role,
              originalCreatedAt: msg.createdAt,
            },
            createdAt: Math.floor(Date.now() / 1000),
          },
        });
      }

      this.sendToRunner({
        type: 'forward-messages-result',
        requestId,
        count: messages.length,
        sourceSessionId: targetSessionId,
      });
    } catch (err) {
      console.error('[SessionAgentDO] Failed to forward messages:', err);
      this.sendToRunner({
        type: 'forward-messages-result',
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Fetch messages from another session's DO via internal HTTP endpoint. */
  private async fetchMessagesFromDO(
    targetSessionId: string,
    limit: number,
    after?: string,
  ): Promise<Array<{ role: string; content: string; createdAt: string }>> {
    const doId = this.env.SESSIONS.idFromName(targetSessionId);
    const targetDO = this.env.SESSIONS.get(doId);

    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);

    const res = await targetDO.fetch(new Request(`http://do/messages?${params}`));
    if (!res.ok) {
      throw new Error(`Target DO returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { messages: Array<{ role: string; content: string; createdAt: string }> };
    return data.messages;
  }

  private async handleTerminateChild(requestId: string, childSessionId: string) {
    try {
      const sessionId = this.getStateValue('sessionId')!;
      const userId = this.getStateValue('userId')!;

      // Verify the child belongs to this parent session
      const childSession = await getSession(this.env.DB, childSessionId);
      if (!childSession || childSession.userId !== userId) {
        this.sendToRunner({ type: 'terminate-child-result', requestId, error: 'Child session not found or access denied' });
        return;
      }
      if (childSession.parentSessionId !== sessionId) {
        this.sendToRunner({ type: 'terminate-child-result', requestId, error: 'Session is not a child of this session' });
        return;
      }

      // Stop the child via its DO
      const childDoId = this.env.SESSIONS.idFromName(childSessionId);
      const childDO = this.env.SESSIONS.get(childDoId);
      const resp = await childDO.fetch(new Request('http://do/stop', { method: 'POST' }));

      if (!resp.ok) {
        const errText = await resp.text();
        this.sendToRunner({ type: 'terminate-child-result', requestId, error: `Child DO returned ${resp.status}: ${errText}` });
        return;
      }

      this.sendToRunner({ type: 'terminate-child-result', requestId, success: true });
    } catch (err) {
      console.error('[SessionAgentDO] Failed to terminate child:', err);
      this.sendToRunner({
        type: 'terminate-child-result',
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSelfTerminate() {
    const sessionId = this.getStateValue('sessionId');
    console.log(`[SessionAgentDO] Session ${sessionId} self-terminating (task complete)`);

    // Reuse handleStop which handles sandbox teardown, cascade, etc.
    // The reason is 'completed' instead of 'user_stopped' — update the event after
    const response = await this.handleStop();

    // Override the event reason to 'completed' in D1
    // (handleStop already set status to 'terminated' and published session.completed with 'user_stopped')
    // We re-publish with the correct reason
    this.notifyEventBus({
      type: 'session.completed',
      sessionId: sessionId || undefined,
      userId: this.getStateValue('userId') || undefined,
      data: { sandboxId: this.getStateValue('sandboxId') || null, reason: 'completed' },
      timestamp: new Date().toISOString(),
    });

    return response;
  }

  // ─── Orchestrator Operations ────────────────────────────────────────────

  private async handleMemoryRead(requestId: string, category?: string, query?: string, limit?: number) {
    try {
      const userId = this.getStateValue('userId')!;
      const memories = await listOrchestratorMemories(this.env.DB, userId, { category, query, limit });

      // Boost relevance for accessed memories
      for (const mem of memories) {
        boostMemoryRelevance(this.env.DB, mem.id).catch(() => {});
      }

      this.sendToRunner({ type: 'memory-read-result', requestId, memories } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to read memories:', err);
      this.sendToRunner({ type: 'memory-read-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleMemoryWrite(requestId: string, content: string, category: string) {
    try {
      const userId = this.getStateValue('userId')!;
      const id = crypto.randomUUID();
      const memory = await createOrchestratorMemory(this.env.DB, {
        id,
        userId,
        category: category as any,
        content,
      });
      this.sendToRunner({ type: 'memory-write-result', requestId, memory, success: true } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to write memory:', err);
      this.sendToRunner({ type: 'memory-write-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleMemoryDelete(requestId: string, memoryId: string) {
    try {
      const userId = this.getStateValue('userId')!;
      const deleted = await deleteOrchestratorMemory(this.env.DB, memoryId, userId);
      this.sendToRunner({ type: 'memory-delete-result', requestId, success: deleted } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to delete memory:', err);
      this.sendToRunner({ type: 'memory-delete-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleListRepos(requestId: string, source?: string) {
    try {
      if (source === 'github') {
        const githubToken = await this.getGitHubToken();
        if (!githubToken) {
          this.sendToRunner({ type: 'list-repos-result', requestId, error: 'No GitHub token found — user must connect GitHub in settings' } as any);
          return;
        }
        // Fetch user's repos from GitHub API (up to 100, sorted by last push)
        const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'agent-ops',
          },
        });
        if (!res.ok) {
          const errText = await res.text();
          this.sendToRunner({ type: 'list-repos-result', requestId, error: `GitHub API error (${res.status}): ${errText}` } as any);
          return;
        }
        const ghRepos = await res.json() as { full_name: string; html_url: string; clone_url: string; description: string | null; language: string | null; default_branch: string; private: boolean; pushed_at: string }[];
        const repos = ghRepos.map(r => ({
          fullName: r.full_name,
          url: r.clone_url,
          htmlUrl: r.html_url,
          description: r.description,
          language: r.language,
          defaultBranch: r.default_branch,
          visibility: r.private ? 'private' : 'public',
          lastPushed: r.pushed_at,
        }));
        this.sendToRunner({ type: 'list-repos-result', requestId, repos } as any);
      } else {
        const repos = await listOrgRepositories(this.env.DB);
        this.sendToRunner({ type: 'list-repos-result', requestId, repos } as any);
      }
    } catch (err) {
      console.error('[SessionAgentDO] Failed to list repos:', err);
      this.sendToRunner({ type: 'list-repos-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleListPullRequests(
    requestId: string,
    params: { owner?: string; repo?: string; state?: string; limit?: number },
  ) {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        this.sendToRunner({ type: 'list-pull-requests-result', requestId, error: 'No GitHub token found — user must connect GitHub in settings' } as any);
        return;
      }

      const { owner, repo } = await this.resolveOwnerRepo(params.owner, params.repo);
      const state = params.state || 'open';
      const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=${encodeURIComponent(state)}&sort=updated&direction=desc&per_page=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'agent-ops',
          },
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        this.sendToRunner({ type: 'list-pull-requests-result', requestId, error: `GitHub API error (${res.status}): ${errText}` } as any);
        return;
      }

      const pulls = await res.json() as Array<{
        number: number;
        title: string;
        state: string;
        draft: boolean;
        body: string | null;
        html_url: string;
        created_at: string;
        updated_at: string;
        user: { login: string; avatar_url: string };
        head: { ref: string; sha: string };
        base: { ref: string; sha: string };
        labels: Array<{ name: string }>;
      }>;

      this.sendToRunner({
        type: 'list-pull-requests-result',
        requestId,
        pulls: pulls.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          body: pr.body,
          url: pr.html_url,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          author: { login: pr.user.login, avatarUrl: pr.user.avatar_url },
          headRef: pr.head.ref,
          headSha: pr.head.sha,
          baseRef: pr.base.ref,
          baseSha: pr.base.sha,
          labels: pr.labels?.map((label) => label.name) ?? [],
        })),
      } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to list pull requests:', err);
      this.sendToRunner({ type: 'list-pull-requests-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleInspectPullRequest(
    requestId: string,
    params: { prNumber: number; owner?: string; repo?: string; filesLimit?: number; commentsLimit?: number },
  ) {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        this.sendToRunner({ type: 'inspect-pull-request-result', requestId, error: 'No GitHub token found — user must connect GitHub in settings' } as any);
        return;
      }

      const { owner, repo } = await this.resolveOwnerRepo(params.owner, params.repo);
      const filesLimit = Math.min(Math.max(params.filesLimit ?? 200, 1), 300);
      const commentsLimit = Math.min(Math.max(params.commentsLimit ?? 100, 1), 300);

      const prResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${params.prNumber}`, {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'agent-ops',
        },
      });

      if (!prResp.ok) {
        const errText = await prResp.text();
        this.sendToRunner({ type: 'inspect-pull-request-result', requestId, error: `GitHub API error (${prResp.status}): ${errText}` } as any);
        return;
      }

      const pr = await prResp.json() as {
        number: number;
        title: string;
        state: string;
        draft: boolean;
        body: string | null;
        html_url: string;
        created_at: string;
        updated_at: string;
        closed_at: string | null;
        merged_at: string | null;
        user: { login: string; avatar_url: string };
        base: { ref: string; sha: string };
        head: { ref: string; sha: string };
        labels: Array<{ name: string }>;
        assignees: Array<{ login: string }>;
        requested_reviewers: Array<{ login: string }>;
        requested_teams: Array<{ name: string }>;
        mergeable: boolean | null;
        mergeable_state: string;
        commits: number;
        additions: number;
        deletions: number;
        changed_files: number;
      };

      const perPage = 100;
      let page = 1;
      const files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number }> = [];
      let filesTruncated = false;
      while (files.length < filesLimit) {
        const remaining = filesLimit - files.length;
        const pageSize = Math.min(perPage, remaining);
        const filesResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${params.prNumber}/files?per_page=${pageSize}&page=${page}`,
          {
            headers: {
              'Authorization': `Bearer ${githubToken}`,
              'Accept': 'application/vnd.github+json',
              'User-Agent': 'agent-ops',
            },
          },
        );
        if (!filesResp.ok) {
          const errText = await filesResp.text();
          throw new Error(`GitHub API error (${filesResp.status}) while fetching files: ${errText}`);
        }
        const pageFiles = await filesResp.json() as Array<{
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          changes: number;
        }>;
        files.push(...pageFiles.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
        })));
        if (pageFiles.length < pageSize) break;
        page += 1;
      }
      if (files.length >= filesLimit && pr.changed_files > filesLimit) filesTruncated = true;

      const reviewsResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${params.prNumber}/reviews?per_page=100`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'agent-ops',
          },
        },
      );

      const reviews = reviewsResp.ok
        ? await reviewsResp.json() as Array<{ id: number; user: { login: string }; state: string; submitted_at: string | null }>
        : [];
      const dismissedReviewIds = new Set(reviews.filter(r => r.state === 'DISMISSED').map(r => r.id));

      const reviewCounts = reviews.reduce<Record<string, number>>((acc, review) => {
        acc[review.state] = (acc[review.state] || 0) + 1;
        return acc;
      }, {});

      const reviewComments: Array<{
        id: number;
        user: { login: string };
        body: string;
        path: string;
        line: number | null;
        created_at: string;
        updated_at: string;
      }> = [];
      let commentsPage = 1;
      while (reviewComments.length < commentsLimit) {
        const remaining = commentsLimit - reviewComments.length;
        const pageSize = Math.min(perPage, remaining);
        const commentsResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${params.prNumber}/comments?per_page=${pageSize}&page=${commentsPage}`,
          {
            headers: {
              'Authorization': `Bearer ${githubToken}`,
              'Accept': 'application/vnd.github+json',
              'User-Agent': 'agent-ops',
            },
          },
        );
        if (!commentsResp.ok) {
          const errText = await commentsResp.text();
          throw new Error(`GitHub API error (${commentsResp.status}) while fetching review comments: ${errText}`);
        }
        const pageComments = await commentsResp.json() as Array<{
          id: number;
          user: { login: string };
          body: string;
          path: string;
          line: number | null;
          created_at: string;
          updated_at: string;
          pull_request_review_id?: number;
        }>;
        const filtered = pageComments.filter((comment) => {
          if (!comment.pull_request_review_id) return true;
          return !dismissedReviewIds.has(comment.pull_request_review_id);
        });
        reviewComments.push(...filtered.map((comment) => ({
          id: comment.id,
          user: { login: comment.user.login },
          body: comment.body,
          path: comment.path,
          line: comment.line,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
        })));
        if (pageComments.length < pageSize) break;
        commentsPage += 1;
      }
      const commentsTruncated = reviewComments.length >= commentsLimit;

      const statusResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${pr.head.sha}/status`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'agent-ops',
          },
        },
      );
      const statusData = statusResp.ok ? await statusResp.json() as {
        state: string;
        statuses: Array<{ state: string; context: string; description: string | null; target_url: string | null; updated_at: string }>;
      } : null;

      const checksResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'agent-ops',
          },
        },
      );
      const checksData = checksResp.ok ? await checksResp.json() as {
        total_count: number;
        check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string | null; app: { name: string } }>;
      } : null;

      const checkSummary = checksData?.check_runs.reduce<Record<string, number>>((acc, run) => {
        const key = run.conclusion || run.status || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}) ?? {};

      this.sendToRunner({
        type: 'inspect-pull-request-result',
        requestId,
        data: {
          repo: { owner, repo },
          pr: {
            number: pr.number,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            url: pr.html_url,
            body: pr.body,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            closedAt: pr.closed_at,
            mergedAt: pr.merged_at,
            author: { login: pr.user.login, avatarUrl: pr.user.avatar_url },
            baseRef: pr.base.ref,
            baseSha: pr.base.sha,
            headRef: pr.head.ref,
            headSha: pr.head.sha,
            labels: pr.labels?.map((label) => label.name) ?? [],
            assignees: pr.assignees?.map((assignee) => assignee.login) ?? [],
            requestedReviewers: pr.requested_reviewers?.map((reviewer) => reviewer.login) ?? [],
            requestedTeams: pr.requested_teams?.map((team) => team.name) ?? [],
            mergeable: pr.mergeable,
            mergeableState: pr.mergeable_state,
            commits: pr.commits,
            additions: pr.additions,
            deletions: pr.deletions,
            changedFiles: pr.changed_files,
          },
          files: {
            totalChangedFiles: pr.changed_files,
            returned: files.length,
            truncated: filesTruncated,
            items: files,
          },
          reviews: {
            counts: reviewCounts,
            items: reviews.map((review) => ({
              id: review.id,
              user: { login: review.user.login },
              state: review.state,
              submittedAt: review.submitted_at,
            })),
          },
          reviewComments: {
            returned: reviewComments.length,
            truncated: commentsTruncated,
            items: reviewComments,
          },
          checks: {
            status: statusData
              ? {
                state: statusData.state,
                items: statusData.statuses.map((s) => ({
                  state: s.state,
                  context: s.context,
                  description: s.description,
                  targetUrl: s.target_url,
                  updatedAt: s.updated_at,
                })),
              }
              : null,
            checkRuns: checksData
              ? {
                total: checksData.total_count,
                summary: checkSummary,
                items: checksData.check_runs.map((run) => ({
                  name: run.name,
                  status: run.status,
                  conclusion: run.conclusion,
                  url: run.html_url,
                  app: run.app?.name,
                })),
              }
              : null,
          },
        },
      } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to inspect pull request:', err);
      this.sendToRunner({ type: 'inspect-pull-request-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleListPersonas(requestId: string) {
    try {
      const userId = this.getStateValue('userId')!;
      const personas = await listPersonas(this.env.DB, userId);
      this.sendToRunner({ type: 'list-personas-result', requestId, personas } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to list personas:', err);
      this.sendToRunner({ type: 'list-personas-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleListChildSessions(requestId: string) {
    try {
      const sessionId = this.getStateValue('sessionId')!;
      const children = await getChildSessions(this.env.DB, sessionId);
      this.sendToRunner({ type: 'list-child-sessions-result', requestId, children } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to list child sessions:', err);
      this.sendToRunner({ type: 'list-child-sessions-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handleGetSessionStatus(requestId: string, targetSessionId: string) {
    try {
      const userId = this.getStateValue('userId')!;
      const session = await getSession(this.env.DB, targetSessionId);
      if (!session || session.userId !== userId) {
        this.sendToRunner({ type: 'get-session-status-result', requestId, error: 'Session not found or access denied' } as any);
        return;
      }

      // Fetch recent messages from the target DO's local SQLite (not D1)
      const recentMessages = await this.fetchMessagesFromDO(targetSessionId, 10);

      this.sendToRunner({
        type: 'get-session-status-result',
        requestId,
        sessionStatus: {
          id: session.id,
          status: session.status,
          workspace: session.workspace,
          title: session.title,
          createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : String(session.createdAt),
          lastActiveAt: session.lastActiveAt instanceof Date ? session.lastActiveAt.toISOString() : String(session.lastActiveAt),
          recentMessages,
        },
      } as any);
    } catch (err) {
      console.error('[SessionAgentDO] Failed to get session status:', err);
      this.sendToRunner({ type: 'get-session-status-result', requestId, error: err instanceof Error ? err.message : String(err) } as any);
    }
  }

  private async handlePromptComplete() {
    this.appendAuditLog('agent.turn_complete', 'Agent turn completed');

    // Mark any processing prompt_queue entries as completed
    this.ctx.storage.sql.exec(
      "UPDATE prompt_queue SET status = 'completed' WHERE status = 'processing'"
    );

    // Check for next queued prompt (includes author info)
    const next = this.ctx.storage.sql
      .exec("SELECT id, content, author_id, author_email, author_name FROM prompt_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
      .toArray();

    if (next.length > 0) {
      const prompt = next[0];
      this.ctx.storage.sql.exec(
        "UPDATE prompt_queue SET status = 'processing' WHERE id = ?",
        prompt.id as string
      );

      // Look up git details from cache for the prompt author
      const authorId = prompt.author_id as string | null;
      const authorDetails = authorId ? this.userDetailsCache.get(authorId) : undefined;

      // Track current prompt author for PR attribution
      if (authorId) {
        this.setStateValue('currentPromptAuthorId', authorId);
      }

      // Resolve model preferences from session owner
      const queueOwnerId = this.getStateValue('userId');
      const queueOwnerDetails = queueOwnerId ? await this.getUserDetails(queueOwnerId) : undefined;
      this.sendToRunner({
        type: 'prompt',
        messageId: prompt.id as string,
        content: prompt.content as string,
        authorId: authorId || undefined,
        authorEmail: (prompt.author_email as string) || undefined,
        authorName: (prompt.author_name as string) || undefined,
        gitName: authorDetails?.gitName,
        gitEmail: authorDetails?.gitEmail,
        modelPreferences: queueOwnerDetails?.modelPreferences,
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
      // For async sandbox spawning (DO calls Modal in the background)
      backendUrl?: string;
      terminateUrl?: string;
      hibernateUrl?: string;
      restoreUrl?: string;
      spawnRequest?: Record<string, unknown>;
      idleTimeoutMs?: number;
      initialPrompt?: string;
      initialModel?: string;
    };

    // Clear old session data (messages, queue, audit log) for a fresh start.
    // This is important for well-known DOs (orchestrators) that get reused.
    this.ctx.storage.sql.exec('DELETE FROM messages');
    this.ctx.storage.sql.exec('DELETE FROM prompt_queue');
    this.ctx.storage.sql.exec('DELETE FROM audit_log');

    // Store session state in durable SQLite
    this.setStateValue('sessionId', body.sessionId);
    this.setStateValue('userId', body.userId);
    this.setStateValue('workspace', body.workspace);
    this.setStateValue('runnerToken', body.runnerToken);
    this.setStateValue('status', 'initializing');
    this.setStateValue('runnerBusy', 'false');

    // Clear stale state from previous lifecycle
    this.setStateValue('sandboxId', '');
    this.setStateValue('tunnelUrls', '');
    this.setStateValue('runningStartedAt', '');

    if (body.sandboxId) {
      this.setStateValue('sandboxId', body.sandboxId);
    }
    if (body.tunnelUrls) {
      this.setStateValue('tunnelUrls', JSON.stringify(body.tunnelUrls));
    }
    if (body.terminateUrl) {
      this.setStateValue('terminateUrl', body.terminateUrl);
    }
    if (body.hibernateUrl) {
      this.setStateValue('hibernateUrl', body.hibernateUrl);
    }
    if (body.restoreUrl) {
      this.setStateValue('restoreUrl', body.restoreUrl);
    }
    if (body.idleTimeoutMs) {
      this.setStateValue('idleTimeoutMs', String(body.idleTimeoutMs));
    }
    if (body.backendUrl) {
      this.setStateValue('backendUrl', body.backendUrl);
    }
    if (body.spawnRequest) {
      this.setStateValue('spawnRequest', JSON.stringify(body.spawnRequest));
    }
    if (body.initialPrompt) {
      this.setStateValue('initialPrompt', body.initialPrompt);
    }
    if (body.initialModel) {
      this.setStateValue('initialModel', body.initialModel);
    }

    // Initialize idle tracking
    this.setStateValue('lastUserActivityAt', String(Date.now()));

    // If sandbox info was provided directly, we're already running
    if (body.sandboxId && body.tunnelUrls) {
      this.setStateValue('status', 'running');
      this.markRunningStarted();
      updateSessionStatus(this.env.DB, body.sessionId, 'running', body.sandboxId).catch((err) =>
        console.error('[SessionAgentDO] Failed to sync status to D1:', err),
      );
      this.broadcastToClients({
        type: 'status',
        data: {
          status: 'running',
          sandboxRunning: true,
          tunnelUrls: body.tunnelUrls,
        },
      });
      this.rescheduleIdleAlarm();
    } else if (body.backendUrl && body.spawnRequest) {
      // Spawn sandbox asynchronously — return immediately, DO continues in background
      this.broadcastToClients({
        type: 'status',
        data: { status: 'initializing' },
      });
      this.ctx.waitUntil(this.spawnSandbox(body.backendUrl, body.terminateUrl!, body.spawnRequest));
    }

    // Publish session.started to EventBus
    this.notifyEventBus({
      type: 'session.started',
      sessionId: body.sessionId,
      userId: body.userId,
      data: { workspace: body.workspace, sandboxId: body.sandboxId },
      timestamp: new Date().toISOString(),
    });

    this.appendAuditLog('session.started', `Session started for ${body.workspace}`, body.userId);

    return Response.json({
      success: true,
      status: 'initializing',
    });
  }

  /**
   * Spawn a sandbox via the Modal backend. Runs in the background via waitUntil()
   * so the Worker request can return immediately.
   */
  private async spawnSandbox(
    backendUrl: string,
    terminateUrl: string,
    spawnRequest: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = this.getStateValue('sessionId');
    try {
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spawnRequest),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Backend returned ${response.status}: ${err}`);
      }

      const result = await response.json() as {
        sandboxId: string;
        tunnelUrls: Record<string, string>;
      };

      // Store sandbox info
      this.setStateValue('sandboxId', result.sandboxId);
      this.setStateValue('tunnelUrls', JSON.stringify(result.tunnelUrls));
      this.setStateValue('status', 'running');
      this.markRunningStarted();

      // Sync status to D1 so sessions list shows correct status
      updateSessionStatus(this.env.DB, sessionId!, 'running', result.sandboxId).catch((err) =>
        console.error('[SessionAgentDO] Failed to sync status to D1:', err),
      );

      // Notify connected clients that sandbox is ready
      this.broadcastToClients({
        type: 'status',
        data: {
          status: 'running',
          sandboxRunning: true,
          tunnelUrls: result.tunnelUrls,
        },
      });

      this.rescheduleIdleAlarm();
      console.log(`[SessionAgentDO] Sandbox spawned: ${result.sandboxId} for session ${sessionId}`);
    } catch (err) {
      console.error(`[SessionAgentDO] Failed to spawn sandbox for session ${sessionId}:`, err);
      const errorText = `Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`;
      this.setStateValue('status', 'error');
      if (sessionId) {
        updateSessionStatus(this.env.DB, sessionId, 'error', undefined, errorText).catch((e) =>
          console.error('[SessionAgentDO] Failed to sync error status to D1:', e),
        );
      }
      // Persist error as a system message so it's visible on reconnect
      const errId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
        errId, 'system', `Error: ${errorText}`
      );
      this.broadcastToClients({
        type: 'status',
        data: { status: 'error' },
      });
      this.broadcastToClients({
        type: 'error',
        messageId: errId,
        error: errorText,
      });

      // Publish session.errored to EventBus
      this.notifyEventBus({
        type: 'session.errored',
        sessionId: sessionId || undefined,
        userId: this.getStateValue('userId') || undefined,
        data: { error: err instanceof Error ? err.message : String(err) },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleStop(): Promise<Response> {
    const sandboxId = this.getStateValue('sandboxId');
    const sessionId = this.getStateValue('sessionId');
    const terminateUrl = this.getStateValue('terminateUrl');
    const currentStatus = this.getStateValue('status');

    // Flush active time and metrics to D1 before termination
    if (currentStatus === 'running') {
      await this.flushActiveSeconds();
      this.clearRunningStarted();
    }
    await this.flushMetrics();

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

    // Cascade: terminate all active child sessions (best-effort)
    if (sessionId) {
      try {
        const children = await getChildSessions(this.env.DB, sessionId);
        const activeChildren = children.filter(
          (c) => c.status !== 'terminated',
        );
        await Promise.allSettled(
          activeChildren.map(async (child) => {
            try {
              const childDoId = this.env.SESSIONS.idFromName(child.id);
              const childDO = this.env.SESSIONS.get(childDoId);
              await childDO.fetch(new Request('http://do/stop', { method: 'POST' }));
              console.log(`[SessionAgentDO] Cascade-terminated child ${child.id}`);
            } catch (err) {
              console.error(`[SessionAgentDO] Failed to cascade-terminate child ${child.id}:`, err);
            }
          }),
        );
      } catch (err) {
        console.error('[SessionAgentDO] Failed to fetch child sessions for cascade:', err);
      }
    }

    // Only terminate sandbox if it's actually running (not hibernated/hibernating)
    if (currentStatus !== 'hibernated' && currentStatus !== 'hibernating') {
      if (sandboxId && terminateUrl) {
        try {
          await fetch(terminateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sandboxId }),
          });
        } catch (err) {
          console.error('Failed to terminate sandbox:', err);
        }
      }
    }

    // Clear idle alarm
    this.ctx.storage.deleteAlarm();

    // Update state
    this.setStateValue('status', 'terminated');
    this.setStateValue('sandboxId', '');
    this.setStateValue('tunnelUrls', '');
    this.setStateValue('snapshotImageId', '');
    this.setStateValue('runnerBusy', 'false');

    // Sync status to D1
    if (sessionId) {
      updateSessionStatus(this.env.DB, sessionId, 'terminated').catch((e) =>
        console.error('[SessionAgentDO] Failed to sync terminated status to D1:', e),
      );
    }

    // Notify clients
    this.broadcastToClients({
      type: 'status',
      data: { status: 'terminated', sandboxRunning: false },
    });

    this.appendAuditLog('session.terminated', 'Session terminated');

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
    const runningStartedAt = this.getStateValue('runningStartedAt');

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
      runningStartedAt: runningStartedAt ? parseInt(runningStartedAt) : null,
    });
  }

  /**
   * HTTP endpoint: returns messages from this DO's local SQLite.
   * Used by other DOs for cross-session message reads.
   * Query params: limit (default 20), after (ISO timestamp cursor)
   */
  private handleMessagesEndpoint(url: URL): Response {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const after = url.searchParams.get('after');

    let query: string;
    const params: (string | number)[] = [];

    if (after) {
      // Pagination: get messages after a cursor, oldest-first
      query = 'SELECT id, role, content, parts, created_at FROM messages WHERE created_at > ? ORDER BY created_at ASC LIMIT ?';
      params.push(after, limit);
    } else {
      // Default: get the MOST RECENT messages, returned in chronological order.
      // Subquery selects newest N rows (DESC), outer query re-sorts ASC.
      query = 'SELECT * FROM (SELECT id, role, content, parts, created_at FROM messages ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC';
      params.push(limit);
    }

    const rows = this.ctx.storage.sql
      .exec(query, ...params)
      .toArray();

    const messages = rows.map((r) => ({
      id: r.id as string,
      role: r.role as string,
      content: r.content as string,
      parts: r.parts ? JSON.parse(r.parts as string) : undefined,
      createdAt: r.created_at as string,
    }));

    return Response.json({ messages });
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

  private async handleFlushMetrics(): Promise<Response> {
    await this.flushMetrics();
    return Response.json({ success: true });
  }

  private async handleGarbageCollect(): Promise<Response> {
    try {
      await this.flushMetrics();
    } catch (err) {
      console.error('[SessionAgentDO] Failed to flush metrics during GC:', err);
    }
    await this.ctx.storage.deleteAll();
    return Response.json({ success: true });
  }

  private async handleProxy(request: Request, url: URL): Promise<Response> {
    const tunnelUrlsRaw = this.getStateValue('tunnelUrls');
    if (!tunnelUrlsRaw) {
      return Response.json({ error: 'Sandbox not running' }, { status: 503 });
    }

    const tunnelUrls = JSON.parse(tunnelUrlsRaw);
    // Route through gateway's /opencode proxy to avoid Modal encrypted tunnel issues
    // on the direct OpenCode port. Fall back to direct opencode URL if gateway not available.
    const gatewayUrl = tunnelUrls.gateway;
    const opencodeUrl = tunnelUrls.opencode;
    const baseUrl = gatewayUrl ? `${gatewayUrl}/opencode` : opencodeUrl;
    if (!baseUrl) {
      return Response.json({ error: 'OpenCode URL not available' }, { status: 503 });
    }

    // Strip /proxy prefix
    const proxyPath = url.pathname.replace(/^\/proxy/, '') + url.search;
    const proxyUrl = baseUrl + proxyPath;

    try {
      const resp = await fetch(proxyUrl, {
        method: request.method,
        body: request.body,
      });
      return resp;
    } catch (error) {
      console.error('[SessionAgentDO] Proxy error:', proxyUrl, error);
      return Response.json({ error: 'Failed to reach sandbox' }, { status: 502 });
    }
  }

  // ─── Webhook Update Handler ────────────────────────────────────────────

  private async handleWebhookUpdate(request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        type: string;
        prState?: string;
        prTitle?: string;
        prMergedAt?: string | null;
        commitCount?: number;
        branch?: string;
      };

      // Broadcast git-state update to all connected clients
      this.broadcastToClients({
        type: 'git-state',
        data: {
          ...(body.prState !== undefined && { prState: body.prState }),
          ...(body.prTitle !== undefined && { prTitle: body.prTitle }),
          ...(body.prMergedAt !== undefined && { prMergedAt: body.prMergedAt }),
          ...(body.commitCount !== undefined && { commitCount: body.commitCount }),
          ...(body.branch !== undefined && { branch: body.branch }),
        },
      });

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
    }
  }

  // ─── GitHub API Helpers ──────────────────────────────────────────────

  /**
   * Get a decrypted GitHub access token for the session.
   * Fallback chain:
   *   1. Active prompt author's GitHub token (if they have one connected)
   *   2. Session creator's GitHub token
   *   3. null (no token available)
   */
  private async getGitHubToken(): Promise<string | null> {
    // Try the current prompt author first (for multiplayer attribution)
    const promptAuthorId = this.getStateValue('currentPromptAuthorId');
    if (promptAuthorId) {
      const authorToken = await getOAuthToken(this.env.DB, promptAuthorId, 'github');
      if (authorToken) {
        return decryptString(authorToken.encryptedAccessToken, this.env.ENCRYPTION_KEY);
      }
    }

    // Fall back to session creator
    const userId = this.getStateValue('userId');
    if (!userId) return null;

    const oauthToken = await getOAuthToken(this.env.DB, userId, 'github');
    if (!oauthToken) return null;

    return decryptString(oauthToken.encryptedAccessToken, this.env.ENCRYPTION_KEY);
  }

  /**
   * Extract owner/repo from a GitHub URL (https or git@ format).
   * Returns null if not a GitHub URL.
   */
  private extractOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  private async resolveOwnerRepo(owner?: string, repo?: string): Promise<{ owner: string; repo: string }> {
    if (owner && repo) {
      return { owner, repo };
    }

    const sessionId = this.getStateValue('sessionId');
    const gitState = sessionId ? await getSessionGitState(this.env.DB, sessionId) : null;
    const repoUrl = gitState?.sourceRepoUrl;
    if (!repoUrl) {
      throw new Error('No repository URL found for this session');
    }

    const ownerRepo = this.extractOwnerRepo(repoUrl);
    if (!ownerRepo) {
      throw new Error(`Cannot extract owner/repo from URL: ${repoUrl}`);
    }

    return ownerRepo;
  }

  // ─── PR Creation ──────────────────────────────────────────────────────

  private async handleCreatePR(msg: { requestId?: string; branch: string; title: string; body?: string; base?: string }) {
    const sessionId = this.getStateValue('sessionId');
    const requestId = msg.requestId;

    // Notify clients that PR creation is in progress
    this.broadcastToClients({
      type: 'status',
      data: { prCreating: true, branch: msg.branch },
    });

    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token found — user must connect GitHub in settings');
      }

      // Get repo URL from git state
      const gitState = sessionId ? await getSessionGitState(this.env.DB, sessionId) : null;
      const repoUrl = gitState?.sourceRepoUrl;
      if (!repoUrl) {
        throw new Error('No repository URL found for this session');
      }

      const ownerRepo = this.extractOwnerRepo(repoUrl);
      if (!ownerRepo) {
        throw new Error(`Cannot extract owner/repo from URL: ${repoUrl}`);
      }

      // Determine base branch
      let baseBranch = msg.base;
      if (!baseBranch) {
        // Fetch default branch from GitHub API
        const repoResp = await fetch(`https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}`, {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'agent-ops',
          },
        });
        if (repoResp.ok) {
          const repoData = await repoResp.json() as { default_branch: string };
          baseBranch = repoData.default_branch;
        } else {
          baseBranch = 'main'; // fallback
        }
      }

      // Create PR via GitHub API
      const createResp = await fetch(`https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'agent-ops',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: msg.title,
          body: msg.body || '',
          head: msg.branch,
          base: baseBranch,
        }),
      });

      if (!createResp.ok) {
        const errBody = await createResp.text();
        throw new Error(`GitHub API returned ${createResp.status}: ${errBody}`);
      }

      const prData = await createResp.json() as { number: number; html_url: string; title: string; state: string };

      // Update D1 git state with PR info
      if (sessionId) {
        updateSessionGitState(this.env.DB, sessionId, {
          branch: msg.branch,
          baseBranch,
          prNumber: prData.number,
          prTitle: prData.title,
          prUrl: prData.html_url,
          prState: prData.state as any,
          prCreatedAt: new Date().toISOString(),
        }).catch((err) =>
          console.error('[SessionAgentDO] Failed to update git state after PR creation:', err),
        );
      }

      // Broadcast PR created to clients
      this.broadcastToClients({
        type: 'pr-created',
        data: {
          number: prData.number,
          title: prData.title,
          url: prData.html_url,
          state: prData.state,
        },
      } as any);

      // Send result back to runner
      if (requestId) {
        this.sendToRunner({
          type: 'create-pr-result',
          requestId,
          number: prData.number,
          url: prData.html_url,
          title: prData.title,
          state: prData.state,
        });
      }

      console.log(`[SessionAgentDO] PR #${prData.number} created: ${prData.html_url}`);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      console.error('[SessionAgentDO] Failed to create PR:', errorText);

      // Send error result back to runner
      if (requestId) {
        this.sendToRunner({
          type: 'create-pr-result',
          requestId,
          error: errorText,
        });
      }

      // Broadcast failure to clients
      this.broadcastToClients({
        type: 'status',
        data: { prCreating: false, prError: errorText },
      });
    }
  }

  // ─── PR Update ────────────────────────────────────────────────────────

  private async handleUpdatePR(msg: { requestId?: string; prNumber: number; title?: string; body?: string; state?: string; labels?: string[] }) {
    const sessionId = this.getStateValue('sessionId');
    const requestId = msg.requestId;

    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token found — user must connect GitHub in settings');
      }

      // Get repo URL from git state
      const gitState = sessionId ? await getSessionGitState(this.env.DB, sessionId) : null;
      const repoUrl = gitState?.sourceRepoUrl;
      if (!repoUrl) {
        throw new Error('No repository URL found for this session');
      }

      const ownerRepo = this.extractOwnerRepo(repoUrl);
      if (!ownerRepo) {
        throw new Error(`Cannot extract owner/repo from URL: ${repoUrl}`);
      }

      // Update PR via GitHub API
      const updateBody: Record<string, unknown> = {};
      if (msg.title !== undefined) updateBody.title = msg.title;
      if (msg.body !== undefined) updateBody.body = msg.body;
      if (msg.state !== undefined) updateBody.state = msg.state;

      const patchResp = await fetch(`https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${msg.prNumber}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'agent-ops',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateBody),
      });

      if (!patchResp.ok) {
        const errBody = await patchResp.text();
        throw new Error(`GitHub API returned ${patchResp.status}: ${errBody}`);
      }

      const prData = await patchResp.json() as { number: number; html_url: string; title: string; state: string };

      // If labels were provided, set them via issues API
      if (msg.labels && msg.labels.length > 0) {
        await fetch(`https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/issues/${msg.prNumber}/labels`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'agent-ops',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ labels: msg.labels }),
        }).catch((err) =>
          console.error('[SessionAgentDO] Failed to set labels:', err),
        );
      }

      // Update D1 git state
      if (sessionId) {
        const gitUpdates: Record<string, unknown> = {
          prTitle: prData.title,
          prState: prData.state,
        };
        updateSessionGitState(this.env.DB, sessionId, gitUpdates as any).catch((err) =>
          console.error('[SessionAgentDO] Failed to update git state after PR update:', err),
        );
      }

      // Broadcast update to clients
      this.broadcastToClients({
        type: 'pr-created',
        data: {
          number: prData.number,
          title: prData.title,
          url: prData.html_url,
          state: prData.state,
        },
      } as any);

      // Send result back to runner
      if (requestId) {
        this.sendToRunner({
          type: 'update-pr-result',
          requestId,
          number: prData.number,
          url: prData.html_url,
          title: prData.title,
          state: prData.state,
        });
      }

      console.log(`[SessionAgentDO] PR #${prData.number} updated: ${prData.html_url}`);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      console.error('[SessionAgentDO] Failed to update PR:', errorText);

      if (requestId) {
        this.sendToRunner({
          type: 'update-pr-result',
          requestId,
          error: errorText,
        });
      }
    }
  }

  // ─── Hibernate / Wake ──────────────────────────────────────────────────

  private async handleHibernate(): Promise<Response> {
    const status = this.getStateValue('status');

    if (status === 'hibernated' || status === 'hibernating') {
      return Response.json({ status, message: 'Already hibernated or hibernating' });
    }

    if (status !== 'running') {
      return Response.json({ status, message: 'Can only hibernate a running session' });
    }

    this.ctx.waitUntil(this.performHibernate());
    return Response.json({ status: 'hibernating', message: 'Hibernate initiated' });
  }

  private async handleWake(): Promise<Response> {
    const status = this.getStateValue('status');

    if (status === 'running' || status === 'restoring') {
      return Response.json({ status, message: 'Already running or restoring' });
    }

    if (status === 'hibernated') {
      this.ctx.waitUntil(this.performWake());
      return Response.json({ status: 'restoring', message: 'Restore initiated' });
    }

    return Response.json({ status, message: 'Cannot wake from current status' });
  }

  private async performHibernate(): Promise<void> {
    const sessionId = this.getStateValue('sessionId');
    const sandboxId = this.getStateValue('sandboxId');
    const hibernateUrl = this.getStateValue('hibernateUrl');

    if (!sandboxId || !hibernateUrl) {
      console.error('[SessionAgentDO] Cannot hibernate: missing sandboxId or hibernateUrl');
      return;
    }

    try {
      // Flush active time and metrics to D1 before hibernate
      await this.flushActiveSeconds();
      this.clearRunningStarted();
      await this.flushMetrics();

      // Set status to hibernating
      this.setStateValue('status', 'hibernating');
      this.broadcastToClients({
        type: 'status',
        data: { status: 'hibernating' },
      });
      if (sessionId) {
        updateSessionStatus(this.env.DB, sessionId, 'hibernating').catch((e) =>
          console.error('[SessionAgentDO] Failed to sync hibernating status to D1:', e),
        );
      }

      // Call Modal backend to snapshot filesystem FIRST (while sandbox is still alive),
      // then terminate. We must NOT stop the runner before snapshotting — stopping the
      // runner causes the sandbox process to exit, making snapshot_filesystem fail with
      // "Sandbox has already finished".
      const response = await fetch(hibernateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId }),
      });

      if (response.status === 409) {
        // Sandbox already exited (idle timeout) — can't snapshot, treat as stopped
        console.log(`[SessionAgentDO] Session ${sessionId} sandbox already finished, marking as terminated`);
        this.sendToRunner({ type: 'stop' });
        const runnerSockets409 = this.ctx.getWebSockets('runner');
        for (const ws of runnerSockets409) {
          try { ws.close(1000, 'Sandbox already exited'); } catch { /* ignore */ }
        }
        this.setStateValue('sandboxId', '');
        this.setStateValue('tunnelUrls', '');
        this.setStateValue('runnerBusy', 'false');
        this.setStateValue('status', 'terminated');
        this.broadcastToClients({
          type: 'status',
          data: { status: 'terminated', sandboxRunning: false },
        });
        if (sessionId) {
          updateSessionStatus(this.env.DB, sessionId, 'terminated').catch((e) =>
            console.error('[SessionAgentDO] Failed to sync terminated status to D1:', e),
          );
        }
        return;
      }

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Backend returned ${response.status}: ${err}`);
      }

      const result = await response.json() as { snapshotImageId: string };

      // Now that snapshot is taken and sandbox terminated, stop runner and close connections
      this.sendToRunner({ type: 'stop' });
      const runnerSockets = this.ctx.getWebSockets('runner');
      for (const ws of runnerSockets) {
        try { ws.close(1000, 'Session hibernating'); } catch { /* ignore */ }
      }

      // Store snapshot info and clear sandbox info
      this.setStateValue('snapshotImageId', result.snapshotImageId);
      this.setStateValue('sandboxId', '');
      this.setStateValue('tunnelUrls', '');
      this.setStateValue('runnerBusy', 'false');
      this.setStateValue('status', 'hibernated');

      this.broadcastToClients({
        type: 'status',
        data: { status: 'hibernated', sandboxRunning: false },
      });

      if (sessionId) {
        updateSessionStatus(this.env.DB, sessionId, 'hibernated').catch((e) =>
          console.error('[SessionAgentDO] Failed to sync hibernated status to D1:', e),
        );
      }

      this.appendAuditLog('session.hibernated', 'Session hibernated');
      console.log(`[SessionAgentDO] Session ${sessionId} hibernated, snapshot: ${result.snapshotImageId}`);
    } catch (err) {
      console.error(`[SessionAgentDO] Failed to hibernate session ${sessionId}:`, err);
      const errorText = `Failed to hibernate: ${err instanceof Error ? err.message : String(err)}`;
      this.setStateValue('status', 'error');
      if (sessionId) {
        updateSessionStatus(this.env.DB, sessionId, 'error', undefined, errorText).catch((e) =>
          console.error('[SessionAgentDO] Failed to sync error status to D1:', e),
        );
      }
      // Persist error as a system message
      const errId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
        errId, 'system', `Error: ${errorText}`
      );
      this.broadcastToClients({
        type: 'status',
        data: { status: 'error' },
      });
      this.broadcastToClients({
        type: 'error',
        messageId: errId,
        error: errorText,
      });
    }
  }

  private async performWake(): Promise<void> {
    const sessionId = this.getStateValue('sessionId');
    const snapshotImageId = this.getStateValue('snapshotImageId');
    const restoreUrl = this.getStateValue('restoreUrl');
    const spawnRequestStr = this.getStateValue('spawnRequest');

    if (!snapshotImageId || !restoreUrl || !spawnRequestStr) {
      console.error('[SessionAgentDO] Cannot wake: missing snapshotImageId, restoreUrl, or spawnRequest');
      return;
    }

    try {
      this.setStateValue('status', 'restoring');
      this.broadcastToClients({
        type: 'status',
        data: { status: 'restoring' },
      });
      if (sessionId) {
        updateSessionStatus(this.env.DB, sessionId, 'restoring').catch((e) =>
          console.error('[SessionAgentDO] Failed to sync restoring status to D1:', e),
        );
      }

      const spawnRequest = JSON.parse(spawnRequestStr);

      const response = await fetch(restoreUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...spawnRequest,
          snapshotImageId,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Backend returned ${response.status}: ${err}`);
      }

      const result = await response.json() as {
        sandboxId: string;
        tunnelUrls: Record<string, string>;
      };

      // Update state with new sandbox info
      this.setStateValue('sandboxId', result.sandboxId);
      this.setStateValue('tunnelUrls', JSON.stringify(result.tunnelUrls));
      this.setStateValue('snapshotImageId', '');
      this.setStateValue('status', 'running');
      this.markRunningStarted();
      this.setStateValue('lastUserActivityAt', String(Date.now()));

      this.rescheduleIdleAlarm();

      if (sessionId) {
        updateSessionStatus(this.env.DB, sessionId, 'running', result.sandboxId).catch((e) =>
          console.error('[SessionAgentDO] Failed to sync running status to D1:', e),
        );
      }

      this.broadcastToClients({
        type: 'status',
        data: {
          status: 'running',
          sandboxRunning: true,
          tunnelUrls: result.tunnelUrls,
        },
      });

      this.appendAuditLog('session.restored', 'Session restored from hibernation');
      console.log(`[SessionAgentDO] Session ${sessionId} restored, new sandbox: ${result.sandboxId}`);
    } catch (err) {
      console.error(`[SessionAgentDO] Failed to restore session ${sessionId}:`, err);
      const errorText = `Failed to restore session: ${err instanceof Error ? err.message : String(err)}`;
      this.setStateValue('status', 'error');
      if (sessionId) {
        updateSessionStatus(this.env.DB, sessionId, 'error', undefined, errorText).catch((e) =>
          console.error('[SessionAgentDO] Failed to sync error status to D1:', e),
        );
      }
      // Persist error as a system message
      const errId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        'INSERT INTO messages (id, role, content) VALUES (?, ?, ?)',
        errId, 'system', `Error: ${errorText}`
      );
      this.broadcastToClients({
        type: 'status',
        data: { status: 'error' },
      });
      this.broadcastToClients({
        type: 'error',
        messageId: errId,
        error: errorText,
      });
    }
  }

  /**
   * Schedule the idle alarm based on the configured idle timeout.
   * Called after any user activity and after sandbox transitions to running.
   */
  private rescheduleIdleAlarm(): void {
    const idleTimeoutMsStr = this.getStateValue('idleTimeoutMs');
    if (!idleTimeoutMsStr) return;

    const idleTimeoutMs = parseInt(idleTimeoutMsStr);
    if (isNaN(idleTimeoutMs) || idleTimeoutMs <= 0) return;

    // Schedule alarm for now + idle timeout
    // Note: this overwrites any existing alarm — we'll re-check question expiry in alarm() too
    const alarmTime = Date.now() + idleTimeoutMs;

    // But also consider pending question expiry — use the earliest time
    const nextExpiry = this.ctx.storage.sql
      .exec(
        "SELECT MIN(expires_at) as next FROM questions WHERE status = 'pending' AND expires_at IS NOT NULL"
      )
      .toArray();

    let earliestAlarm = alarmTime;
    if (nextExpiry.length > 0 && nextExpiry[0].next) {
      const questionExpiryMs = (nextExpiry[0].next as number) * 1000;
      if (questionExpiryMs < earliestAlarm) {
        earliestAlarm = questionExpiryMs;
      }
    }

    this.ctx.storage.setAlarm(earliestAlarm);
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

  private async getConnectedUsersWithDetails(): Promise<Array<{ id: string; name?: string; email?: string; avatarUrl?: string }>> {
    const userIds = this.getConnectedUserIds();

    // Backfill cache for any users missing after hibernation
    const uncachedIds = userIds.filter((id) => !this.userDetailsCache.has(id));
    if (uncachedIds.length > 0) {
      try {
        const placeholders = uncachedIds.map(() => '?').join(',');
        const rows = await this.env.DB.prepare(
          `SELECT id, email, name, avatar_url, git_name, git_email, model_preferences FROM users WHERE id IN (${placeholders})`
        ).bind(...uncachedIds).all<{ id: string; email: string; name: string | null; avatar_url: string | null; git_name: string | null; git_email: string | null; model_preferences: string | null }>();
        for (const row of rows.results) {
          this.userDetailsCache.set(row.id, {
            id: row.id,
            email: row.email,
            name: row.name || undefined,
            avatarUrl: row.avatar_url || undefined,
            gitName: row.git_name || undefined,
            gitEmail: row.git_email || undefined,
            modelPreferences: row.model_preferences ? JSON.parse(row.model_preferences) : undefined,
          });
        }
      } catch (err) {
        console.error('Failed to backfill user details cache:', err);
      }
    }

    return userIds.map((id) => {
      const details = this.userDetailsCache.get(id);
      return {
        id,
        name: details?.name,
        email: details?.email,
        avatarUrl: details?.avatarUrl,
      };
    });
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

  /**
   * Record that the sandbox just entered the 'running' state.
   * Stores a timestamp so we can later compute elapsed active seconds.
   */
  private markRunningStarted(): void {
    this.setStateValue('runningStartedAt', String(Date.now()));
  }

  /**
   * Flush accumulated active seconds to D1.
   * Called when leaving the 'running' state (hibernate, terminate, error).
   * Also called periodically from flushMetrics to avoid losing time if the DO restarts.
   */
  private async flushActiveSeconds(): Promise<void> {
    const sessionId = this.getStateValue('sessionId');
    const startStr = this.getStateValue('runningStartedAt');
    if (!sessionId || !startStr) return;

    const startMs = parseInt(startStr);
    if (isNaN(startMs)) return;

    const elapsedSeconds = Math.floor((Date.now() - startMs) / 1000);
    if (elapsedSeconds > 0) {
      try {
        await addActiveSeconds(this.env.DB, sessionId, elapsedSeconds);
      } catch (err) {
        console.error('[SessionAgentDO] Failed to flush active seconds:', err);
      }
    }
    // Reset the start marker to now so we don't double-count on next flush
    this.setStateValue('runningStartedAt', String(Date.now()));
  }

  /**
   * Clear the running start marker (when leaving running state permanently).
   */
  private clearRunningStarted(): void {
    this.setStateValue('runningStartedAt', '');
  }

  /**
   * Flush message/tool-call counts from local SQLite to D1.
   * Called at lifecycle boundaries (stop, hibernate, alarm) and after each agent turn.
   */
  private async flushMetrics(): Promise<void> {
    const sessionId = this.getStateValue('sessionId');
    if (!sessionId) return;

    try {
      const msgRow = this.ctx.storage.sql
        .exec('SELECT COUNT(*) as count FROM messages')
        .toArray()[0];
      const toolRow = this.ctx.storage.sql
        .exec("SELECT COUNT(*) as count FROM messages WHERE role = 'tool'")
        .toArray()[0];

      const messageCount = (msgRow?.count as number) ?? 0;
      const toolCallCount = (toolRow?.count as number) ?? 0;

      await updateSessionMetrics(this.env.DB, sessionId, { messageCount, toolCallCount });

      // Also flush active seconds if currently running
      const status = this.getStateValue('status');
      if (status === 'running') {
        await this.flushActiveSeconds();
      }

      // Flush unflushed audit log entries to D1
      const unflushed = this.ctx.storage.sql
        .exec('SELECT id, event_type, summary, actor_id, metadata, created_at FROM audit_log WHERE flushed = 0 ORDER BY id ASC LIMIT 50')
        .toArray();

      if (unflushed.length > 0) {
        const stmts = unflushed.map((row) =>
          this.env.DB.prepare(
            'INSERT INTO session_audit_log (id, session_id, event_type, summary, actor_id, metadata, created_at, flushed_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
          ).bind(
            `${sessionId}:${row.id}`,
            sessionId,
            row.event_type as string,
            row.summary as string,
            (row.actor_id as string) || null,
            (row.metadata as string) || null,
            row.created_at as string,
          )
        );
        try {
          await this.env.DB.batch(stmts);
          // Mark as flushed
          const flushedIds = unflushed.map((r) => r.id as number);
          const placeholders = flushedIds.map(() => '?').join(',');
          this.ctx.storage.sql.exec(
            `UPDATE audit_log SET flushed = 1 WHERE id IN (${placeholders})`,
            ...flushedIds,
          );
        } catch (flushErr) {
          console.error('[SessionAgentDO] Failed to flush audit log to D1:', flushErr);
        }
      }
    } catch (err) {
      console.error('[SessionAgentDO] Failed to flush metrics:', err);
    }
  }

  private appendAuditLog(
    eventType: string,
    summary: string,
    actorId?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    this.ctx.storage.sql.exec(
      'INSERT INTO audit_log (event_type, summary, actor_id, metadata) VALUES (?, ?, ?, ?)',
      eventType, summary, actorId || null, metadataJson,
    );
    // Broadcast to connected clients in real-time
    this.broadcastToClients({
      type: 'audit_log',
      entry: {
        eventType,
        summary,
        actorId: actorId || undefined,
        metadata: metadata || undefined,
        createdAt: new Date().toISOString(),
      },
    });
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
