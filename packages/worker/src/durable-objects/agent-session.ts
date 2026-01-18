import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from '../env.js';
import type { Message, SessionStatus } from '@agent-ops/shared';

interface SessionState {
  id: string;
  userId: string;
  workspace: string;
  status: SessionStatus;
  containerId?: string;
  openCodeBaseUrl?: string;
  messages: Message[];
  createdAt: string;
  lastActiveAt: string;
}

/**
 * Durable Object for managing agent sessions.
 *
 * Handles:
 * - WebSocket connections for real-time communication
 * - Message history (in-memory, backed by D1)
 * - Container lifecycle coordination
 * - Proxying requests to OpenCode server in container
 */
export class AgentSessionDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<WebSocket, { userId: string }> = new Map();
  private sessionState: SessionState | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Restore state on wake
    this.state.blockConcurrencyWhile(async () => {
      this.sessionState = await this.state.storage.get<SessionState>('session') ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // WebSocket upgrade
      if (request.headers.get('Upgrade') === 'websocket') {
        return this.handleWebSocket(request);
      }

      switch (path) {
        case '/init':
          return this.handleInit(request);
        case '/message':
          return this.handleMessage(request);
        case '/status':
          return this.handleStatus();
        case '/terminate':
          return this.handleTerminate();
        case '/proxy':
          return this.handleProxy(request);
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('AgentSessionDO error:', error);
      return Response.json({ error: 'Internal error' }, { status: 500 });
    }
  }

  /**
   * Initialize a new session
   */
  private async handleInit(request: Request): Promise<Response> {
    const body = await request.json<{
      id: string;
      userId: string;
      workspace: string;
      containerId?: string;
      openCodeBaseUrl?: string;
    }>();

    this.sessionState = {
      id: body.id,
      userId: body.userId,
      workspace: body.workspace,
      status: 'initializing',
      containerId: body.containerId,
      openCodeBaseUrl: body.openCodeBaseUrl,
      messages: [],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    await this.state.storage.put('session', this.sessionState);

    return Response.json({ success: true, session: this.sessionState });
  }

  /**
   * Handle incoming message from user
   */
  private async handleMessage(request: Request): Promise<Response> {
    if (!this.sessionState) {
      return Response.json({ error: 'Session not initialized' }, { status: 400 });
    }

    const body = await request.json<{
      content: string;
      attachments?: Array<{ type: string; name: string; data: string }>;
    }>();

    // Create user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      sessionId: this.sessionState.id,
      role: 'user',
      content: body.content,
      createdAt: new Date(),
    };

    this.sessionState.messages.push(userMessage);
    this.sessionState.status = 'running';
    this.sessionState.lastActiveAt = new Date().toISOString();

    // Broadcast to connected clients
    this.broadcast({ type: 'message', message: userMessage });
    this.broadcast({ type: 'status', status: 'running' });

    // If we have an OpenCode container, forward the message
    if (this.sessionState.openCodeBaseUrl) {
      try {
        const response = await this.forwardToOpenCode(body.content);
        return response;
      } catch (error) {
        console.error('OpenCode forward error:', error);
        this.sessionState.status = 'error';
        this.broadcast({ type: 'status', status: 'error' });
        await this.state.storage.put('session', this.sessionState);
        return Response.json({ error: 'Failed to communicate with agent' }, { status: 502 });
      }
    }

    await this.state.storage.put('session', this.sessionState);

    return Response.json({ success: true, messageId: userMessage.id });
  }

  /**
   * Forward message to OpenCode server and stream response
   */
  private async forwardToOpenCode(content: string): Promise<Response> {
    if (!this.sessionState?.openCodeBaseUrl) {
      throw new Error('No OpenCode server configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add basic auth if configured
    if (this.env.OPENCODE_SERVER_PASSWORD) {
      const auth = btoa(`opencode:${this.env.OPENCODE_SERVER_PASSWORD}`);
      headers['Authorization'] = `Basic ${auth}`;
    }

    // First, ensure we have a session in OpenCode
    let openCodeSessionId = await this.state.storage.get<string>('openCodeSessionId');

    if (!openCodeSessionId) {
      // Create session in OpenCode
      const createRes = await fetch(`${this.sessionState.openCodeBaseUrl}/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: `/workspace/${this.sessionState.workspace}` }),
      });

      if (!createRes.ok) {
        throw new Error(`Failed to create OpenCode session: ${createRes.status}`);
      }

      const session = await createRes.json<{ id: string }>();
      openCodeSessionId = session.id;
      await this.state.storage.put('openCodeSessionId', openCodeSessionId);
    }

    // Send the prompt and get streaming response
    const promptRes = await fetch(
      `${this.sessionState.openCodeBaseUrl}/session/${openCodeSessionId}/prompt`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      }
    );

    if (!promptRes.ok) {
      throw new Error(`Failed to send prompt: ${promptRes.status}`);
    }

    // Stream the response back
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Process the streaming response
    (async () => {
      try {
        const reader = promptRes.body?.getReader();
        if (!reader) return;

        let assistantContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Forward chunk to client
          await writer.write(value);

          // Accumulate for message history
          const text = new TextDecoder().decode(value);
          assistantContent += text;

          // Broadcast chunk to WebSocket clients
          this.broadcast({ type: 'chunk', content: text });
        }

        // Save assistant message to history
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          sessionId: this.sessionState!.id,
          role: 'assistant',
          content: assistantContent,
          createdAt: new Date(),
        };
        this.sessionState!.messages.push(assistantMessage);
        this.sessionState!.status = 'idle';
        this.sessionState!.lastActiveAt = new Date().toISOString();

        await this.state.storage.put('session', this.sessionState);

        this.broadcast({ type: 'message', message: assistantMessage });
        this.broadcast({ type: 'status', status: 'idle' });
      } catch (error) {
        console.error('Stream processing error:', error);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  /**
   * Get current session status
   */
  private async handleStatus(): Promise<Response> {
    if (!this.sessionState) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json({
      id: this.sessionState.id,
      status: this.sessionState.status,
      workspace: this.sessionState.workspace,
      messageCount: this.sessionState.messages.length,
      createdAt: this.sessionState.createdAt,
      lastActiveAt: this.sessionState.lastActiveAt,
    });
  }

  /**
   * Terminate the session
   */
  private async handleTerminate(): Promise<Response> {
    if (!this.sessionState) {
      return Response.json({ success: true });
    }

    this.sessionState.status = 'terminated';
    await this.state.storage.put('session', this.sessionState);

    // Notify connected clients
    this.broadcast({ type: 'status', status: 'terminated' });

    // Close all WebSocket connections
    for (const ws of this.sessions.keys()) {
      ws.close(1000, 'Session terminated');
    }
    this.sessions.clear();

    return Response.json({ success: true });
  }

  /**
   * Proxy arbitrary requests to OpenCode server
   */
  private async handleProxy(request: Request): Promise<Response> {
    if (!this.sessionState?.openCodeBaseUrl) {
      return Response.json({ error: 'No OpenCode server configured' }, { status: 400 });
    }

    const url = new URL(request.url);
    const targetPath = url.searchParams.get('path') || '/';
    const targetUrl = `${this.sessionState.openCodeBaseUrl}${targetPath}`;

    const headers = new Headers(request.headers);

    // Add auth if configured
    if (this.env.OPENCODE_SERVER_PASSWORD) {
      const auth = btoa(`opencode:${this.env.OPENCODE_SERVER_PASSWORD}`);
      headers.set('Authorization', `Basic ${auth}`);
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.body,
    });

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocket(request: Request): Response {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return Response.json({ error: 'userId required' }, { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { userId });

    // Send current state
    if (this.sessionState) {
      server.send(
        JSON.stringify({
          type: 'init',
          session: {
            id: this.sessionState.id,
            status: this.sessionState.status,
            workspace: this.sessionState.workspace,
            messages: this.sessionState.messages,
          },
        })
      );
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'message':
          // Handle message through the main handler
          const response = await this.handleMessage(
            new Request('http://internal/message', {
              method: 'POST',
              body: JSON.stringify({ content: data.content }),
            })
          );
          break;

        default:
          console.log('Unknown WebSocket message type:', data.type);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.sessions.delete(ws);
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  private broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(data);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }
}
