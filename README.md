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
- [pnpm](https://pnpm.io/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`pnpm add -g wrangler`)
- A GitHub account (for OAuth)
- Optionally: a Google Cloud account (for Google OAuth)

## Quick Start

```bash
pnpm install
make db-migrate
```

Then configure OAuth (see below) and run:

```bash
make dev-all
```

Frontend runs at `http://localhost:5173`, worker at `http://localhost:8787`.

## OAuth Setup

Authentication uses GitHub OAuth (primary) and optionally Google OAuth. You need to create OAuth apps with the provider(s) and configure credentials locally.

### GitHub OAuth App (Required)

GitHub OAuth is the primary login method and also provides repo access for cloning and PR creation.

1. Go to [GitHub > Settings > Developer settings > OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:

   | Field | Dev Value | Production Value |
   |-------|-----------|-----------------|
   | Application name | `Agent Ops (dev)` | `Agent Ops` |
   | Homepage URL | `http://localhost:5173` | `https://your-frontend-domain.com` |
   | Authorization callback URL | `http://localhost:8787/auth/github/callback` | `https://agent-ops.conner-7e8.workers.dev/auth/github/callback` |

4. Click **Register application**
5. Copy the **Client ID**
6. Click **Generate a new client secret** and copy it immediately

> Create **separate OAuth Apps** for dev and production. GitHub only allows one callback URL per app.

The OAuth scopes requested are `repo read:user user:email` — this grants read/write access to repos the user can access, which is needed for cloning and PR creation inside sandboxes.

### Google OAuth (Optional)

Google OAuth provides an alternative sign-in method. It does not grant repo access — users who only sign in with Google won't be able to clone repos or create PRs.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select an existing one
3. Enable the **Google+ API** (or just proceed — the consent screen setup enables what's needed)

**Configure consent screen:**

4. Go to **APIs & Services > OAuth consent screen**
5. Select **External** user type, click **Create**
6. Fill in:
   - **App name**: `Agent Ops`
   - **User support email**: your email
   - **Developer contact email**: your email
7. Click **Save and Continue**
8. On the **Scopes** page, click **Add or Remove Scopes** and add:
   - `openid`
   - `email`
   - `profile`
9. Click **Save and Continue**
10. On the **Test users** page, add your email address (required while app is in "Testing" mode)
11. Click **Save and Continue**, then **Back to Dashboard**

> While the app is in "Testing" publishing status, only test users you explicitly add can sign in. Click **Publish App** on the consent screen page when ready for production.

**Create credentials:**

12. Go to **APIs & Services > Credentials**
13. Click **Create Credentials > OAuth client ID**
14. Select **Web application**
15. Name it `Agent Ops (dev)` or `Agent Ops`
16. Under **Authorized redirect URIs**, add:

   | Environment | Redirect URI |
   |-------------|-------------|
   | Dev | `http://localhost:8787/auth/google/callback` |
   | Production | `https://agent-ops.conner-7e8.workers.dev/auth/google/callback` |

17. Click **Create**
18. Copy the **Client ID** and **Client Secret**

> Like GitHub, use separate credentials for dev and production, or add both redirect URIs to one credential.

### Configure Local Dev Credentials

Edit `packages/worker/.dev.vars`:

```
ENCRYPTION_KEY=any-string-at-least-32-characters-long
ENVIRONMENT=development

# GitHub OAuth (required for login)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

`FRONTEND_URL` is already set to `http://localhost:5173` in `wrangler.toml` for dev.

### Configure Production Credentials

Run from `packages/worker/` (where `wrangler.toml` lives):

```bash
cd packages/worker
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put FRONTEND_URL           # your production frontend URL

# If using Google OAuth:
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### How Auth Works

```
Browser                   Worker (:8787)              GitHub/Google
  |                           |                           |
  |-- click "Sign in" ------>|                           |
  |                          |-- 302 to provider ------->|
  |                          |                           |-- user grants access
  |                          |<-- callback?code=xxx -----|
  |                          |-- exchange code for token  |
  |                          |-- encrypt + store token    |
  |                          |-- create auth_session      |
  |<-- 302 to /auth/callback?token=yyy                   |
  |-- store token in localStorage                        |
  |-- GET /api/auth/me ----->|                           |
  |<-- { user, providers } --|                           |
```

- The worker exchanges the OAuth code server-side (client secret never exposed to browser)
- Session tokens are random 32-byte hex, hashed with SHA-256 before D1 storage, 7-day expiry
- GitHub access tokens are encrypted with AES-256-GCM and stored in `oauth_tokens` for repo operations
- API keys (from Settings page) continue to work as Bearer tokens for programmatic access

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

### Worker (`.dev.vars` for local, `wrangler secret` for production)

| Variable | Required | Description |
|----------|----------|-------------|
| `ENCRYPTION_KEY` | Yes | Key for AES-256-GCM encryption of OAuth tokens (32+ chars) |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (for Google sign-in) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `FRONTEND_URL` | Prod only | Frontend URL for OAuth redirects (defaults to `localhost:5173`) |
| `ENVIRONMENT` | No | `development` or `production` |

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
