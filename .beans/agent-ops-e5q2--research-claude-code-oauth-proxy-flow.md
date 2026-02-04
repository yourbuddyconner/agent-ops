---
# agent-ops-e5q2
title: 'Research: Claude Code OAuth proxy flow'
status: todo
type: task
priority: high
tags:
    - worker
    - backend
    - research
created_at: 2026-02-03T23:39:45Z
updated_at: 2026-02-03T23:39:45Z
parent: agent-ops-vn3t
---

Investigate whether we can proxy Claude Code's OAuth flow through the agent-ops web UI, so users click "Connect Claude Max" and complete auth without ever touching tokens or CLI tools.

## What We Know

### Token Format
From keychain inspection, Claude Code uses standard OAuth2 with Anthropic-issued tokens:
- Access token prefix: `sk-ant-oat01-`
- Refresh token prefix: `sk-ant-ort01-`
- Scopes: `user:inference`, `user:mcp_servers`, `user:profile`, `user:sessions:claude_code`
- Short-lived access tokens (~24h), long-lived refresh tokens

### What We Don't Know

1. **OAuth endpoints**: What are the authorize and token URLs Claude Code uses? 
   - Likely `https://claude.ai/oauth/authorize` and `https://claude.ai/oauth/token` or similar
   - Could sniff by running `claude` with network monitoring (mitmproxy, Charles, or `NODE_DEBUG=net`)

2. **Client ID**: What `client_id` does Claude Code register with? Is it hardcoded in the CLI binary/npm package?
   - Check the `@anthropic-ai/claude-code` package source for OAuth config
   - May be in a config file or environment variable

3. **Redirect URI**: What callback URL does Claude Code use during the browser OAuth flow?
   - Likely `http://localhost:<port>/callback` (local server pattern)
   - If so, we could potentially register our own redirect URI or use the same pattern

4. **PKCE**: Does the flow use PKCE (Proof Key for Code Exchange)? Almost certainly yes for a public client.
   - If PKCE, we need to generate our own code_verifier/code_challenge
   - The authorization code is bound to the code_verifier, so we can't reuse Claude Code's

5. **Client registration**: Is Claude Code's OAuth client_id restricted to specific redirect URIs?
   - If locked to localhost, we can't redirect to our worker's callback URL
   - Would need to either: use the same localhost pattern via a local helper, or register our own OAuth app with Anthropic

6. **Token endpoint auth**: Does the token endpoint require a client_secret, or is it a public client (PKCE-only)?
   - If public client, we can use the same client_id from any origin
   - If confidential, the client_secret is likely embedded in the CLI package

7. **Refresh endpoint**: What endpoint do you POST the refresh token to for new access tokens?
   - Standard OAuth2 would be the same token endpoint with `grant_type=refresh_token`
   - Need to confirm the exact URL and required parameters

## Investigation Plan

### Step 1: Network Traffic Analysis
Run Claude Code auth flow with network interception to capture:
- The authorize URL and all query parameters (client_id, redirect_uri, scope, state, code_challenge, code_challenge_method)
- The token exchange request (POST body with authorization code)
- The refresh token request format
- Any additional API calls during auth

Methods:
- `mitmproxy` or `Charles Proxy` with HTTPS interception
- `NODE_DEBUG=net claude` to see raw connections
- Browser DevTools network tab during the OAuth redirect
- `strace`/`dtrace` on the CLI process

### Step 2: Source Code Analysis
Inspect the `@anthropic-ai/claude-code` npm package:
- Look for OAuth configuration (client_id, endpoints, scopes)
- Understand the local callback server implementation
- Check if client_id varies by environment (dev/prod/staging)
- See if there's a device authorization grant (RFC 8628) path — this would be ideal for our use case

### Step 3: Feasibility Assessment

**Best case — Public client, standard OAuth2:**
We use Claude Code's client_id, implement our own authorize redirect with our callback URL, exchange code for tokens, store refresh token. Users click "Connect" in our UI, complete Anthropic login, tokens flow to our server. Clean UX.

**Medium case — Redirect URI locked to localhost:**
We can't redirect to our server directly. Options:
- Ship a tiny local CLI tool that starts a localhost server, initiates the flow, captures the callback, and POSTs tokens to our API (like `gh auth login` does)
- Use the device authorization grant if Anthropic supports it (user visits URL, enters code, we poll for token)
- Embed a hidden iframe/popup that captures the localhost redirect via postMessage (fragile)

**Worst case — Confidential client or non-standard flow:**
We can't reuse Claude Code's OAuth registration. Options:
- Contact Anthropic about registering our own OAuth app / partner integration
- Fall back to the CLI credential extraction approach (user runs a command, pastes token)
- Build a browser extension that intercepts the Claude Code auth flow

### Step 4: Token Refresh Implementation
Once we know the token endpoint, implement server-side refresh:
- Worker cron job or on-demand refresh before sandbox boot
- Store encrypted refresh tokens in D1 (`user_credentials` table)
- Handle refresh token rotation (if Anthropic rotates refresh tokens on use)
- Handle revocation (user disconnects, or Anthropic revokes)

## Desired Outcome

A clear technical design for the "Connect Claude Max" flow, with:
- Exact OAuth endpoints and parameters
- Whether we need a local helper tool or can do it purely in-browser
- Token refresh implementation
- Security model (how tokens are stored, encrypted, scoped)
- Fallback plan if the proxy approach isn't viable

## Acceptance Criteria

- [ ] OAuth endpoints and parameters documented
- [ ] Client ID and redirect URI constraints understood
- [ ] Feasibility verdict: can we proxy the flow, or do we need a local helper?
- [ ] Token refresh flow documented and tested manually (curl)
- [ ] Written design doc or bean update with the chosen approach