import type { D1Database, R2Bucket, DurableObjectNamespace } from '@cloudflare/workers-types';

export interface Env {
  // Durable Objects
  SESSIONS: DurableObjectNamespace;
  EVENT_BUS: DurableObjectNamespace;
  WORKFLOW_EXECUTOR: DurableObjectNamespace;

  // Storage
  DB: D1Database;
  STORAGE: R2Bucket;

  // Secrets (set via wrangler secret put)
  ENCRYPTION_KEY: string;

  // LLM Provider API Keys (optional fallback; prefer org-level keys in DB)
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  PARALLEL_API_KEY?: string;

  // GitHub OAuth
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_WEBHOOK_SECRET?: string;

  // Google OAuth (Gmail, Calendar, Drive)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // Modal Python backend URL
  MODAL_BACKEND_URL: string;

  // Frontend URL (for OAuth redirects)
  FRONTEND_URL: string;

  // Optional public API origin for runner/DO websocket URLs.
  // Example: https://api.example.com
  API_PUBLIC_URL?: string;

  // Optional Worker name fallback (used when FRONTEND_URL is a Pages domain).
  WORKER_NAME?: string;

  // Slack integration (Phase D prep)
  SLACK_SIGNING_SECRET?: string;
  SLACK_BOT_TOKEN?: string;

  // Email allowlist (comma-separated). If unset, all emails are allowed.
  ALLOWED_EMAILS?: string;
}

// Type for Hono context variables
export interface Variables {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'member';
  };
  requestId: string;
}
