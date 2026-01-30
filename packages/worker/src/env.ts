import type { D1Database, R2Bucket, DurableObjectNamespace } from '@cloudflare/workers-types';

export interface Env {
  // Durable Objects
  API_KEYS: DurableObjectNamespace;
  SESSIONS: DurableObjectNamespace;
  EVENT_BUS: DurableObjectNamespace;

  // Storage
  DB: D1Database;
  STORAGE: R2Bucket;

  // Environment
  ENVIRONMENT: 'development' | 'staging' | 'production';

  // Secrets (set via wrangler secret put)
  ENCRYPTION_KEY: string;

  // LLM Provider API Keys (passed to sandboxes)
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;

  // GitHub OAuth
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;

  // Google OAuth (Gmail, Calendar, Drive)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // OpenCode (for container communication)
  OPENCODE_SERVER_PASSWORD?: string;

  // Modal (for sandbox management)
  MODAL_TOKEN_ID: string;
  MODAL_TOKEN_SECRET: string;
  MODAL_APP_NAME: string;
  OPENCODE_IMAGE: string;
  WORKER_URL: string;

  // Modal Python backend URL
  MODAL_BACKEND_URL: string;

  // Frontend URL (for OAuth redirects)
  FRONTEND_URL: string;

  // JWT secret for sandbox iframe authentication
  SANDBOX_JWT_SECRET: string;
}

// Type for Hono context variables
export interface Variables {
  user: {
    id: string;
    email: string;
  };
  requestId: string;
}
