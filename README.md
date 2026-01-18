# Agent Ops

An agent platform built on TypeScript and Cloudflare infrastructure, integrating with OpenCode for AI agent orchestration. The system enables multi-tenant AI agents with access to various third-party integrations, persistent storage, and real-time communication.

## Architecture

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        React["React Application"]
    end

    subgraph Edge["Edge Layer (Cloudflare Worker)"]
        Router["Hono Router"]
        
        subgraph Routes["API Routes"]
            Sessions["/api/sessions"]
            Integrations["/api/integrations"]
            Files["/api/files"]
            Agent["/agent/*"]
        end
        
        subgraph DOs["Durable Objects"]
            APIKeys["API Keys DO"]
            AgentSessions["Agent Sessions DO"]
        end
        
        subgraph Storage["Storage"]
            D1["D1 (SQLite)"]
            R2["R2 (Files)"]
        end
    end

    subgraph Container["OpenCode Container"]
        OpenCode["AI Agent Runtime"]
    end

    React --> Router
    Router --> Routes
    Sessions --> DOs
    Agent --> AgentSessions
    AgentSessions --> OpenCode
    Routes --> Storage
    DOs --> Storage
```

## Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant Worker as Cloudflare Worker
    participant Auth as Auth Middleware
    participant DO as Agent Session DO
    participant OpenCode as OpenCode Container

    Client->>Worker: POST /agent/sessions/:id/messages
    Worker->>Auth: Validate Bearer Token
    Auth-->>Worker: User Context
    Worker->>DO: Forward to Durable Object
    DO->>OpenCode: Send Prompt (Streaming)
    
    loop Streaming Response
        OpenCode-->>DO: Message Chunks
        DO-->>Worker: Stream Chunks
        Worker-->>Client: SSE Events
    end
    
    DO->>DO: Store Message History
```

## OAuth Integration Flow

```mermaid
sequenceDiagram
    participant User
    participant Client as React App
    participant Worker as Cloudflare Worker
    participant Provider as OAuth Provider<br/>(GitHub/Google)
    participant DB as D1 Database

    User->>Client: Click "Connect Integration"
    Client->>Worker: GET /api/integrations/:service/auth
    Worker-->>Client: Redirect URL
    Client->>Provider: OAuth Authorization
    User->>Provider: Grant Access
    Provider-->>Client: Callback with Code
    Client->>Worker: POST /api/integrations/callback
    Worker->>Provider: Exchange Code for Token
    Provider-->>Worker: Access Token
    Worker->>DB: Store Encrypted Credentials
    Worker-->>Client: Integration Connected
```

