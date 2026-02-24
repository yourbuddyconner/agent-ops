import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, ValidationError, IntegrationError, ErrorCodes } from '@agent-ops/shared';
import type { IntegrationService } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';
import * as integrationService from '../services/integrations.js';
import { integrationRegistry } from '../integrations/base.js';
import '../integrations/github.js'; // Register GitHub integration
import '../integrations/gmail.js'; // Register Gmail integration
import '../integrations/google-calendar.js'; // Register Google Calendar integration

export const integrationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const configureIntegrationSchema = z.object({
  service: z.enum(['github', 'gmail', 'google_calendar', 'google_drive', 'notion', 'hubspot', 'ashby', 'discord', 'xero']),
  credentials: z.record(z.string()),
  config: z.object({
    syncFrequency: z.enum(['realtime', 'hourly', 'daily', 'manual']).default('hourly'),
    entities: z.array(z.string()).default([]),
    filters: z.record(z.unknown()).optional(),
  }),
});

const triggerSyncSchema = z.object({
  entities: z.array(z.string()).optional(),
  fullSync: z.boolean().optional(),
});

/**
 * GET /api/integrations
 * List user's integrations + org-scope integrations
 */
integrationsRouter.get('/', async (c) => {
  const user = c.get('user');

  // Get user's own integrations
  const userIntegrations = await db.getUserIntegrations(c.env.DB, user.id);

  // Get org-scope integrations (visible to all members)
  const orgIntegrations = await db.getOrgIntegrations(c.env.DB, user.id);

  // Don't expose sensitive data
  const sanitized = [
    ...userIntegrations.map((i) => ({
      id: i.id,
      service: i.service,
      status: i.status,
      scope: i.scope,
      config: {
        syncFrequency: i.config.syncFrequency,
        entities: i.config.entities,
      },
      lastSyncedAt: i.lastSyncedAt,
      createdAt: i.createdAt,
    })),
    ...orgIntegrations.map((i) => ({
      id: i.id,
      service: i.service,
      status: i.status,
      scope: i.scope,
      config: {
        syncFrequency: (i.config as any).syncFrequency,
        entities: (i.config as any).entities,
      },
      lastSyncedAt: i.lastSyncedAt,
      createdAt: i.createdAt,
    })),
  ];

  return c.json({ integrations: sanitized });
});

/**
 * GET /api/integrations/available
 * List available integration services
 */
integrationsRouter.get('/available', async (c) => {
  const services = integrationRegistry.list();

  const available = services.map((service) => {
    const integration = integrationRegistry.get(service);
    return {
      service,
      supportedEntities: integration?.supportedEntities || [],
    };
  });

  return c.json({ services: available });
});

/**
 * POST /api/integrations
 * Configure a new integration
 */
integrationsRouter.post('/', zValidator('json', configureIntegrationSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const result = await integrationService.configureIntegration(c.env, user.id, user.email, body);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ integration: result.integration }, 201);
});

/**
 * GET /api/integrations/:id
 * Get integration details
 */
integrationsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const integration = await db.getIntegration(c.env.DB, id);

  if (!integration) {
    throw new NotFoundError('Integration', id);
  }

  if (integration.userId !== user.id) {
    throw new NotFoundError('Integration', id);
  }

  return c.json({
    integration: {
      id: integration.id,
      service: integration.service,
      status: integration.status,
      config: integration.config,
      lastSyncedAt: integration.lastSyncedAt,
      createdAt: integration.createdAt,
    },
  });
});

/**
 * POST /api/integrations/:id/sync
 * Trigger a sync
 */
integrationsRouter.post('/:id/sync', zValidator('json', triggerSyncSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const body = c.req.valid('json');

  const result = await integrationService.triggerIntegrationSync(
    c.env, user.id, id, body, c.executionCtx,
  );

  return c.json({ syncId: result.syncId, status: 'started' }, 202);
});

/**
 * GET /api/integrations/:id/sync/:syncId
 * Get sync status
 */
