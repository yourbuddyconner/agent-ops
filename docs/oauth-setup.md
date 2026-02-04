# OAuth Setup

Authentication uses GitHub OAuth (primary) and optionally Google OAuth.

## GitHub OAuth (Required)

1. Go to [GitHub > Settings > Developer settings > OAuth Apps](https://github.com/settings/developers)
2. Create a new OAuth App:

   | Field | Dev | Production |
   |-------|-----|------------|
   | Homepage URL | `http://localhost:5173` | `https://your-domain.com` |
   | Callback URL | `http://localhost:8787/auth/github/callback` | `https://<your-worker>.workers.dev/auth/github/callback` |

3. Copy the **Client ID** and generate a **Client Secret**

Scopes requested: `repo read:user user:email` (needed for repo cloning and PR creation inside sandboxes).

## Google OAuth (Optional)

1. In [Google Cloud Console](https://console.cloud.google.com/), create OAuth credentials
2. Add scopes: `openid`, `email`, `profile`
3. Add redirect URI: `http://localhost:8787/auth/google/callback` (dev)

## Local Credentials

Create `packages/worker/.dev.vars`:

```
ENCRYPTION_KEY=any-string-at-least-32-characters-long
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GOOGLE_CLIENT_ID=your_google_client_id        # optional
GOOGLE_CLIENT_SECRET=your_google_client_secret  # optional
```

## Production Secrets

```bash
cd packages/worker
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put FRONTEND_URL
```
