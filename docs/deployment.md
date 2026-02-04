# Deployment Guide

## Full Release

```bash
make release
```

This runs all steps in order: install, typecheck, build and push the sandbox image, build the client, deploy the Worker, run migrations, and deploy the client to Cloudflare Pages.

## Individual Deployments

```bash
make deploy-worker        # Cloudflare Worker only
make deploy-modal         # Modal backend only
make deploy-client        # Cloudflare Pages only
make deploy               # All three
```

## Modal Backend

Modal deployment uses `uv` to manage the Python environment and runs from the project root:

```bash
make deploy-modal
# Or directly: uv run --project backend modal deploy backend/app.py
```

### Forcing a Sandbox Image Rebuild

The sandbox image is cached by Modal. To force a rebuild after changing `docker/` or `packages/runner/`:

1. Bump `IMAGE_BUILD_VERSION` in `backend/images/base.py`
2. Redeploy: `make deploy-modal`
3. New sessions will use the updated image (existing sandboxes are not affected)

## Production Secrets

Set these via `wrangler secret put` in `packages/worker/`:

```bash
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put FRONTEND_URL
npx wrangler secret put MODAL_BACKEND_URL
```

Optional:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GOOGLE_API_KEY
```

## Deployment Config

Copy `.env.deploy.example` to `.env.deploy` and fill in your values:

```bash
WORKER_PROD_URL=https://your-worker.your-subdomain.workers.dev
PAGES_PROJECT_NAME=agent-ops-client
MODAL_WORKSPACE=your-modal-workspace
D1_DATABASE_ID=your-d1-database-id
R2_BUCKET_NAME=agent-ops-storage
```

These are used by `make release` and `make deploy-*` to generate the production `wrangler.deploy.toml` and build the client with the correct API URL.
