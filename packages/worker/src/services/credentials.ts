import type { Env } from '../env.js';
import { encryptStringPBKDF2, decryptStringPBKDF2 } from '../lib/crypto.js';
import * as credentialDb from '../lib/db/credentials.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type CredentialType = 'oauth2' | 'api_key' | 'bot_token' | 'service_account';

export interface ResolvedCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
  credentialType: CredentialType;
  refreshed: boolean;
}

export interface CredentialResolutionError {
  service: string;
  reason: 'not_found' | 'expired' | 'refresh_failed' | 'decryption_failed' | 'revoked';
  message: string;
}

export type CredentialResult =
  | { ok: true; credential: ResolvedCredential }
  | { ok: false; error: CredentialResolutionError };

// ─── Internal Helpers ───────────────────────────────────────────────────────

interface CredentialData {
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  bot_token?: string;
  token?: string;
  [key: string]: unknown;
}

async function encryptCredentialData(data: Record<string, unknown>, secret: string): Promise<string> {
  return encryptStringPBKDF2(JSON.stringify(data), secret);
}

async function decryptCredentialData(encrypted: string, secret: string): Promise<CredentialData> {
  const json = await decryptStringPBKDF2(encrypted, secret);
  return JSON.parse(json) as CredentialData;
}

function extractAccessToken(data: CredentialData): string | undefined {
  return data.access_token || data.api_key || data.bot_token || data.token;
}

// ─── Google OAuth Refresh ───────────────────────────────────────────────────

async function refreshGoogleToken(
  env: Env,
  userId: string,
  provider: string,
  data: CredentialData,
): Promise<CredentialResult> {
  if (!data.refresh_token) {
    return {
      ok: false,
      error: { service: provider, reason: 'refresh_failed', message: 'No refresh token available' },
    };
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    return {
      ok: false,
      error: { service: provider, reason: 'refresh_failed', message: `Google refresh failed: ${res.status}` },
    };
  }

  const refreshed = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  const newData: CredentialData = {
    access_token: refreshed.access_token,
    refresh_token: data.refresh_token, // refresh token doesn't change
  };

  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const encrypted = await encryptCredentialData(newData, env.ENCRYPTION_KEY);

  await credentialDb.upsertCredential(env.DB, {
    id: crypto.randomUUID(),
    userId,
    provider,
    credentialType: 'oauth2',
    encryptedData: encrypted,
    expiresAt,
  });

  return {
    ok: true,
    credential: {
      accessToken: refreshed.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(expiresAt),
      credentialType: 'oauth2',
      refreshed: true,
    },
  };
}

async function attemptRefresh(
  env: Env,
  userId: string,
  provider: string,
  data: CredentialData,
): Promise<CredentialResult> {
  switch (provider) {
    case 'google':
    case 'gmail':
    case 'google_calendar':
      return refreshGoogleToken(env, userId, provider, data);
    case 'github':
      return {
        ok: false,
        error: { service: provider, reason: 'refresh_failed', message: 'GitHub tokens do not support refresh' },
      };
    default:
      return {
        ok: false,
        error: { service: provider, reason: 'refresh_failed', message: `No refresh handler for ${provider}` },
      };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getCredential(
  env: Env,
  userId: string,
  provider: string,
  options?: { forceRefresh?: boolean },
): Promise<CredentialResult> {
  const row = await credentialDb.getCredentialRow(env.DB, userId, provider);
  if (!row) {
    return {
      ok: false,
      error: { service: provider, reason: 'not_found', message: `No credentials for ${provider}` },
    };
  }

  let data: CredentialData;
  try {
    data = await decryptCredentialData(row.encryptedData, env.ENCRYPTION_KEY);
  } catch {
    return {
      ok: false,
      error: { service: provider, reason: 'decryption_failed', message: `Failed to decrypt credentials for ${provider}` },
    };
  }

  // Check expiration (with 60-second buffer)
  if (row.expiresAt && new Date(row.expiresAt).getTime() - Date.now() < 60_000) {
    if (data.refresh_token) {
      const refreshed = await attemptRefresh(env, userId, provider, data);
      if (refreshed.ok) return refreshed;
    }
    if (options?.forceRefresh) {
      return {
        ok: false,
        error: { service: provider, reason: 'expired', message: 'Credential expired and refresh failed' },
      };
    }
    // Return potentially expired credential — caller can decide
  }

  const accessToken = extractAccessToken(data);
  if (!accessToken) {
    return {
      ok: false,
      error: { service: provider, reason: 'decryption_failed', message: `Credential data missing token field for ${provider}` },
    };
  }

  return {
    ok: true,
    credential: {
      accessToken,
      refreshToken: data.refresh_token,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
      scopes: row.scopes?.split(' ') ?? undefined,
      credentialType: row.credentialType as CredentialType,
      refreshed: false,
    },
  };
}

export async function storeCredential(
  env: Env,
  userId: string,
  provider: string,
  credentialData: Record<string, string>,
  options?: {
    credentialType?: CredentialType;
    scopes?: string;
    expiresAt?: string;
  },
): Promise<void> {
  const encrypted = await encryptCredentialData(credentialData, env.ENCRYPTION_KEY);

  await credentialDb.upsertCredential(env.DB, {
    id: crypto.randomUUID(),
    userId,
    provider,
    credentialType: options?.credentialType ?? 'api_key',
    encryptedData: encrypted,
    scopes: options?.scopes,
    expiresAt: options?.expiresAt,
  });
}

export async function revokeCredential(
  env: Env,
  userId: string,
  provider: string,
): Promise<void> {
  await credentialDb.deleteCredential(env.DB, userId, provider);
}

export async function listCredentials(
  env: Env,
  userId: string,
): Promise<Array<{
  provider: string;
  credentialType: string;
  scopes?: string;
  expiresAt?: string;
  createdAt: string;
}>> {
  const rows = await credentialDb.listCredentialsByUser(env.DB, userId);
  return rows.map((row) => ({
    provider: row.provider,
    credentialType: row.credentialType,
    scopes: row.scopes ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    createdAt: row.createdAt,
  }));
}

export async function resolveCredentials(
  env: Env,
  userId: string,
  providers: string[],
): Promise<Map<string, CredentialResult>> {
  const results = new Map<string, CredentialResult>();
  await Promise.all(
    providers.map(async (provider) => {
      results.set(provider, await getCredential(env, userId, provider));
    }),
  );
  return results;
}

export async function hasCredential(
  env: Env,
  userId: string,
  provider: string,
): Promise<boolean> {
  return credentialDb.hasCredential(env.DB, userId, provider);
}