## Data Model

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : owns
    USERS ||--o{ INTEGRATIONS : configures
    USERS ||--o{ API_TOKENS : has
    SESSIONS ||--o{ MESSAGES : contains
    INTEGRATIONS ||--o{ SYNC_LOGS : generates

    USERS {
        string id PK
        string email UK
        string name
        string avatar_url
        datetime created_at
    }

    SESSIONS {
        string id PK
        string user_id FK
        string status
        string workspace
        json metadata
        datetime created_at
        datetime last_active_at
    }

    MESSAGES {
        string id PK
        string session_id FK
        string role
        text content
        json tool_calls
        datetime created_at
    }

    INTEGRATIONS {
        string id PK
        string user_id FK
        string service
        json config
        string sync_status
        datetime last_synced_at
    }

    SYNC_LOGS {
        string id PK
        string integration_id FK
        string status
        int records_synced
        text error_message
        datetime started_at
        datetime completed_at
    }

    API_TOKENS {
        string id PK
        string user_id FK
        string token_hash
        string name
        datetime expires_at
    }
```

## Integration Sync Architecture

```mermaid
flowchart LR
    subgraph Triggers
        Webhook["Webhooks"]
        Cron["Cron (Hourly)"]
        Manual["Manual Sync"]
    end

    subgraph Worker["Cloudflare Worker"]
        Scheduler["Sync Scheduler"]
        
        subgraph Integrations
            GitHub["GitHub"]
            Gmail["Gmail"]
            Calendar["Google Calendar"]
        end
    end

    subgraph Storage
        D1["D1 Database"]
        R2["R2 Bucket"]
    end

    Webhook --> Scheduler
    Cron --> Scheduler
    Manual --> Scheduler
    
    Scheduler --> GitHub
    Scheduler --> Gmail
    Scheduler --> Calendar
    
    GitHub --> D1
    Gmail --> D1
    Calendar --> D1
    
    GitHub --> R2
    Gmail --> R2
    Calendar --> R2
```

## Packages

| Package | Description |
|---------|-------------|
| `@agent-ops/client` | React frontend with TanStack Router/Query, Radix UI, Tailwind CSS |
| `@agent-ops/worker` | Cloudflare Worker with Hono API, Durable Objects, D1/R2 storage |
| `@agent-ops/shared` | Shared types, errors, and utilities |

## Prerequisites

- Node.js 18+
- pnpm
- Docker (for OpenCode container)
- Wrangler CLI (`npm install -g wrangler`)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit with your values
# - OPENCODE_SERVER_PASSWORD: Password for OpenCode server auth
# - ANTHROPIC_API_KEY: (or other LLM provider keys)
```

### 3. Initialize Local Database

```bash
cd packages/worker
pnpm run db:migrate
```

### 4. Seed Test Data (Optional)

```bash
pnpm run db:seed
```

This creates a test user with API token `test-api-token-12345`.

### 5. Start OpenCode Container

```bash
# From project root
docker-compose up -d
```

Verify it's running:
```bash
curl http://localhost:4096/doc
```

### 6. Start Worker

```bash
cd packages/worker
pnpm run dev
```

Worker runs at `http://localhost:8787`.

### 7. Start Frontend

```bash
cd packages/client
pnpm run dev
```

Frontend runs at `http://localhost:5173`.

## API Endpoints

### Public

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |

### Protected (require `Authorization: Bearer <token>`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List user sessions |
| `/api/sessions` | POST | Create new session |
| `/api/sessions/:id` | GET | Get session details |
| `/api/sessions/:id` | DELETE | Terminate session |
| `/api/integrations/available` | GET | List available integrations |
| `/api/integrations` | GET | List configured integrations |
| `/api/integrations/:service/configure` | POST | Configure integration |
| `/api/integrations/:id/sync` | POST | Trigger sync |
| `/api/files` | GET | List files |
| `/api/files` | POST | Upload file |
| `/api/files/:id` | GET | Download file |

### Agent Proxy

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/sessions/:id/messages` | POST | Send message to agent |
| `/agent/sessions/:id/messages` | GET | Get message history |
| `/agent/sessions/:id/ws` | WebSocket | Real-time agent communication |

## Testing

### Health Check

```bash
curl http://localhost:8787/health
```

### With Authentication

```bash
# Using test token (after running db:seed)
curl -H "Authorization: Bearer test-api-token-12345" \
  http://localhost:8787/api/integrations/available
```

### Create a Session

```bash
curl -X POST \
  -H "Authorization: Bearer test-api-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"workspace": "/workspace/my-project"}' \
  http://localhost:8787/api/sessions
```

## Development

### Project Structure

```
agent-ops/
├── Dockerfile              # OpenCode server container
├── docker-compose.yml      # Local dev stack
├── .env.example            # Environment template
├── packages/
│   ├── client/             # React frontend
│   │   ├── src/
│   │   │   ├── api/              # API client and hooks
│   │   │   ├── components/       # React components
│   │   │   ├── hooks/            # Custom hooks
│   │   │   ├── routes/           # TanStack Router pages
│   │   │   ├── stores/           # Zustand state stores
│   │   │   └── styles/           # Global CSS
│   │   ├── index.html
│   │   └── vite.config.ts
│   ├── shared/             # Shared types and utilities
│   │   └── src/
│   │       ├── types.ts
│   │       └── errors.ts
│   └── worker/             # Cloudflare Worker
│       ├── src/
│       │   ├── index.ts           # Entry point
│       │   ├── env.ts             # Environment types
│       │   ├── routes/            # API routes
│       │   ├── durable-objects/   # DOs for state
│       │   ├── integrations/      # Third-party integrations
│       │   ├── middleware/        # Auth, error handling
│       │   └── lib/               # OpenCode client, DB helpers
│       ├── migrations/            # D1 SQL migrations
│       ├── scripts/               # Utility scripts
│       ├── .dev.vars              # Local secrets
│       └── wrangler.toml          # Worker config
└── workspaces/             # Docker volume mount
```

### Commands

```bash
# Client commands (from packages/client)
pnpm run dev              # Start Vite dev server
pnpm run build            # Production build
pnpm run preview          # Preview production build
pnpm run typecheck        # Type check

# Worker commands (from packages/worker)
pnpm run dev              # Start local dev server
pnpm run build            # Dry-run deploy
pnpm run deploy           # Deploy to Cloudflare
pnpm run typecheck        # Type check
pnpm run db:migrate       # Run D1 migrations (local)
pnpm run db:migrate:prod  # Run D1 migrations (production)
pnpm run db:seed          # Seed test data

# Docker commands (from project root)
docker-compose up -d      # Start OpenCode container
docker-compose down       # Stop containers
docker-compose logs -f    # View logs

# Run from project root with filters
pnpm --filter @agent-ops/client dev       # Start frontend
pnpm --filter @agent-ops/worker dev       # Start worker
pnpm --filter @agent-ops/client typecheck # Type check client
pnpm --filter @agent-ops/worker typecheck # Type check worker
```

### Adding Integrations

Integrations are located in `packages/worker/src/integrations/`. Each integration implements:

1. OAuth flow (if applicable)
2. Data sync logic
3. Entity mapping to unified schema

Current integrations:
- GitHub (repos, issues, PRs)
- Gmail (emails, threads)
- Google Calendar (events)

## Environment Variables

### Worker (`.dev.vars`)

| Variable | Required | Description |
|----------|----------|-------------|
| `ENCRYPTION_KEY` | Yes | 32-byte key for credential encryption |
| `ENVIRONMENT` | No | `development` or `production` |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth app secret |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `OPENCODE_SERVER_PASSWORD` | Yes | Password for OpenCode server auth |

### OpenCode Container (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCODE_SERVER_PASSWORD` | Yes | Must match worker config |
| `ANTHROPIC_API_KEY` | No* | Anthropic API key |
| `OPENAI_API_KEY` | No* | OpenAI API key |
| `GOOGLE_API_KEY` | No* | Google AI API key |

*At least one LLM provider key is required.

## Deployment

### Cloudflare Worker

1. Create D1 database:
   ```bash
   wrangler d1 create agent-ops-db
   ```

2. Update `wrangler.toml` with database ID

3. Create R2 bucket:
   ```bash
   wrangler r2 bucket create agent-ops-storage
   ```

4. Set secrets:
   ```bash
   wrangler secret put ENCRYPTION_KEY
   wrangler secret put OPENCODE_SERVER_PASSWORD
   ```

5. Deploy:
   ```bash
   pnpm run deploy
   ```

### OpenCode Container

Deploy to your container platform of choice (Fly.io, Railway, etc.) using the provided Dockerfile.

## License

MIT
