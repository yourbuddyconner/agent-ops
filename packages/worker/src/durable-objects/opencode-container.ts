import { ModalService } from '../services/modal-service.js';
import type { Env } from '../env.js';

/**
 * Message stored in the ledger.
 */
interface Message {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  processed?: boolean;
}

/**
 * Session state persisted in DO storage.
 */
interface SessionState {
  containerId: string;
  userId: string;
  sandboxName: string | null;
  tunnelUrl: string | null;
  autoSleepMinutes: number;
  callbackToken: string | null;
}

/**
 * OpenCode Container Durable Object
 *
 * This DO acts as a message ledger and coordinator for Modal sandboxes.
 * It uses hibernation - the DO sleeps between messages to save costs.
 *
 * Architecture:
 * - Browser clients connect via WebSocket (hibernation-compatible)
 * - DO stores messages in an ordered ledger
 * - Modal sandbox is started on-demand when user sends a prompt
 * - Bridge component in sandbox sends results back via HTTP callbacks
 * - DO broadcasts results to all connected clients
 *
 * Key hibernation patterns:
 * - Use state.acceptWebSocket() instead of WebSocketPair
 * - Use state.getWebSockets() to retrieve connections after wake
 * - Implement webSocketMessage() handler method
 * - All state must be persisted to storage (nothing survives hibernation)
 */
export class OpenCodeContainerDO {
  private state: DurableObjectState;
  private env: Env;
  private modalService: ModalService;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.modalService = new ModalService();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade (hibernation-compatible)
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // Internal control endpoints (from Worker routes)
    if (url.hostname === 'internal') {
      return this.handleInternal(url.pathname, request);
    }

    // Callback from sandbox bridge (wakes DO)
    if (url.pathname === '/callback') {
      return this.handleBridgeCallback(request);
    }

