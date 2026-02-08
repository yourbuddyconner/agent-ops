# API Reference

## Auth

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/github` | GET | Start GitHub OAuth flow |
| `/auth/google` | GET | Start Google OAuth flow |
| `/auth/github/callback` | GET | GitHub OAuth callback |
| `/auth/google/callback` | GET | Google OAuth callback |
| `/api/auth/me` | GET | Current user info |
| `/health` | GET | Health check |

## Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List sessions |
| `/api/sessions` | POST | Create session (spawns sandbox) |
| `/api/sessions/:id` | GET | Session details |
| `/api/sessions/:id` | DELETE | Terminate session |
| `/api/sessions/:id/ws` | WebSocket | Real-time session communication |
| `/api/sessions/:id/events` | GET | SSE event stream |

## Files & Repos

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/files` | GET | List files |
| `/api/files` | POST | Upload file |
| `/api/files/:id` | GET | Download file |
| `/api/repos` | GET | List available repos |

## Integrations & API Keys

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/integrations/available` | GET | Available integrations |
| `/api/integrations` | GET | User integrations |
| `/api/integrations/:service/configure` | POST | Configure integration |
| `/api/api-keys` | GET/POST/DELETE | Manage API keys |

## Workflows & Triggers

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workflows` | GET/POST | List/create workflows |
| `/api/workflows/:id` | GET/PUT/DELETE | Manage workflow |
| `/api/triggers` | GET/POST | List/create triggers |
| `/api/executions` | GET | Execution history |
| `/webhooks/:path` | POST | Webhook trigger endpoint |

Schedule trigger notes:
- `config.target = "workflow"` (default) enqueues a workflow execution on cron tick.
- `config.target = "orchestrator"` requires `config.prompt` and delivers that prompt to the user's orchestrator session.
