# Environment Variables

## Worker (`packages/worker/.dev.vars`)

| Variable | Required | Description |
|----------|----------|-------------|
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for OAuth token encryption (32+ chars) |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth client secret |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `FRONTEND_URL` | Prod | Frontend URL for OAuth redirects |
| `MODAL_BACKEND_URL` | Yes | URL of the Modal Python backend |
| `ALLOWED_EMAILS` | No | Comma-separated email allowlist. If unset, all emails are allowed |
| `ANTHROPIC_API_KEY` | No | Fallback Anthropic key (prefer org-level keys in the UI) |
| `OPENAI_API_KEY` | No | Fallback OpenAI key (prefer org-level keys in the UI) |
| `GOOGLE_API_KEY` | No | Fallback Google AI key (prefer org-level keys in the UI) |

## Deployment Config (`.env.deploy`)

| Variable | Description |
|----------|-------------|
| `WORKER_PROD_URL` | Your deployed Cloudflare Worker URL |
| `PAGES_PROJECT_NAME` | Cloudflare Pages project name |
| `MODAL_WORKSPACE` | Modal workspace name |
| `D1_DATABASE_ID` | Cloudflare D1 database ID |
| `R2_BUCKET_NAME` | Cloudflare R2 bucket name |

## Local Dev (`.env`)

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | Encryption key for local development |
| `ANTHROPIC_API_KEY` | Anthropic API key (for local OpenCode container) |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `GOOGLE_API_KEY` | Google AI API key (optional) |
| `MODAL_TOKEN_ID` | Modal token ID (for `make deploy-modal`) |
| `MODAL_TOKEN_SECRET` | Modal token secret (for `make deploy-modal`) |
