import type { D1Database } from '@cloudflare/workers-types';
import type { OrgSettings, OrgApiKey, Invite, UserRole, OrgRepository, OrchestratorIdentity, CustomProvider, CustomProviderModel } from '@agent-ops/shared';
import { mapOrgSettings, mapInvite, mapOrgRepository } from './mappers.js';

// Org settings operations
export async function getOrgSettings(db: D1Database): Promise<OrgSettings> {
  const row = await db.prepare("SELECT * FROM org_settings WHERE id = 'default'").first();
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
  return mapOrgSettings(row);
}

export async function updateOrgSettings(
  db: D1Database,
  updates: Partial<Pick<OrgSettings, 'name' | 'allowedEmailDomain' | 'allowedEmails' | 'domainGatingEnabled' | 'emailAllowlistEnabled' | 'modelPreferences'>>
): Promise<OrgSettings> {
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
  const result = await db.prepare('SELECT id, provider, set_by, created_at, updated_at FROM org_api_keys ORDER BY provider').all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    provider: row.provider,
    isSet: true,
    setBy: row.set_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function getOrgApiKey(db: D1Database, provider: string): Promise<{ encryptedKey: string } | null> {
  const row = await db.prepare('SELECT encrypted_key FROM org_api_keys WHERE provider = ?').bind(provider).first<{ encrypted_key: string }>();
  return row ? { encryptedKey: row.encrypted_key } : null;
}

export async function setOrgApiKey(
  db: D1Database,
  params: { id: string; provider: string; encryptedKey: string; setBy: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO org_api_keys (id, provider, encrypted_key, set_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         encrypted_key = excluded.encrypted_key,
         set_by = excluded.set_by,
         updated_at = datetime('now')`
    )
    .bind(params.id, params.provider, params.encryptedKey, params.setBy)
    .run();
}

export async function deleteOrgApiKey(db: D1Database, provider: string): Promise<void> {
  await db.prepare('DELETE FROM org_api_keys WHERE provider = ?').bind(provider).run();
}

// Custom provider operations
export async function listCustomProviders(db: D1Database): Promise<CustomProvider[]> {
  const result = await db.prepare(
    'SELECT id, provider_id, display_name, base_url, encrypted_key, models, set_by, created_at, updated_at FROM custom_providers ORDER BY display_name'
  ).all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    hasKey: !!row.encrypted_key,
    models: JSON.parse(row.models || '[]'),
    setBy: row.set_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getAllCustomProvidersWithKeys(db: D1Database): Promise<Array<{
  providerId: string;
  displayName: string;
  baseUrl: string;
  encryptedKey: string | null;
  models: CustomProviderModel[];
}>> {
  const result = await db.prepare(
    'SELECT provider_id, display_name, base_url, encrypted_key, models FROM custom_providers'
  ).all();
  return (result.results || []).map((row: any) => ({
    providerId: row.provider_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    encryptedKey: row.encrypted_key || null,
    models: JSON.parse(row.models || '[]'),
  }));
}

export async function upsertCustomProvider(
  db: D1Database,
  params: { id: string; providerId: string; displayName: string; baseUrl: string; encryptedKey: string | null; models: string; setBy: string }
): Promise<void> {
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
  await db.prepare('DELETE FROM custom_providers WHERE provider_id = ?').bind(providerId).run();
}

// Invite operations
export async function createInvite(
  db: D1Database,
  params: { id: string; code: string; email?: string; role: UserRole; invitedBy: string; expiresAt: string }
): Promise<Invite> {
  await db
    .prepare('INSERT INTO invites (id, code, email, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(params.id, params.code, params.email || null, params.role, params.invitedBy, params.expiresAt)
    .run();

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
  const row = await db
    .prepare("SELECT * FROM invites WHERE email = ? AND accepted_at IS NULL AND expires_at > datetime('now')")
    .bind(email)
    .first();
  return row ? mapInvite(row) : null;
}

export async function getInviteByCode(db: D1Database, code: string): Promise<Invite | null> {
  const row = await db
    .prepare("SELECT * FROM invites WHERE code = ? AND accepted_at IS NULL AND expires_at > datetime('now')")
    .bind(code)
    .first();
  return row ? mapInvite(row) : null;
}

export async function getInviteByCodeAny(db: D1Database, code: string): Promise<Invite | null> {
  const row = await db
    .prepare("SELECT * FROM invites WHERE code = ?")
    .bind(code)
    .first();
  return row ? mapInvite(row) : null;
}

export async function listInvites(db: D1Database): Promise<Invite[]> {
  const result = await db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all();
  return (result.results || []).map(mapInvite);
}

export async function deleteInvite(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM invites WHERE id = ?').bind(id).run();
}

export async function markInviteAccepted(db: D1Database, id: string, acceptedBy?: string): Promise<void> {
  await db.prepare("UPDATE invites SET accepted_at = datetime('now'), accepted_by = ? WHERE id = ?").bind(acceptedBy || null, id).run();
}

// Org Repository Operations
export async function createOrgRepository(
  db: D1Database,
  data: { id: string; fullName: string; description?: string; defaultBranch?: string; language?: string }
): Promise<OrgRepository> {
  const parts = data.fullName.split('/');
  const owner = parts[0];
  const name = parts[1];

  await db
    .prepare(
      `INSERT INTO org_repositories (id, owner, name, full_name, description, default_branch, language)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(data.id, owner, name, data.fullName, data.description || null, data.defaultBranch || 'main', data.language || null)
    .run();

  return mapOrgRepository({
    id: data.id,
    org_id: 'default',
    provider: 'github',
    owner,
    name,
    full_name: data.fullName,
    description: data.description || null,
    default_branch: data.defaultBranch || 'main',
    language: data.language || null,
    topics: null,
    enabled: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function listOrgRepositories(db: D1Database, orgId: string = 'default'): Promise<OrgRepository[]> {
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

  return (result.results || []).map(mapOrgRepository);
}

export async function getOrgRepository(db: D1Database, id: string): Promise<OrgRepository | null> {
  const row = await db.prepare('SELECT * FROM org_repositories WHERE id = ?').bind(id).first();
  return row ? mapOrgRepository(row) : null;
}

export async function updateOrgRepository(
  db: D1Database,
  id: string,
  updates: Partial<Pick<OrgRepository, 'description' | 'defaultBranch' | 'language' | 'enabled'>>
): Promise<void> {
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
  await db.prepare('DELETE FROM org_repositories WHERE id = ?').bind(id).run();
}

// Org Directory Helper
export async function getOrgAgents(db: D1Database, orgId: string): Promise<OrchestratorIdentity[]> {
  const result = await db
    .prepare('SELECT * FROM orchestrator_identities WHERE org_id = ? ORDER BY name')
    .bind(orgId)
    .all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id || undefined,
    orgId: row.org_id,
    type: row.type,
    name: row.name,
    handle: row.handle,
    avatar: row.avatar || undefined,
    customInstructions: row.custom_instructions || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
