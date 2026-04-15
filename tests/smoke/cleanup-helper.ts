/**
 * Best-effort cleanup helpers for smoke tests. Smoke tests pollute state —
 * memory files, spawned children, tasks. Without cleanup, repeated runs
 * accumulate noise and earlier runs' artifacts can leak into later assertions.
 *
 * Each helper is best-effort: failures are logged, never thrown. Tests should
 * not depend on cleanup succeeding.
 */
import type { SmokeClient } from './client.js';

/**
 * Delete every memory file under a path prefix. Uses mem_rm semantics:
 * append a trailing slash to delete a directory's worth of files at once.
 */
export async function cleanupMemoryUnder(client: SmokeClient, pathPrefix: string): Promise<void> {
  const prefix = pathPrefix.endsWith('/') ? pathPrefix : pathPrefix + '/';
  try {
    await client.memoryDelete(prefix);
  } catch (err) {
    console.warn(`[cleanup] failed to delete memory under ${prefix}:`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Terminate every active child of the given parent session.
 * Iterates the cross-session list and terminates any non-terminated child.
 */
export async function cleanupChildSessions(client: SmokeClient, parentSessionId: string): Promise<void> {
  try {
    const result = await client.request<{ children?: Array<{ id: string; status: string }> }>(
      'GET',
      `/api/sessions/${parentSessionId}/children`,
    );
    const active = (result?.children ?? []).filter((c) => c.status !== 'terminated' && c.status !== 'archived');
    for (const child of active) {
      try {
        await client.request('POST', `/api/sessions/${child.id}/terminate`);
      } catch (err) {
        console.warn(`[cleanup] failed to terminate child ${child.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    console.warn(`[cleanup] failed to list children for ${parentSessionId}:`, err instanceof Error ? err.message : String(err));
  }
}
