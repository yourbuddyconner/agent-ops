import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';

export const containersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const createContainerSchema = z.object({
  name: z.string().min(1).max(64),
  instanceSize: z.enum(['dev', 'basic', 'standard']).default('basic'),
  autoSleepMinutes: z.number().min(5).max(60).default(15),
  workspacePath: z.string().optional(),
});

const updateContainerSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  instanceSize: z.enum(['dev', 'basic', 'standard']).optional(),
  autoSleepMinutes: z.number().min(5).max(60).optional(),
});

/**
 * GET /api/containers
 * List user's containers
 */
containersRouter.get('/', async (c) => {
  const user = c.get('user');

  const result = await c.env.DB.prepare(`
    SELECT id, user_id, name, status, instance_size, region, container_id,
           ip_address, port, workspace_path, auto_sleep_minutes,
           last_active_at, started_at, stopped_at, error_message, metadata,
           created_at, updated_at
    FROM containers
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).bind(user.id).all();

  const containers = result.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    instanceSize: row.instance_size,
    region: row.region,
    containerId: row.container_id,
    ipAddress: row.ip_address,
    port: row.port,
    workspacePath: row.workspace_path,
    autoSleepMinutes: row.auto_sleep_minutes,
    lastActiveAt: row.last_active_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    errorMessage: row.error_message,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return c.json({ containers });
});

/**
 * GET /api/containers/:id
 * Get a single container by ID
 */
containersRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const row = await c.env.DB.prepare(`
    SELECT id, user_id, name, status, instance_size, region, container_id,
           ip_address, port, workspace_path, auto_sleep_minutes,
           last_active_at, started_at, stopped_at, error_message, metadata,
           created_at, updated_at
    FROM containers
    WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!row) {
    throw new NotFoundError('Container', id);
  }

  return c.json({
    container: {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      status: row.status,
      instanceSize: row.instance_size,
      region: row.region,
      containerId: row.container_id,
      ipAddress: row.ip_address,
      port: row.port,
      workspacePath: row.workspace_path,
      autoSleepMinutes: row.auto_sleep_minutes,
      lastActiveAt: row.last_active_at,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      errorMessage: row.error_message,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

/**
 * POST /api/containers
 * Create a new container configuration
 */
containersRouter.post('/', zValidator('json', createContainerSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  // Check for duplicate name
  const existing = await c.env.DB.prepare(`
    SELECT id FROM containers WHERE user_id = ? AND name = ?
  `).bind(user.id, body.name).first();

  if (existing) {
    return c.json({ error: 'A container with this name already exists' }, 400);
  }

  await c.env.DB.prepare(`
    INSERT INTO containers (id, user_id, name, status, instance_size, auto_sleep_minutes, workspace_path, created_at, updated_at)
    VALUES (?, ?, ?, 'stopped', ?, ?, ?, ?, ?)
  `).bind(
    id,
    user.id,
    body.name,
    body.instanceSize,
    body.autoSleepMinutes,
    body.workspacePath || null,
    now,
    now
  ).run();

  const row = await c.env.DB.prepare(`
    SELECT id, user_id, name, status, instance_size, region, container_id,
           ip_address, port, workspace_path, auto_sleep_minutes,
           last_active_at, started_at, stopped_at, error_message, metadata,
           created_at, updated_at
    FROM containers WHERE id = ?
  `).bind(id).first();

  return c.json({
    container: {
      id: row!.id,
      userId: row!.user_id,
      name: row!.name,
      status: row!.status,
      instanceSize: row!.instance_size,
      region: row!.region,
      containerId: row!.container_id,
      ipAddress: row!.ip_address,
      port: row!.port,
      workspacePath: row!.workspace_path,
      autoSleepMinutes: row!.auto_sleep_minutes,
      lastActiveAt: row!.last_active_at,
      startedAt: row!.started_at,
      stoppedAt: row!.stopped_at,
      errorMessage: row!.error_message,
      metadata: row!.metadata ? JSON.parse(row!.metadata as string) : null,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at,
    },
    message: 'Container created successfully',
  }, 201);
});

/**
 * PUT /api/containers/:id
 * Update container configuration
 */
containersRouter.put('/:id', zValidator('json', updateContainerSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  // Verify container exists and user owns it
  const existing = await c.env.DB.prepare(`
    SELECT id, status FROM containers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!existing) {
    throw new NotFoundError('Container', id);
  }

  // Build update fields
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    // Check for duplicate name
    const duplicate = await c.env.DB.prepare(`
      SELECT id FROM containers WHERE user_id = ? AND name = ? AND id != ?
    `).bind(user.id, body.name, id).first();
    if (duplicate) {
      return c.json({ error: 'A container with this name already exists' }, 400);
    }
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.instanceSize !== undefined) {
    // Can only change instance size when stopped
    if (existing.status !== 'stopped') {
      return c.json({ error: 'Cannot change instance size while container is running' }, 400);
    }
    updates.push('instance_size = ?');
    values.push(body.instanceSize);
  }
  if (body.autoSleepMinutes !== undefined) {
    updates.push('auto_sleep_minutes = ?');
    values.push(body.autoSleepMinutes);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await c.env.DB.prepare(`
    UPDATE containers SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  // Fetch updated container
  const row = await c.env.DB.prepare(`
    SELECT id, user_id, name, status, instance_size, region, container_id,
           ip_address, port, workspace_path, auto_sleep_minutes,
           last_active_at, started_at, stopped_at, error_message, metadata,
           created_at, updated_at
    FROM containers WHERE id = ?
  `).bind(id).first();

  return c.json({
    container: {
      id: row!.id,
      userId: row!.user_id,
      name: row!.name,
      status: row!.status,
      instanceSize: row!.instance_size,
      region: row!.region,
      containerId: row!.container_id,
      ipAddress: row!.ip_address,
      port: row!.port,
      workspacePath: row!.workspace_path,
      autoSleepMinutes: row!.auto_sleep_minutes,
      lastActiveAt: row!.last_active_at,
      startedAt: row!.started_at,
      stoppedAt: row!.stopped_at,
      errorMessage: row!.error_message,
      metadata: row!.metadata ? JSON.parse(row!.metadata as string) : null,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at,
    },
    message: 'Container updated successfully',
  });
});

/**
 * POST /api/containers/:id/start
 * Start a container
 */
containersRouter.post('/:id/start', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const existing = await c.env.DB.prepare(`
    SELECT id, status, name FROM containers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!existing) {
    throw new NotFoundError('Container', id);
  }

  if (existing.status === 'running' || existing.status === 'starting') {
    return c.json({ error: 'Container is already running or starting' }, 400);
  }

  const now = new Date().toISOString();

  // Update status to starting
  await c.env.DB.prepare(`
    UPDATE containers
    SET status = 'starting', error_message = NULL, updated_at = ?
    WHERE id = ?
  `).bind(now, id).run();

  // Get the Durable Object to start the container
  const doId = c.env.SESSIONS.idFromName(`container:${id}`);
  const stub = c.env.SESSIONS.get(doId);

  try {
    // Initialize and start the container via Durable Object
    const response = await stub.fetch(new Request('http://internal/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        containerId: id,
        userId: user.id,
        name: existing.name,
      }),
    }));

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const result = await response.json() as { ipAddress?: string; region?: string };

    // Update with running status
    await c.env.DB.prepare(`
      UPDATE containers
      SET status = 'running', started_at = ?, last_active_at = ?,
          ip_address = ?, region = ?, updated_at = ?
      WHERE id = ?
    `).bind(now, now, result.ipAddress || null, result.region || null, now, id).run();

  } catch (err) {
    // Update with error status
    const errorMessage = err instanceof Error ? err.message : 'Failed to start container';
    await c.env.DB.prepare(`
      UPDATE containers
      SET status = 'error', error_message = ?, updated_at = ?
      WHERE id = ?
    `).bind(errorMessage, now, id).run();

    return c.json({ error: errorMessage }, 500);
  }

  // Fetch updated container
  const row = await c.env.DB.prepare(`
    SELECT id, user_id, name, status, instance_size, region, container_id,
           ip_address, port, workspace_path, auto_sleep_minutes,
           last_active_at, started_at, stopped_at, error_message, metadata,
           created_at, updated_at
    FROM containers WHERE id = ?
  `).bind(id).first();

  return c.json({
    container: {
      id: row!.id,
      userId: row!.user_id,
      name: row!.name,
      status: row!.status,
      instanceSize: row!.instance_size,
      region: row!.region,
      containerId: row!.container_id,
      ipAddress: row!.ip_address,
      port: row!.port,
      workspacePath: row!.workspace_path,
      autoSleepMinutes: row!.auto_sleep_minutes,
      lastActiveAt: row!.last_active_at,
      startedAt: row!.started_at,
      stoppedAt: row!.stopped_at,
      errorMessage: row!.error_message,
      metadata: row!.metadata ? JSON.parse(row!.metadata as string) : null,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at,
    },
    message: 'Container started successfully',
  });
});

/**
 * POST /api/containers/:id/stop
 * Stop a container
 */
containersRouter.post('/:id/stop', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const existing = await c.env.DB.prepare(`
    SELECT id, status FROM containers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!existing) {
    throw new NotFoundError('Container', id);
  }

  if (existing.status === 'stopped' || existing.status === 'stopping') {
    return c.json({ error: 'Container is already stopped or stopping' }, 400);
  }

  const now = new Date().toISOString();

  // Update status to stopping
  await c.env.DB.prepare(`
    UPDATE containers SET status = 'stopping', updated_at = ? WHERE id = ?
  `).bind(now, id).run();

  // Get the Durable Object to stop the container
  const doId = c.env.SESSIONS.idFromName(`container:${id}`);
  const stub = c.env.SESSIONS.get(doId);

  try {
    const response = await stub.fetch(new Request('http://internal/stop', {
      method: 'POST',
    }));

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    // Update with stopped status
    await c.env.DB.prepare(`
      UPDATE containers
      SET status = 'stopped', stopped_at = ?, ip_address = NULL, region = NULL, updated_at = ?
      WHERE id = ?
    `).bind(now, now, id).run();

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to stop container';
    await c.env.DB.prepare(`
      UPDATE containers
      SET status = 'error', error_message = ?, updated_at = ?
      WHERE id = ?
    `).bind(errorMessage, now, id).run();

    return c.json({ error: errorMessage }, 500);
  }

  // Fetch updated container
  const row = await c.env.DB.prepare(`
    SELECT id, user_id, name, status, instance_size, region, container_id,
           ip_address, port, workspace_path, auto_sleep_minutes,
           last_active_at, started_at, stopped_at, error_message, metadata,
           created_at, updated_at
    FROM containers WHERE id = ?
  `).bind(id).first();

  return c.json({
    container: {
      id: row!.id,
      userId: row!.user_id,
      name: row!.name,
      status: row!.status,
      instanceSize: row!.instance_size,
      region: row!.region,
      containerId: row!.container_id,
      ipAddress: row!.ip_address,
      port: row!.port,
      workspacePath: row!.workspace_path,
      autoSleepMinutes: row!.auto_sleep_minutes,
      lastActiveAt: row!.last_active_at,
      startedAt: row!.started_at,
      stoppedAt: row!.stopped_at,
      errorMessage: row!.error_message,
      metadata: row!.metadata ? JSON.parse(row!.metadata as string) : null,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at,
    },
    message: 'Container stopped successfully',
  });
});

/**
 * DELETE /api/containers/:id
 * Delete a container
 */
containersRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const existing = await c.env.DB.prepare(`
    SELECT id, status FROM containers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!existing) {
    throw new NotFoundError('Container', id);
  }

  // Stop container if running
  if (existing.status === 'running' || existing.status === 'starting') {
    const doId = c.env.SESSIONS.idFromName(`container:${id}`);
    const stub = c.env.SESSIONS.get(doId);
    await stub.fetch(new Request('http://internal/stop', { method: 'POST' })).catch(() => {});
  }

  // Delete the container record
  await c.env.DB.prepare(`
    DELETE FROM containers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).run();

  return c.json({ success: true, message: 'Container deleted successfully' });
});

/**
 * POST /api/containers/:id/heartbeat
 * Update last active timestamp (called by sessions using the container)
 */
containersRouter.post('/:id/heartbeat', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(`
    UPDATE containers SET last_active_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND status = 'running'
  `).bind(now, now, id, user.id).run();

  if (result.meta.changes === 0) {
    throw new NotFoundError('Container', id);
  }

  return c.json({ success: true });
});

/**
 * POST /api/containers/:id/callback
 * Callback endpoint for sandbox bridge to send results.
 * This endpoint is unauthenticated as it's called from the Modal sandbox.
 * The sandbox knows the container ID from its startup parameters.
 */
containersRouter.post('/:id/callback', async (c) => {
  const { id } = c.req.param();

  // Forward to DO (no auth check - sandbox calls this)
  const doId = c.env.SESSIONS.idFromName(`container:${id}`);
  const stub = c.env.SESSIONS.get(doId);

  const response = await stub.fetch(
    new Request('http://internal/callback', {
      method: 'POST',
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    })
  );

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

/**
 * GET /api/containers/:id/ws
 * WebSocket endpoint for clients to connect and receive real-time updates.
 * Uses Durable Object hibernation for efficient scaling.
 */
containersRouter.get('/:id/ws', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  // Verify container exists and user owns it
  const container = await c.env.DB.prepare(`
    SELECT id FROM containers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!container) {
    throw new NotFoundError('Container', id);
  }

  // Upgrade to WebSocket via DO
  const doId = c.env.SESSIONS.idFromName(`container:${id}`);
  const stub = c.env.SESSIONS.get(doId);

  return stub.fetch(c.req.raw);
});

/**
 * ALL /api/containers/:id/proxy/*
 * Proxy authenticated requests to the OpenCode container.
 * This allows the frontend to embed the OpenCode UI in an iframe
 * while handling authentication through the worker.
 */
containersRouter.all('/:id/proxy/*', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  // Verify container exists and user owns it
  const container = await c.env.DB.prepare(`
    SELECT status FROM containers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first();

  if (!container) {
    throw new NotFoundError('Container', id);
  }

  if (container.status !== 'running') {
    return c.json({ error: 'Container is not running' }, 503);
  }

  // Extract the path after /proxy/
  const fullPath = c.req.path;
  const proxyIndex = fullPath.indexOf('/proxy/');
  const pathAfterProxy = proxyIndex !== -1 ? fullPath.substring(proxyIndex + 7) : '';

  // Get the Durable Object stub
  const doId = c.env.SESSIONS.idFromName(`container:${id}`);
  const stub = c.env.SESSIONS.get(doId);

  // Build the URL to forward to the container
  const url = new URL(c.req.url);
  const proxyUrl = new URL(`http://container/${pathAfterProxy}${url.search}`);

  // Forward the request to the Durable Object which will proxy to the container
  const proxyRequest = new Request(proxyUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
  });

  try {
    const response = await stub.fetch(proxyRequest);

    // Return the response, preserving headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return c.json({ error: 'Failed to connect to container' }, 502);
  }
});
