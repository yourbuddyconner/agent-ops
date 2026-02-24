import type { D1Database } from '@cloudflare/workers-types';
import type { OrgSettings, OrgApiKey, Invite, UserRole, OrgRepository, OrchestratorIdentity, CustomProvider, CustomProviderModel } from '@agent-ops/shared';
import { eq, and, isNull, gt, sql, desc, asc } from 'drizzle-orm';
import { getDb, toDate } from '../drizzle.js';
import { orgSettings, orgApiKeys, invites, orgRepositories, customProviders } from '../schema/index.js';
import { orchestratorIdentities } from '../schema/orchestrator.js';

function rowToOrgSettings(row: typeof orgSettings.$inferSelect): OrgSettings {
  return {
    id: row.id!,
    name: row.name,
    allowedEmailDomain: row.allowedEmailDomain || undefined,
    allowedEmails: row.allowedEmails || undefined,
    domainGatingEnabled: !!row.domainGatingEnabled,
    emailAllowlistEnabled: !!row.emailAllowlistEnabled,
    defaultSessionVisibility: (row.defaultSessionVisibility as OrgSettings['defaultSessionVisibility']) || 'private',
    modelPreferences: row.modelPreferences || undefined,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function rowToInvite(row: typeof invites.$inferSelect): Invite {
  return {
    id: row.id,
    code: row.code,
    email: row.email || undefined,
    role: row.role as UserRole,
    invitedBy: row.invitedBy,
    acceptedAt: row.acceptedAt ? toDate(row.acceptedAt) : undefined,
    acceptedBy: row.acceptedBy || undefined,
    expiresAt: toDate(row.expiresAt),
    createdAt: toDate(row.createdAt),
  };
}

function rowToOrgRepository(row: any): OrgRepository {
  return {
    id: row.id,
    orgId: row.orgId || row.org_id,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    fullName: row.fullName || row.full_name,
    description: row.description || undefined,
    defaultBranch: row.defaultBranch || row.default_branch || 'main',
    language: row.language || undefined,
    topics: row.topics ? (typeof row.topics === 'string' ? JSON.parse(row.topics) : row.topics) : undefined,
    enabled: row.enabled !== undefined ? !!row.enabled : true,
    personaId: row.personaId || row.persona_id || undefined,
    personaName: row.personaName || row.persona_name || undefined,
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at,
  };
}

// Org settings operations
export async function getOrgSettings(db: D1Database): Promise<OrgSettings> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(orgSettings).where(eq(orgSettings.id, 'default')).get();
  if (!row) {
    return {
      id: 'default',
      name: 'My Organization',
      domainGatingEnabled: false,
      emailAllowlistEnabled: false,
      defaultSessionVisibility: 'private',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  return rowToOrgSettings(row);
}

export async function updateOrgSettings(
  db: D1Database,
  updates: Partial<Pick<OrgSettings, 'name' | 'allowedEmailDomain' | 'allowedEmails' | 'domainGatingEnabled' | 'emailAllowlistEnabled' | 'modelPreferences'>>
): Promise<OrgSettings> {
  // Dynamic SET — keep as raw SQL
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.allowedEmailDomain !== undefined) { sets.push('allowed_email_domain = ?'); params.push(updates.allowedEmailDomain || null); }
  if (updates.allowedEmails !== undefined) { sets.push('allowed_emails = ?'); params.push(updates.allowedEmails || null); }
  if (updates.domainGatingEnabled !== undefined) { sets.push('domain_gating_enabled = ?'); params.push(updates.domainGatingEnabled ? 1 : 0); }
  if (updates.emailAllowlistEnabled !== undefined) { sets.push('email_allowlist_enabled = ?'); params.push(updates.emailAllowlistEnabled ? 1 : 0); }
  if (updates.modelPreferences !== undefined) { sets.push('model_preferences = ?'); params.push(updates.modelPreferences ? JSON.stringify(updates.modelPreferences) : null); }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    await db.prepare(`UPDATE org_settings SET ${sets.join(', ')} WHERE id = 'default'`).bind(...params).run();
  }

  return getOrgSettings(db);
}

// Org API key operations
export async function listOrgApiKeys(db: D1Database): Promise<OrgApiKey[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select({
      id: orgApiKeys.id,
      provider: orgApiKeys.provider,
      setBy: orgApiKeys.setBy,
      createdAt: orgApiKeys.createdAt,
      updatedAt: orgApiKeys.updatedAt,
    })
    .from(orgApiKeys)
    .orderBy(asc(orgApiKeys.provider));

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    isSet: true,
    setBy: row.setBy,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  }));
}

