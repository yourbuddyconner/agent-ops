import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../lib/drizzle.js';
import * as db from '../lib/db.js';
import { pluginContentRegistry } from '../plugins/content-registry.js';

let synced = false;

export async function syncPluginsOnce(d1: D1Database, orgId: string = 'default', force = false): Promise<void> {
  if (synced && !force) return;
  synced = true;

  const appDb = getDb(d1);

  for (const plugin of pluginContentRegistry) {
    const pluginId = `builtin:${plugin.name}`;

    await db.upsertPlugin(appDb, {
      id: pluginId,
      orgId,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      icon: plugin.icon,
      source: 'builtin',
      capabilities: plugin.capabilities,
    });

    // Replace all artifacts for this plugin
    await db.deletePluginArtifacts(appDb, pluginId);
    for (const artifact of plugin.artifacts) {
      await db.upsertPluginArtifact(appDb, {
        id: crypto.randomUUID(),
        pluginId,
        type: artifact.type,
        filename: artifact.filename,
        content: artifact.content,
        sortOrder: artifact.sortOrder,
      });
    }
  }
}
