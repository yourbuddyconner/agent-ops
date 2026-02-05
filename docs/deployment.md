# Deployment Guide

From zero to deployed in 4 steps. You need accounts on three services, a handful of secrets, and one command.

## Prerequisites

Install these tools locally:

- [Node.js 22+](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [uv](https://docs.astral.sh/uv/) (Python package manager, for Modal backend)
- [Docker](https://www.docker.com/) (for building sandbox images)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)

## Step 1: Create Accounts

You need three accounts:

| Service | What it does | Sign up |
|---------|-------------|---------|
| **Cloudflare** | Hosts the API (Worker), database (D1), storage (R2), and frontend (Pages) | [dash.cloudflare.com](https://dash.cloudflare.com) |
| **Modal** | Runs sandbox containers (the coding environments) | [modal.com](https://modal.com) |
| **GitHub** | OAuth login for users + repo access inside sandboxes | [github.com/settings/developers](https://github.com/settings/developers) |

**Cloudflare** -- Workers paid plan required for Durable Objects.

**Modal** -- Note your **workspace name** from the dashboard (e.g. `yourname`).

**GitHub OAuth App** -- Create one at [Settings > Developer settings > OAuth Apps](https://github.com/settings/developers):

| Field | Value |
|-------|-------|
| Homepage URL | `https://your-domain.com` (or `http://localhost:5173` for dev) |
| Callback URL | `https://<your-worker>.workers.dev/auth/github/callback` |

Save the **Client ID** and **Client Secret**.

Optional: [Google OAuth](oauth-setup.md) for Google sign-in.

## Step 2: Create Cloudflare Resources

Log in to Wrangler and create the database and storage bucket:

```bash
wrangler login

# Create D1 database -- save the ID it prints
wrangler d1 create agent-ops-db

# Create R2 bucket
wrangler r2 bucket create agent-ops-storage
```

## Step 3: Configure

### `.env.deploy`

Copy `.env.deploy.example` to `.env.deploy` and fill in your values:

```bash
WORKER_PROD_URL=https://agent-ops.your-subdomain.workers.dev
PAGES_PROJECT_NAME=agent-ops-client
MODAL_WORKSPACE=your-modal-workspace
MODAL_BACKEND_URL=https://your-modal-workspace--{label}.modal.run
D1_DATABASE_ID=<id-from-step-2>
R2_BUCKET_NAME=agent-ops-storage
ALLOWED_EMAILS=you@example.com
```

`MODAL_BACKEND_URL` uses `{label}` as a placeholder -- the Makefile substitutes endpoint names at deploy time. Use the format `https://<workspace>--{label}.modal.run`.

### Worker Secrets

These are sensitive values stored in Cloudflare, not in your repo:

```bash
cd packages/worker

# Required
npx wrangler secret put ENCRYPTION_KEY        # Any string, 32+ characters
npx wrangler secret put GITHUB_CLIENT_ID      # From your GitHub OAuth app
npx wrangler secret put GITHUB_CLIENT_SECRET   # From your GitHub OAuth app
npx wrangler secret put FRONTEND_URL           # Your Pages URL, e.g. https://agent-ops-client.pages.dev

# Optional
npx wrangler secret put GOOGLE_CLIENT_ID       # Google OAuth
npx wrangler secret put GOOGLE_CLIENT_SECRET   # Google OAuth
npx wrangler secret put ANTHROPIC_API_KEY      # Fallback LLM key (users can also set org keys in the UI)
npx wrangler secret put OPENAI_API_KEY         # Fallback LLM key
npx wrangler secret put GOOGLE_API_KEY         # Fallback LLM key

cd ../..
```

### Modal Auth

```bash
modal token set
# Paste your token ID and secret from modal.com > Settings > API Tokens
```

### Docker Auth (for sandbox image)

The sandbox image is pushed to GitHub Container Registry. Authenticate with a [GitHub PAT](https://github.com/settings/tokens) that has `write:packages` scope:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

## Step 4: Deploy

```bash
make release
```

That's it. This runs all 7 steps in order:

1. `pnpm install` -- install dependencies
2. `pnpm typecheck` -- verify everything compiles
3. `docker build + push` -- build sandbox image, push to GHCR
4. `vite build` -- build the frontend
5. `wrangler deploy` -- deploy the Worker + Durable Objects
6. `wrangler d1 migrations apply` -- run database migrations
7. `wrangler pages deploy` -- deploy the frontend to Cloudflare Pages

After it finishes, it prints the sandbox image tag. Set this as `OPENCODE_IMAGE` in your Cloudflare Worker secrets if you're using custom images:

```bash
cd packages/worker
npx wrangler secret put OPENCODE_IMAGE
# Paste: ghcr.io/your-org/your-repo/opencode:<version>
```

Visit your Pages URL and sign in with GitHub.

## Individual Deployments

For incremental updates, you don't need the full release:

```bash
make deploy-worker        # Cloudflare Worker only
make deploy-modal         # Modal backend only (sandbox orchestration)
make deploy-client        # Frontend only (builds + deploys to Pages)
make deploy               # All three (worker + modal + client)
```

## Forcing a Sandbox Image Rebuild

The sandbox image is cached by Modal. To force a rebuild after changing `docker/` or `packages/runner/`:

1. Bump `IMAGE_BUILD_VERSION` in `backend/images/base.py`
2. Redeploy: `make deploy-modal`
3. New sessions will use the updated image (existing sandboxes are not affected)

## Quick Reference

| What | Where |
|------|-------|
| Worker URL | `https://<name>.<subdomain>.workers.dev` |
| Frontend URL | `https://<pages-project>.pages.dev` |
| Modal dashboard | `https://modal.com/apps/<workspace>/main/deployed/agent-ops-backend` |
| D1 console | Cloudflare dashboard > Workers & Pages > D1 |
| Worker logs | `wrangler tail` (from `packages/worker/`) |
| Worker secrets | `wrangler secret list` (from `packages/worker/`) |
