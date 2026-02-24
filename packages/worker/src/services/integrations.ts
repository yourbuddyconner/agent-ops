import { IntegrationError, ValidationError, ErrorCodes } from '@agent-ops/shared';
import type { IntegrationService } from '@agent-ops/shared';
import type { Env } from '../env.js';
import * as db from '../lib/db.js';
import { integrationRegistry } from '../integrations/base.js';
import '../integrations/github.js';
import '../integrations/gmail.js';
import '../integrations/google-calendar.js';

// ─── Configure Integration ──────────────────────────────────────────────────

export interface ConfigureIntegrationParams {
  service: string;
  credentials: Record<string, string>;
  config: {
    syncFrequency: string;
    entities: string[];
    filters?: Record<string, unknown>;
  };
}

export type ConfigureIntegrationResult =
  | { ok: true; integration: { id: string; service: string; status: string; config: Record<string, unknown>; createdAt: Date } }
  | { ok: false; error: string; code: string };

export async function configureIntegration(
  env: Env,
  userId: string,
  userEmail: string,
  params: ConfigureIntegrationParams,
): Promise<ConfigureIntegrationResult> {
  // Check if integration already exists
  const existing = await db.getUserIntegrations(env.DB, userId);
  if (existing.some((i) => i.service === params.service)) {
    throw new IntegrationError(
      `Integration for ${params.service} already exists`,
      ErrorCodes.INTEGRATION_ALREADY_EXISTS
    );
  }

  // Get the integration handler
  const integration = integrationRegistry.get(params.service as IntegrationService);
  if (!integration) {
    throw new ValidationError(`Unsupported integration: ${params.service}`);
  }

  // Test credentials
  integration.setCredentials(params.credentials);
  if (!integration.validateCredentials()) {
    throw new IntegrationError('Invalid credentials provided', ErrorCodes.INVALID_CREDENTIALS);
  }

  const connectionValid = await integration.testConnection();
  if (!connectionValid) {
    throw new IntegrationError('Failed to connect to service', ErrorCodes.INTEGRATION_AUTH_FAILED);
  }

  // Ensure user exists
  await db.getOrCreateUser(env.DB, { id: userId, email: userEmail });

  // Store credentials securely in Durable Object
  const doId = env.API_KEYS.idFromName(userId);
  const apiKeysDO = env.API_KEYS.get(doId);

  await apiKeysDO.fetch(new Request('http://internal/store', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      service: params.service,
      credentials: params.credentials,
      scopes: params.config.entities,
    }),
  }));

  // Create integration record (without credentials)
  const integrationId = crypto.randomUUID();
  const created = await db.createIntegration(env.DB, {
    id: integrationId,
    userId,
    service: params.service,
    config: params.config,
  });

  // Update status to active
  await db.updateIntegrationStatus(env.DB, integrationId, 'active');

  return {
    ok: true,
    integration: {
      id: created.id,
      service: created.service,
      status: 'active',
      config: created.config as unknown as Record<string, unknown>,
      createdAt: created.createdAt,
    },
  };
}

// ─── Trigger Integration Sync ───────────────────────────────────────────────

export interface TriggerSyncParams {
  entities?: string[];
  fullSync?: boolean;
}

export async function triggerIntegrationSync(
  env: Env,
  userId: string,
  integrationId: string,
  params: TriggerSyncParams,
  ctx: { waitUntil: (promise: Promise<unknown>) => void },
): Promise<{ syncId: string }> {
  const integration = await db.getIntegration(env.DB, integrationId);
  if (!integration) {
    throw new (await import('@agent-ops/shared')).NotFoundError('Integration', integrationId);
  }
  if (integration.userId !== userId) {
    throw new (await import('@agent-ops/shared')).NotFoundError('Integration', integrationId);
  }
  if (integration.status !== 'active') {
    throw new IntegrationError('Integration is not active', ErrorCodes.INTEGRATION_AUTH_FAILED);
  }

  // Get the integration handler
  const handler = integrationRegistry.get(integration.service);
  if (!handler) {
    throw new ValidationError(`Unsupported integration: ${integration.service}`);
  }

  // Retrieve credentials from Durable Object
  const doId = env.API_KEYS.idFromName(userId);
  const apiKeysDO = env.API_KEYS.get(doId);

  const credsRes = await apiKeysDO.fetch(new Request('http://internal/retrieve', {
    method: 'POST',
    body: JSON.stringify({ service: integration.service }),
  }));

  if (!credsRes.ok) {
    throw new IntegrationError('Failed to retrieve credentials', ErrorCodes.INTEGRATION_AUTH_FAILED);
  }

  const { credentials } = await credsRes.json<{ credentials: Record<string, string> }>();
  handler.setCredentials(credentials);

  // Create sync log
  const syncId = crypto.randomUUID();
  await db.createSyncLog(env.DB, { id: syncId, integrationId });

  // Run sync in background
  ctx.waitUntil(
    (async () => {
      try {
        await db.updateSyncLog(env.DB, syncId, { status: 'running' });

        const result = await handler.sync({
          entities: params.entities || integration.config.entities,
          fullSync: params.fullSync,
        });

        await db.updateSyncLog(env.DB, syncId, {
          status: result.success ? 'completed' : 'failed',
          recordsSynced: result.recordsSynced,
          errors: result.errors,
        });

        if (result.success) {
          await db.updateIntegrationSyncTime(env.DB, integrationId);
        } else {
          await db.updateIntegrationStatus(env.DB, integrationId, 'error', result.errors[0]?.message);
        }
      } catch (error) {
        console.error('Sync error:', error);
        await db.updateSyncLog(env.DB, syncId, {
          status: 'failed',
          errors: [{ entity: 'unknown', message: String(error), code: 'SYNC_ERROR' }],
        });
        await db.updateIntegrationStatus(env.DB, integrationId, 'error', String(error));
      }
    })()
  );

  return { syncId };
}