integrationsRouter.get('/:id/sync/:syncId', async (c) => {
  const user = c.get('user');
  const { id, syncId } = c.req.param();

  const integration = await db.getIntegration(c.env.DB, id);

  if (!integration) {
    throw new NotFoundError('Integration', id);
  }

  if (integration.userId !== user.id) {
    throw new NotFoundError('Integration', id);
  }

  const syncLog = await db.getSyncLog(c.env.DB, syncId);

  if (!syncLog || syncLog.integrationId !== id) {
    throw new NotFoundError('Sync', syncId);
  }

  return c.json(syncLog);
});

/**
 * GET /api/integrations/:id/entities/:type
 * Get synced entities
 */
integrationsRouter.get('/:id/entities/:type', async (c) => {
  const user = c.get('user');
  const { id, type } = c.req.param();
  const { limit, cursor } = c.req.query();

  const integration = await db.getIntegration(c.env.DB, id);

  if (!integration) {
    throw new NotFoundError('Integration', id);
  }

  if (integration.userId !== user.id) {
    throw new NotFoundError('Integration', id);
  }

  const result = await db.getSyncedEntities(c.env.DB, id, type, {
    limit: limit ? parseInt(limit) : undefined,
    cursor,
  });

  return c.json(result);
});

/**
 * DELETE /api/integrations/:id
 * Remove an integration
 */
integrationsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const integration = await db.getIntegration(c.env.DB, id);

  if (!integration) {
    throw new NotFoundError('Integration', id);
  }

  if (integration.userId !== user.id) {
    throw new NotFoundError('Integration', id);
  }

  // Revoke credentials in Durable Object
  const doId = c.env.API_KEYS.idFromName(user.id);
  const apiKeysDO = c.env.API_KEYS.get(doId);

  await apiKeysDO.fetch(new Request('http://internal/revoke', {
    method: 'POST',
    body: JSON.stringify({ service: integration.service }),
  }));

  // Delete integration record (cascades to sync_logs and synced_entities)
  await db.deleteIntegration(c.env.DB, id);

  return c.json({ success: true });
});

/**
 * GET /api/integrations/:service/oauth
 * Get OAuth URL for a service
 */
integrationsRouter.get('/:service/oauth', async (c) => {
  const { service } = c.req.param();
  const { redirect_uri } = c.req.query();

  if (!redirect_uri) {
    throw new ValidationError('redirect_uri is required');
  }

  const integration = integrationRegistry.get(service as IntegrationService);
  if (!integration || !integration.getOAuthUrl) {
    throw new ValidationError(`OAuth not supported for ${service}`);
  }

  // Set client credentials based on service
  if (service === 'github') {
    integration.setCredentials({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
    });
  } else if (service === 'gmail' || service === 'google_calendar' || service === 'google_drive') {
    integration.setCredentials({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
    });
  }

  const state = crypto.randomUUID();
  const url = integration.getOAuthUrl(redirect_uri, state);

  return c.json({ url, state });
});

/**
 * POST /api/integrations/:service/oauth/callback
 * Handle OAuth callback
 */
integrationsRouter.post('/:service/oauth/callback', async (c) => {
  const user = c.get('user');
  const { service } = c.req.param();
  const { code, redirect_uri } = await c.req.json<{ code: string; redirect_uri: string }>();

  if (!code || !redirect_uri) {
    throw new ValidationError('code and redirect_uri are required');
  }

  const integration = integrationRegistry.get(service as IntegrationService);
  if (!integration || !integration.exchangeOAuthCode) {
    throw new ValidationError(`OAuth not supported for ${service}`);
  }

  // Set client credentials based on service
  if (service === 'github') {
    integration.setCredentials({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
    });
  } else if (service === 'gmail' || service === 'google_calendar' || service === 'google_drive') {
    integration.setCredentials({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
    });
  }

  const credentials = await integration.exchangeOAuthCode(code, redirect_uri);

  return c.json({ credentials });
});
