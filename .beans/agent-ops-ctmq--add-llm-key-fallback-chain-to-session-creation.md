---
# agent-ops-ctmq
title: Add LLM key fallback chain to session creation
status: todo
type: task
priority: high
tags:
    - worker
created_at: 2026-01-31T07:48:47Z
updated_at: 2026-01-31T07:48:47Z
parent: agent-ops-csfb
---

Modify packages/worker/src/routes/sessions.ts to use org-level LLM API keys with env var fallback.

## Changes to session creation endpoint
When building the environment variables for a new sandbox session:
1. Query org_api_keys for each provider (anthropic, openai, google)
2. If an org key exists → decrypt it using decryptApiKey(encrypted_key, ENCRYPTION_KEY)
3. If no org key → fall back to the existing env var (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)
4. Pass the resolved keys to the sandbox environment

## Provider mapping
- provider 'anthropic' → env var ANTHROPIC_API_KEY
- provider 'openai' → env var OPENAI_API_KEY  
- provider 'google' → env var GOOGLE_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY depending on current usage)

## Acceptance Criteria
- Sessions use org-level keys when set
- Sessions fall back to env vars when org keys not set
- Existing sessions continue to work unchanged
- No plaintext keys leak in logs or responses
- pnpm typecheck passes