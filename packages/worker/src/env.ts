import type { D1Database, R2Bucket, DurableObjectNamespace } from '@cloudflare/workers-types';

export interface Env {
  // Durable Objects
  API_KEYS: DurableObjectNamespace;
  AGENT_SESSIONS: DurableObjectNamespace;
  OPENCODE_CONTAINERS: DurableObjectNamespace;

  // Storage
  DB: D1Database;
  STORAGE: R2Bucket;

  // Environment
  ENVIRONMENT: 'development' | 'staging' | 'production';

  // Secrets (set via wrangler secret put)
  ENCRYPTION_KEY: string;

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
}

// Type for Hono context variables
export interface Variables {
  user: {
    id: string;
    email: string;
  };
  requestId: string;
}