export async function getOrgApiKey(db: D1Database, provider: string): Promise<{ encryptedKey: string } | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({ encryptedKey: orgApiKeys.encryptedKey })
    .from(orgApiKeys)
    .where(eq(orgApiKeys.provider, provider))
    .get();
  return row || null;
}

export async function setOrgApiKey(
  db: D1Database,
  params: { id: string; provider: string; encryptedKey: string; setBy: string }
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.insert(orgApiKeys).values({
    id: params.id,
    provider: params.provider,
    encryptedKey: params.encryptedKey,
    setBy: params.setBy,
  }).onConflictDoUpdate({
    target: orgApiKeys.provider,
    set: {
      encryptedKey: sql`excluded.encrypted_key`,
      setBy: sql`excluded.set_by`,
      updatedAt: sql`datetime('now')`,
    },
  });
}

export async function deleteOrgApiKey(db: D1Database, provider: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(orgApiKeys).where(eq(orgApiKeys.provider, provider));
}

// Custom provider operations
export async function listCustomProviders(db: D1Database): Promise<CustomProvider[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(customProviders)
    .orderBy(asc(customProviders.displayName));

  return rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    hasKey: !!row.encryptedKey,
    models: row.models as CustomProviderModel[],
    setBy: row.setBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getAllCustomProvidersWithKeys(db: D1Database): Promise<Array<{
  providerId: string;
  displayName: string;
  baseUrl: string;
  encryptedKey: string | null;
  models: CustomProviderModel[];
}>> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select({
      providerId: customProviders.providerId,
      displayName: customProviders.displayName,
      baseUrl: customProviders.baseUrl,
      encryptedKey: customProviders.encryptedKey,
      models: customProviders.models,
    })
    .from(customProviders);

  return rows.map((row) => ({
    providerId: row.providerId,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    encryptedKey: row.encryptedKey || null,
    models: row.models as CustomProviderModel[],
  }));
}

export async function upsertCustomProvider(
  db: D1Database,
  params: { id: string; providerId: string; displayName: string; baseUrl: string; encryptedKey: string | null; models: string; setBy: string }
): Promise<void> {
  // models comes as pre-stringified JSON — use raw SQL for this upsert
  await db
    .prepare(
      `INSERT INTO custom_providers (id, provider_id, display_name, base_url, encrypted_key, models, set_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET
         display_name = excluded.display_name,
         base_url = excluded.base_url,
         encrypted_key = excluded.encrypted_key,
         models = excluded.models,
         set_by = excluded.set_by,
         updated_at = datetime('now')`
    )
    .bind(params.id, params.providerId, params.displayName, params.baseUrl, params.encryptedKey, params.models, params.setBy)
    .run();
}

export async function deleteCustomProvider(db: D1Database, providerId: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(customProviders).where(eq(customProviders.providerId, providerId));
}

// Invite operations
export async function createInvite(
  db: D1Database,
  params: { id: string; code: string; email?: string; role: UserRole; invitedBy: string; expiresAt: string }
): Promise<Invite> {
  const drizzle = getDb(db);
  await drizzle.insert(invites).values({
    id: params.id,
    code: params.code,
    email: params.email || null,
    role: params.role,
    invitedBy: params.invitedBy,
    expiresAt: params.expiresAt,
  });

  return {
    id: params.id,
    code: params.code,
    email: params.email,
    role: params.role,
    invitedBy: params.invitedBy,
    expiresAt: new Date(params.expiresAt),
    createdAt: new Date(),
  };
}

export async function getInviteByEmail(db: D1Database, email: string): Promise<Invite | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(invites)
    .where(and(eq(invites.email, email), isNull(invites.acceptedAt), gt(invites.expiresAt, sql`datetime('now')`)))
    .get();
  return row ? rowToInvite(row) : null;
}

