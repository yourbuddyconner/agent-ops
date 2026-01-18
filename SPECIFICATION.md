# OpenCode Agent Platform Specification

## Overview

This specification describes an agent platform built on TypeScript and Cloudflare infrastructure, integrating with OpenCode for AI agent orchestration. The system enables multi-tenant AI agents with access to various third-party integrations, persistent storage, and real-time communication.

---

## Architecture Components

### 1. Client Layer

#### React Application
- **Purpose**: Web-based interface for interacting with AI agents
- **Features**:
  - Real-time agent session management
  - Multi-workspace support (/.claude, /scripts, /github, /tldraw, /tldraw-internal)
  - Dashboard with metrics and analytics
  - Integration configuration UI

#### Authentication Flow
- OAuth 2.0 / OIDC integration
- Session token management
- Role-based access control (RBAC)
- Support for multiple identity providers

---

### 2. Edge Layer (Cloudflare Workers)

#### Main Worker (`/worker/index.ts`)

```typescript
interface Env {
  // Durable Objects
  API_KEYS: DurableObjectNamespace;
  AGENT_SESSIONS: DurableObjectNamespace;

  // Storage
  DB: D1Database;
  STORAGE: R2Bucket;

  // Secrets
  OPENCODE_API_KEY: string;

  // External service credentials
  GITHUB_TOKEN: string;
  NOTION_TOKEN: string;
  HUBSPOT_TOKEN: string;
  // ... other integration tokens
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Route handling
    if (url.pathname.startsWith('/agent')) {
      return handleAgentRoutes(request, env, ctx);
    }
    if (url.pathname.startsWith('/api')) {
      return handleAPIRoutes(request, env, ctx);
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

#### Route Structure

| Path | Handler | Description |
|------|---------|-------------|
| `/agent/*` | Agent Container | Routes to OpenCode agent container |
| `/api/sessions` | API Routes | Session management |
| `/api/integrations` | API Routes | Third-party sync operations |
| `/api/files` | API Routes | File operations |
| `/api/keys` | Durable Object | API key management |

---

### 3. Agent Container Layer

#### Container Configuration

```typescript
interface AgentContainerConfig {
  // OpenCode server configuration
  opencode: {
    port: number;           // Default: 4096
    hostname: string;       // Default: '127.0.0.1'
    password?: string;      // Optional auth
  };

  // Workspace mounts
  workspaces: {
    name: string;           // e.g., '.claude', 'scripts', 'github'
    path: string;           // Container path
    readonly: boolean;      // Write permissions
  }[];

  // Resource limits
  resources: {
    memory: string;         // e.g., '512Mi'
    cpu: string;            // e.g., '0.5'
    timeout: number;        // Max execution time (ms)
  };
}
```

#### Agent Session Manager

```typescript
interface AgentSession {
  id: string;
  userId: string;
  containerId: string;
  status: 'initializing' | 'running' | 'idle' | 'terminated';
  workspaces: string[];
  createdAt: Date;
  lastActiveAt: Date;
}

class AgentSessionManager {
  // Create new agent session with OpenCode
  async createSession(config: AgentContainerConfig): Promise<AgentSession>;

  // Send message to agent
  async sendMessage(sessionId: string, message: string): Promise<ReadableStream>;

  // Subscribe to agent events (SSE)
  async subscribeToEvents(sessionId: string): Promise<ReadableStream>;

  // Terminate session
  async terminateSession(sessionId: string): Promise<void>;
}
```

#### OpenCode SDK Integration

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk';

class OpenCodeAgentClient {
  private client: ReturnType<typeof createOpencodeClient>;

  constructor(baseUrl: string, auth?: { username: string; password: string }) {
    this.client = createOpencodeClient({ baseUrl });
  }

  // Session operations
  async createSession(projectPath: string): Promise<Session> {
    return this.client.session.create({ path: projectPath });
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<AsyncIterable<Message>> {
    return this.client.session.prompt({ sessionId, prompt });
  }

  // File operations
  async searchFiles(query: string): Promise<FileResult[]> {
    return this.client.file.search({ query });
  }

  async readFile(path: string): Promise<string> {
    return this.client.file.read({ path });
  }

  // Real-time events
  subscribeToEvents(): EventSource {
    return this.client.events.subscribe();
  }
}
```

---

### 4. Durable Objects

#### API Keys Durable Object

```typescript
interface StoredAPIKey {
  id: string;
  userId: string;
  service: IntegrationService;
  encryptedKey: string;
  scopes: string[];
  createdAt: Date;
  expiresAt?: Date;
}

export class APIKeysDurableObject implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/store':
        return this.storeKey(request);
      case '/retrieve':
        return this.retrieveKey(request);
      case '/rotate':
        return this.rotateKey(request);
      case '/revoke':
        return this.revokeKey(request);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private async storeKey(request: Request): Promise<Response>;
  private async retrieveKey(request: Request): Promise<Response>;
  private async rotateKey(request: Request): Promise<Response>;
  private async revokeKey(request: Request): Promise<Response>;
}
```

#### Agent Session Durable Object

```typescript
export class AgentSessionDurableObject implements DurableObject {
  private state: DurableObjectState;
  private openCodeClient: OpenCodeAgentClient;
  private websockets: Set<WebSocket>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.websockets = new Set();
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade for real-time communication
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // Handle HTTP requests
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/message':
        return this.handleMessage(request);
      case '/status':
        return this.getStatus();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private async handleWebSocket(request: Request): Promise<Response>;
  private async handleMessage(request: Request): Promise<Response>;
  private async getStatus(): Promise<Response>;
  private broadcast(message: object): void;
}
```

---

### 5. Storage Layer

#### D1 Database Schema

```sql
-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent sessions table (cache)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  workspace TEXT NOT NULL,
  metadata JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Integration configs
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  service TEXT NOT NULL,
  config JSON,
  sync_status TEXT DEFAULT 'pending',
  last_synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, service)
);

-- Sync logs
CREATE TABLE sync_logs (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id),
  status TEXT NOT NULL,
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at DATETIME NOT NULL,
  completed_at DATETIME
);

-- Message history (cache)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_integrations_user ON integrations(user_id);
CREATE INDEX idx_messages_session ON messages(session_id);
```

#### R2 Backup Structure

```
/backups/
  /{user_id}/
    /sessions/
      /{session_id}/
        /messages.jsonl        # Full message history
        /artifacts/            # Generated files
          /{timestamp}_{filename}
    /integrations/
      /{service}/
        /{sync_id}.json        # Sync snapshots
```

---

### 6. Third-Party Integrations

#### Integration Service Interface

```typescript
type IntegrationService =
  | 'ashby'
  | 'hubspot'
  | 'github'
  | 'google_drive'
  | 'notion'
  | 'discord'
  | 'xero';

interface IntegrationConfig {
  service: IntegrationService;
  credentials: Record<string, string>;
  syncOptions: {
    frequency: 'realtime' | 'hourly' | 'daily';
    entities: string[];
    filters?: Record<string, unknown>;
  };
}

interface SyncResult {
  success: boolean;
  recordsSynced: number;
  errors: SyncError[];
  nextCursor?: string;
}

abstract class BaseIntegration {
  abstract readonly service: IntegrationService;

  abstract authenticate(credentials: Record<string, string>): Promise<boolean>;
  abstract sync(options: SyncOptions): Promise<SyncResult>;
  abstract fetchEntity(entityType: string, id: string): Promise<unknown>;
  abstract pushEntity(entityType: string, data: unknown): Promise<string>;
}
```

#### Integration Implementations

```typescript
// GitHub Integration
class GitHubIntegration extends BaseIntegration {
  readonly service = 'github' as const;

  async sync(options: SyncOptions): Promise<SyncResult> {
    // Sync repos, issues, PRs, etc.
  }

  async fetchEntity(entityType: string, id: string): Promise<unknown> {
    // Fetch specific GitHub entity
  }
}

// Notion Integration
class NotionIntegration extends BaseIntegration {
  readonly service = 'notion' as const;

  async sync(options: SyncOptions): Promise<SyncResult> {
    // Sync databases, pages, etc.
  }
}

// HubSpot Integration
class HubSpotIntegration extends BaseIntegration {
  readonly service = 'hubspot' as const;

  async sync(options: SyncOptions): Promise<SyncResult> {
    // Sync contacts, deals, companies, etc.
  }
}

// Add remaining integrations...
```

#### Sync Scheduler

```typescript
interface SyncJob {
  id: string;
  integrationId: string;
  userId: string;
  service: IntegrationService;
  scheduledAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

class SyncScheduler {
  // Schedule periodic syncs using Cloudflare Cron Triggers
  async scheduleSync(integration: IntegrationConfig): Promise<SyncJob>;

  // Execute sync job
  async executeSync(job: SyncJob): Promise<SyncResult>;

  // Handle webhook triggers for real-time syncs
  async handleWebhook(service: IntegrationService, payload: unknown): Promise<void>;
}
```

---

### 7. API Routes

#### Session Routes

```typescript
// POST /api/sessions - Create new agent session
interface CreateSessionRequest {
  workspace: string;
  config?: Partial<AgentContainerConfig>;
}

interface CreateSessionResponse {
  sessionId: string;
  status: 'initializing';
  websocketUrl: string;
}

// GET /api/sessions - List user sessions
interface ListSessionsResponse {
  sessions: AgentSession[];
  pagination: {
    cursor?: string;
    hasMore: boolean;
  };
}

// POST /api/sessions/:id/messages - Send message to agent
interface SendMessageRequest {
  content: string;
  attachments?: {
    type: 'file' | 'url';
    data: string;
  }[];
}

// GET /api/sessions/:id/events - SSE endpoint for real-time updates
// Returns: Server-Sent Events stream

// DELETE /api/sessions/:id - Terminate session
```

#### Integration Routes

```typescript
// GET /api/integrations - List configured integrations
interface ListIntegrationsResponse {
  integrations: {
    id: string;
    service: IntegrationService;
    status: 'active' | 'error' | 'pending';
    lastSynced?: Date;
  }[];
}

// POST /api/integrations - Configure new integration
interface ConfigureIntegrationRequest {
  service: IntegrationService;
  credentials: Record<string, string>;
  syncOptions: SyncOptions;
}

// POST /api/integrations/:id/sync - Trigger manual sync
interface TriggerSyncResponse {
  syncId: string;
  status: 'started';
}

// GET /api/integrations/:id/sync/:syncId - Get sync status
interface SyncStatusResponse {
  status: 'running' | 'completed' | 'failed';
  progress?: number;
  result?: SyncResult;
}

// DELETE /api/integrations/:id - Remove integration
```

#### File Routes

```typescript
// GET /api/files/search - Search files in workspace
interface SearchFilesRequest {
  query: string;
  workspace?: string;
  fileTypes?: string[];
}

// GET /api/files/:path - Read file contents
interface ReadFileResponse {
  content: string;
  mimeType: string;
  size: number;
  lastModified: Date;
}
```

---

### 8. Security

#### Authentication

```typescript
interface AuthConfig {
  // JWT configuration
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
    expiresIn: string;
  };

  // OAuth providers
  oauth: {
    github?: OAuthConfig;
    google?: OAuthConfig;
  };

  // API key auth for programmatic access
  apiKeys: {
    enabled: boolean;
    rateLimit: number;
  };
}

// Middleware for route protection
async function authMiddleware(request: Request, env: Env): Promise<User | Response> {
  const authHeader = request.headers.get('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    return validateJWT(authHeader.slice(7), env);
  }

  if (authHeader?.startsWith('ApiKey ')) {
    return validateAPIKey(authHeader.slice(7), env);
  }

  return new Response('Unauthorized', { status: 401 });
}
```

#### Encryption

```typescript
// Encrypt sensitive data before storing
async function encryptCredential(data: string, env: Env): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ENCRYPTION_KEY),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(data)
  );

  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
}
```

---

### 9. Deployment Configuration

#### `wrangler.toml`

```toml
name = "agent-ops"
main = "src/worker/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

# Durable Objects
[[durable_objects.bindings]]
name = "API_KEYS"
class_name = "APIKeysDurableObject"

[[durable_objects.bindings]]
name = "AGENT_SESSIONS"
class_name = "AgentSessionDurableObject"

[[migrations]]
tag = "v1"
new_classes = ["APIKeysDurableObject", "AgentSessionDurableObject"]

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "agent-ops-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# R2 Bucket
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "agent-ops-storage"

# Cron Triggers for scheduled syncs
[triggers]
crons = ["0 * * * *"]  # Hourly sync check

# Routes
[[routes]]
pattern = "api.yourdomain.com/*"
zone_name = "yourdomain.com"
```

---

### 10. Project Structure

```
agent-ops/
├── src/
│   ├── worker/
│   │   ├── index.ts              # Main worker entry
│   │   ├── routes/
│   │   │   ├── agent.ts          # Agent container routes
│   │   │   ├── sessions.ts       # Session management
│   │   │   ├── integrations.ts   # Integration endpoints
│   │   │   └── files.ts          # File operations
│   │   └── middleware/
│   │       ├── auth.ts           # Authentication
│   │       ├── cors.ts           # CORS handling
│   │       └── rateLimit.ts      # Rate limiting
│   ├── durable-objects/
│   │   ├── APIKeys.ts            # API key management DO
│   │   └── AgentSession.ts       # Agent session DO
│   ├── integrations/
│   │   ├── base.ts               # Base integration class
│   │   ├── github.ts
│   │   ├── notion.ts
│   │   ├── hubspot.ts
│   │   ├── ashby.ts
│   │   ├── drive.ts
│   │   ├── discord.ts
│   │   └── xero.ts
│   ├── lib/
│   │   ├── opencode.ts           # OpenCode SDK wrapper
│   │   ├── encryption.ts         # Encryption utilities
│   │   └── storage.ts            # D1/R2 helpers
│   └── types/
│       ├── index.ts              # Shared types
│       └── env.d.ts              # Environment types
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   └── services/
│   └── package.json
├── migrations/
│   └── 0001_initial.sql
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

### 11. Error Handling

```typescript
// Custom error types
class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

// Error codes
const ErrorCodes = {
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_TERMINATED: 'SESSION_TERMINATED',
  INTEGRATION_AUTH_FAILED: 'INTEGRATION_AUTH_FAILED',
  SYNC_FAILED: 'SYNC_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  CONTAINER_START_FAILED: 'CONTAINER_START_FAILED',
} as const;

// Global error handler
function handleError(error: unknown): Response {
  if (error instanceof AgentError) {
    return Response.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.statusCode }
    );
  }

  console.error('Unhandled error:', error);
  return Response.json(
    { error: 'Internal server error', code: 'INTERNAL_ERROR' },
    { status: 500 }
  );
}
```

---

### 12. Monitoring & Observability

```typescript
interface MetricsConfig {
  // Cloudflare Analytics Engine
  analytics: {
    enabled: boolean;
    sampleRate: number;
  };

  // Custom metrics
  custom: {
    sessionDuration: boolean;
    messageLatency: boolean;
    syncMetrics: boolean;
    errorRates: boolean;
  };
}

// Track key metrics
class MetricsCollector {
  trackSessionStart(sessionId: string, userId: string): void;
  trackSessionEnd(sessionId: string, duration: number): void;
  trackMessage(sessionId: string, latency: number): void;
  trackSync(service: IntegrationService, result: SyncResult): void;
  trackError(code: string, context: unknown): void;
}
```

---

## Implementation Notes

1. **OpenCode Integration**: Use the `@opencode-ai/sdk` package to communicate with the OpenCode server running in containers. The SDK provides type-safe access to all OpenCode capabilities.

2. **Container Orchestration**: Containers should be managed via Cloudflare's container runtime or external orchestration (Kubernetes). The Worker acts as a proxy and state coordinator.

3. **Real-time Communication**: Use WebSockets through Durable Objects for persistent connections, with SSE fallback for simpler use cases.

4. **Data Persistence**: D1 serves as the primary cache and metadata store, while R2 handles backup and large file storage.

5. **Integration Sync**: Implement webhook handlers where available (GitHub, Notion, etc.) for real-time sync, with polling fallback via Cron Triggers.

6. **Security**: All credentials stored in Durable Objects must be encrypted. Use Cloudflare's KV or Secrets for encryption keys.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01-17 | Initial specification |
