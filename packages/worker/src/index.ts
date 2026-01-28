import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';

import type { Env, Variables } from './env.js';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';

import { sessionsRouter } from './routes/sessions.js';
import { integrationsRouter } from './routes/integrations.js';
import { filesRouter } from './routes/files.js';
import { webhooksRouter } from './routes/webhooks.js';
import { agentRouter } from './routes/agent.js';
import { authRouter } from './routes/auth.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { workflowsRouter } from './routes/workflows.js';
import { triggersRouter } from './routes/triggers.js';
import { executionsRouter } from './routes/executions.js';
import { containersRouter } from './routes/containers.js';

// Durable Object exports
export { APIKeysDurableObject } from './durable-objects/api-keys.js';
export { AgentSessionDurableObject } from './durable-objects/agent-session.js';
export { OpenCodeContainerDO } from './durable-objects/opencode-container.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use('*', requestId());
app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: (origin) => origin, // Allow all origins in dev, restrict in prod
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'CF-Access-JWT-Assertion'],
    exposeHeaders: ['X-Request-Id'],
    credentials: true,
  })
);

// Error handling
app.onError(errorHandler);

// Health check (no auth required)
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook routes (authenticated via webhook signatures)
app.route('/webhooks', webhooksRouter);

// Protected API routes
app.use('/api/*', authMiddleware);
app.route('/api/auth', authRouter);
app.route('/api/api-keys', apiKeysRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/integrations', integrationsRouter);
app.route('/api/files', filesRouter);
app.route('/api/workflows', workflowsRouter);
app.route('/api/triggers', triggersRouter);
app.route('/api/executions', executionsRouter);
app.route('/api/containers', containersRouter);

// Agent container proxy (protected)
app.use('/agent/*', authMiddleware);
app.route('/agent', agentRouter);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
});

// Scheduled handler for cron triggers
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env, ctx) => {
  console.log('Running scheduled sync check:', event.cron);

  // Query for integrations that need syncing
  const integrations = await env.DB.prepare(`
    SELECT id, user_id, service, config
    FROM integrations
    WHERE status = 'active'
      AND (
        (json_extract(config, '$.syncFrequency') = 'hourly')
        OR (json_extract(config, '$.syncFrequency') = 'daily' AND strftime('%H', 'now') = '00')
      )
      AND (last_synced_at IS NULL OR datetime(last_synced_at, '+1 hour') < datetime('now'))
  `).all();

  console.log(`Found ${integrations.results?.length || 0} integrations to sync`);

  // Trigger syncs (in a real implementation, you'd queue these)
  for (const integration of integrations.results || []) {
    ctx.waitUntil(
      fetch(`https://agent-ops.workers.dev/api/integrations/${integration.id}/sync`, {
        method: 'POST',
        headers: { 'X-Internal-Cron': 'true' },
      }).catch((err) => console.error(`Failed to trigger sync for ${integration.id}:`, err))
    );
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