export async function getInviteByCode(db: D1Database, code: string): Promise<Invite | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(invites)
    .where(and(eq(invites.code, code), isNull(invites.acceptedAt), gt(invites.expiresAt, sql`datetime('now')`)))
    .get();
  return row ? rowToInvite(row) : null;
}

export async function getInviteByCodeAny(db: D1Database, code: string): Promise<Invite | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(invites)
    .where(eq(invites.code, code))
    .get();
  return row ? rowToInvite(row) : null;
}

export async function listInvites(db: D1Database): Promise<Invite[]> {
  const drizzle = getDb(db);
  const rows = await drizzle.select().from(invites).orderBy(desc(invites.createdAt));
  return rows.map(rowToInvite);
}

export async function deleteInvite(db: D1Database, id: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(invites).where(eq(invites.id, id));
}

export async function markInviteAccepted(db: D1Database, id: string, acceptedBy?: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(invites)
    .set({ acceptedAt: sql`datetime('now')`, acceptedBy: acceptedBy || null })
    .where(eq(invites.id, id));
}

// Org Repository Operations
export async function createOrgRepository(
  db: D1Database,
  data: { id: string; fullName: string; description?: string; defaultBranch?: string; language?: string }
): Promise<OrgRepository> {
  const parts = data.fullName.split('/');
  const owner = parts[0];
  const name = parts[1];
  const drizzle = getDb(db);

  await drizzle.insert(orgRepositories).values({
    id: data.id,
    owner,
    name,
    fullName: data.fullName,
    description: data.description || null,
    defaultBranch: data.defaultBranch || 'main',
    language: data.language || null,
  });

  return rowToOrgRepository({
    id: data.id,
    orgId: 'default',
    provider: 'github',
    owner,
    name,
    fullName: data.fullName,
    description: data.description || null,
    defaultBranch: data.defaultBranch || 'main',
    language: data.language || null,
    topics: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function listOrgRepositories(db: D1Database, orgId: string = 'default'): Promise<OrgRepository[]> {
  // JOIN with persona defaults — keep as raw SQL for the LEFT JOINs
  const result = await db
    .prepare(
      `SELECT r.*, d.persona_id, ap.name as persona_name
       FROM org_repositories r
       LEFT JOIN org_repo_persona_defaults d ON d.org_repo_id = r.id
       LEFT JOIN agent_personas ap ON ap.id = d.persona_id
       WHERE r.org_id = ? AND r.enabled = 1
       ORDER BY r.full_name ASC`
    )
    .bind(orgId)
    .all();

  return (result.results || []).map((row: any) => rowToOrgRepository({
    id: row.id,
    orgId: row.org_id,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    description: row.description,
    defaultBranch: row.default_branch,
    language: row.language,
    topics: row.topics,
    enabled: row.enabled,
    personaId: row.persona_id,
    personaName: row.persona_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getOrgRepository(db: D1Database, id: string): Promise<OrgRepository | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(orgRepositories).where(eq(orgRepositories.id, id)).get();
  return row ? rowToOrgRepository(row) : null;
}

export async function updateOrgRepository(
  db: D1Database,
  id: string,
  updates: Partial<Pick<OrgRepository, 'description' | 'defaultBranch' | 'language' | 'enabled'>>
): Promise<void> {
  // Dynamic SET — keep as raw SQL
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description || null); }
  if (updates.defaultBranch !== undefined) { sets.push('default_branch = ?'); params.push(updates.defaultBranch); }
  if (updates.language !== undefined) { sets.push('language = ?'); params.push(updates.language || null); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE org_repositories SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
}

export async function deleteOrgRepository(db: D1Database, id: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(orgRepositories).where(eq(orgRepositories.id, id));
}

// Org Directory Helper
export async function getOrgAgents(db: D1Database, orgId: string): Promise<OrchestratorIdentity[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(orchestratorIdentities)
    .where(eq(orchestratorIdentities.orgId, orgId))
    .orderBy(asc(orchestratorIdentities.name));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId || undefined,
    orgId: row.orgId,
    type: row.type as OrchestratorIdentity['type'],
    name: row.name,
    handle: row.handle,
    avatar: row.avatar || undefined,
    customInstructions: row.customInstructions || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