    // HTTP proxy to sandbox (for OpenCode UI)
    if (url.hostname === 'container') {
      return this.handleProxy(request);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle WebSocket upgrade with hibernation support.
   * Uses state.acceptWebSocket() to survive DO hibernation.
   */
  private async handleWebSocketUpgrade(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Tag websocket for identification after hibernation
    this.state.acceptWebSocket(server, ['client']);

    // Send message history to new client
    const messages = (await this.state.storage.get<Message[]>('messages')) || [];
    for (const msg of messages) {
      server.send(JSON.stringify({ type: 'message', data: msg }));
    }

    // Send current status
    const sessionState = await this.state.storage.get<SessionState>('sessionState');
    if (sessionState) {
      server.send(
        JSON.stringify({
          type: 'status',
          data: {
            sandboxRunning: !!sessionState.tunnelUrl,
            messageCount: messages.length,
          },
        })
      );
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Called when DO wakes and receives WebSocket message.
   * This is a hibernation handler method.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = typeof message === 'string' ? message : new TextDecoder().decode(message);

    try {
      const parsed = JSON.parse(data);

      if (parsed.type === 'prompt') {
        await this.handleUserPrompt(parsed.content);
      } else if (parsed.type === 'ping') {
        // Heartbeat to keep connection alive
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  }

  /**
   * Called when WebSocket closes.
   * This is a hibernation handler method.
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
    ws.close(code, reason);
  }

  /**
   * Called when WebSocket has an error.
   * This is a hibernation handler method.
   */
  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('WebSocket error:', error);
    ws.close(1011, 'Internal error');
  }

  /**
   * Handle user prompt - store in ledger and forward to sandbox.
   */
  private async handleUserPrompt(content: string) {
    // Load state from storage
    const messages = (await this.state.storage.get<Message[]>('messages')) || [];
    const sessionState = await this.state.storage.get<SessionState>('sessionState');

    if (!sessionState) {
      this.broadcast(JSON.stringify({ type: 'error', message: 'Session not initialized' }));
      return;
    }

    // Store in ledger
    const message: Message = {
      id: crypto.randomUUID(),
      type: 'user',
      content,
      timestamp: Date.now(),
    };
    messages.push(message);
    await this.state.storage.put('messages', messages);

    // Broadcast to all connected clients
    this.broadcast(JSON.stringify({ type: 'message', data: message }));

    // Ensure sandbox is running and send prompt
    const tunnelUrl = await this.ensureSandboxRunning(sessionState);
    if (tunnelUrl) {
      await this.sendPromptToSandbox(tunnelUrl, message);
    } else {
      // Failed to start sandbox
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        type: 'system',
        content: 'Failed to start sandbox. Please try again.',
        timestamp: Date.now(),
      };
      messages.push(errorMessage);
      await this.state.storage.put('messages', messages);
      this.broadcast(JSON.stringify({ type: 'message', data: errorMessage }));
    }
  }

  /**
   * Generate a secure random token for callback authentication.
   */
  private generateCallbackToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Ensure sandbox is running, starting it if necessary.
   */
  private async ensureSandboxRunning(sessionState: SessionState): Promise<string | null> {
    // Check if sandbox exists and is healthy
    if (sessionState.tunnelUrl) {
      const isHealthy = await this.modalService.isSandboxHealthy(sessionState.tunnelUrl);
      if (isHealthy) {
        return sessionState.tunnelUrl;
      }
      // Sandbox may have terminated, clear the URL and token
      sessionState.tunnelUrl = null;
      sessionState.callbackToken = null;
    }

    // Generate new callback token for this sandbox
    const callbackToken = this.generateCallbackToken();

    // Start new sandbox
    const sandboxName = `container-${sessionState.containerId}`;
    const callbackUrl = `${this.env.WORKER_URL}/api/containers/${sessionState.containerId}/callback`;

    try {
      const result = await this.modalService.getOrCreateSandbox({
        appName: this.env.MODAL_APP_NAME,
        sandboxName,
        image: this.env.OPENCODE_IMAGE,
        command: ['./start.sh', '--callback-url', callbackUrl],
        port: 4096,
        timeoutMs: 24 * 60 * 60 * 1000, // 24 hours max
        idleTimeoutMs: (sessionState.autoSleepMinutes || 15) * 60 * 1000,
        callbackToken,
      });

      // Update state with token
      sessionState.sandboxName = sandboxName;
      sessionState.tunnelUrl = result.tunnelUrl;
      sessionState.callbackToken = callbackToken;
      await this.state.storage.put('sessionState', sessionState);

      // Notify clients sandbox is running
      this.broadcast(
        JSON.stringify({
          type: 'status',
          data: { sandboxRunning: true, tunnelUrl: result.tunnelUrl },
        })
      );

      return result.tunnelUrl;
    } catch (error) {
      console.error('Failed to start sandbox:', error);
      return null;
    }
  }

  /**
   * Send prompt to sandbox bridge via HTTP.
   */
  private async sendPromptToSandbox(tunnelUrl: string, message: Message) {
    try {
      await fetch(`${tunnelUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.id,
          content: message.content,
        }),
      });
    } catch (error) {
      console.error('Failed to send prompt to sandbox:', error);
      // The bridge will handle retries or errors
    }
  }

  /**
   * Handle callback from sandbox bridge (streaming results).
   * Each callback wakes the DO briefly.
   * Validates callback token for authentication.
   */
  private async handleBridgeCallback(request: Request): Promise<Response> {
    // Validate callback token
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const sessionState = await this.state.storage.get<SessionState>('sessionState');
    if (!sessionState?.callbackToken || token !== sessionState.callbackToken) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = (await request.json()) as {
      type: 'stream' | 'result' | 'error' | 'tool';
      messageId: string;
      content: string;
      toolName?: string;
      toolArgs?: Record<string, unknown>;
    };

    if (body.type === 'stream') {
      // Stream chunk - broadcast without storing
      this.broadcast(
        JSON.stringify({
          type: 'stream',
          messageId: body.messageId,
          content: body.content,
        })
      );
    } else if (body.type === 'result') {
      // Final result - store and broadcast
      const messages = (await this.state.storage.get<Message[]>('messages')) || [];
      const message: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: body.content,
        timestamp: Date.now(),
      };
      messages.push(message);
      await this.state.storage.put('messages', messages);

      this.broadcast(JSON.stringify({ type: 'message', data: message }));
    } else if (body.type === 'tool') {
      // Tool call - store and broadcast
      const messages = (await this.state.storage.get<Message[]>('messages')) || [];
      const message: Message = {
        id: crypto.randomUUID(),
        type: 'tool',
        content: JSON.stringify({
          name: body.toolName,
          args: body.toolArgs,
          result: body.content,
        }),
        timestamp: Date.now(),
      };
      messages.push(message);
      await this.state.storage.put('messages', messages);

      this.broadcast(JSON.stringify({ type: 'message', data: message }));
    } else if (body.type === 'error') {
      // Error from sandbox
      const messages = (await this.state.storage.get<Message[]>('messages')) || [];
      const message: Message = {
        id: crypto.randomUUID(),
        type: 'system',
        content: `Error: ${body.content}`,
        timestamp: Date.now(),
      };
      messages.push(message);
      await this.state.storage.put('messages', messages);

      this.broadcast(JSON.stringify({ type: 'message', data: message }));
    }

    return new Response('OK');
  }

  /**
   * Broadcast message to all connected WebSocket clients.
   * Uses state.getWebSockets() which works with hibernation.
   */
  private broadcast(message: string) {
    const sockets = this.state.getWebSockets('client');
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        // Socket may be closed, ignore
      }
    }
  }

  /**
   * Handle internal control requests from Worker routes.
   */
  private async handleInternal(path: string, request: Request): Promise<Response> {
    switch (path) {
      case '/start':
        return this.handleStart(request);
      case '/stop':
        return this.handleStop();
      case '/status':
        return this.handleStatus();
      case '/callback':
        return this.handleBridgeCallback(request);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Initialize session and optionally start sandbox.
   */
  private async handleStart(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      containerId: string;
      userId: string;
      name: string;
      autoSleepMinutes?: number;
    };

    // Initialize or update session state
    const sessionState: SessionState = {
      containerId: body.containerId,
      userId: body.userId,
      sandboxName: null,
      tunnelUrl: null,
      autoSleepMinutes: body.autoSleepMinutes || 15,
      callbackToken: null,
    };
    await this.state.storage.put('sessionState', sessionState);

    // Start sandbox
    const tunnelUrl = await this.ensureSandboxRunning(sessionState);

    return Response.json({
      success: true,
      tunnelUrl,
      status: tunnelUrl ? 'running' : 'error',
    });
  }

  /**
   * Stop the sandbox.
   */
  private async handleStop(): Promise<Response> {
    const sessionState = await this.state.storage.get<SessionState>('sessionState');
    if (sessionState?.sandboxName) {
      await this.modalService.terminateSandbox(this.env.MODAL_APP_NAME, sessionState.sandboxName);
      sessionState.tunnelUrl = null;
      sessionState.sandboxName = null;
      sessionState.callbackToken = null;
      await this.state.storage.put('sessionState', sessionState);

      // Notify clients
      this.broadcast(
        JSON.stringify({
          type: 'status',
          data: { sandboxRunning: false },
        })
      );
    }
    return Response.json({ success: true, status: 'stopped' });
  }

  /**
   * Get current status.
   */
  private async handleStatus(): Promise<Response> {
    const sessionState = await this.state.storage.get<SessionState>('sessionState');
    const messages = (await this.state.storage.get<Message[]>('messages')) || [];
    const clients = this.state.getWebSockets('client').length;

    // Check if sandbox is healthy
    let sandboxRunning = false;
    if (sessionState?.tunnelUrl) {
      sandboxRunning = await this.modalService.isSandboxHealthy(sessionState.tunnelUrl);
    }

    return Response.json({
      containerId: sessionState?.containerId,
      userId: sessionState?.userId,
      sandboxName: sessionState?.sandboxName,
      tunnelUrl: sessionState?.tunnelUrl,
      sandboxRunning,
      messageCount: messages.length,
      connectedClients: clients,
    });
  }

  /**
   * Proxy HTTP requests to the sandbox (for OpenCode UI).
   */
  private async handleProxy(request: Request): Promise<Response> {
    const sessionState = await this.state.storage.get<SessionState>('sessionState');
    if (!sessionState?.tunnelUrl) {
      return Response.json({ error: 'Sandbox not running' }, { status: 503 });
    }

    const url = new URL(request.url);
    const proxyUrl = sessionState.tunnelUrl + url.pathname + url.search;

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
}
