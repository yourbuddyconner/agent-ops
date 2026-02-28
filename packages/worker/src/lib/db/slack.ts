import type { AppDb } from '../drizzle.js';
import { eq, and, sql, lt } from 'drizzle-orm';
import { orgSlackInstalls, slackLinkVerifications } from '../schema/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrgSlackInstall {
  id: string;
  teamId: string;
  teamName: string | null;
  botUserId: string;
  appId: string | null;
  encryptedBotToken: string;
  encryptedSigningSecret: string | null;
  installedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackLinkVerification {
  id: string;
  userId: string;
  slackUserId: string;
  slackDisplayName: string | null;
  code: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Org Install Helpers ────────────────────────────────────────────────────

export async function getOrgSlackInstall(
  db: AppDb,
  teamId: string,
): Promise<OrgSlackInstall | null> {
  const row = await db
    .select()
    .from(orgSlackInstalls)
    .where(eq(orgSlackInstalls.teamId, teamId))
    .get();
  return row ? { ...row, createdAt: row.createdAt!, updatedAt: row.updatedAt! } : null;
}

export async function getOrgSlackInstallAny(
  db: AppDb,
): Promise<OrgSlackInstall | null> {
  const row = await db
    .select()
    .from(orgSlackInstalls)
    .limit(1)
    .get();
  return row ? { ...row, createdAt: row.createdAt!, updatedAt: row.updatedAt! } : null;
}

export async function saveOrgSlackInstall(
  db: AppDb,
  data: {
    id: string;
    teamId: string;
    teamName?: string;
    botUserId: string;
    appId?: string;
    encryptedBotToken: string;
    encryptedSigningSecret?: string;
    installedBy: string;
  },
): Promise<OrgSlackInstall> {
  const now = new Date().toISOString();

  await db.insert(orgSlackInstalls).values({
    id: data.id,
    teamId: data.teamId,
    teamName: data.teamName || null,
    botUserId: data.botUserId,
    appId: data.appId || null,
    encryptedBotToken: data.encryptedBotToken,
    encryptedSigningSecret: data.encryptedSigningSecret || null,
    installedBy: data.installedBy,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: orgSlackInstalls.teamId,
    set: {
      teamName: sql`excluded.team_name`,
      botUserId: sql`excluded.bot_user_id`,
      appId: sql`excluded.app_id`,
      encryptedBotToken: sql`excluded.encrypted_bot_token`,
      encryptedSigningSecret: sql`excluded.encrypted_signing_secret`,
      installedBy: sql`excluded.installed_by`,
      updatedAt: sql`excluded.updated_at`,
    },
  });

  return {
    id: data.id,
    teamId: data.teamId,
    teamName: data.teamName || null,
    botUserId: data.botUserId,
    appId: data.appId || null,
    encryptedBotToken: data.encryptedBotToken,
    encryptedSigningSecret: data.encryptedSigningSecret || null,
    installedBy: data.installedBy,
    createdAt: now,
    updatedAt: now,
  };
}

export async function deleteOrgSlackInstall(
  db: AppDb,
  teamId: string,
): Promise<boolean> {
  const result = await db
    .delete(orgSlackInstalls)
    .where(eq(orgSlackInstalls.teamId, teamId));
  return (result.meta?.changes ?? 0) > 0;
}

// ─── Verification Helpers ───────────────────────────────────────────────────

export async function createSlackLinkVerification(
  db: AppDb,
  data: {
    id: string;
    userId: string;
    slackUserId: string;
    slackDisplayName?: string;
    code: string;
    expiresAt: string;
  },
): Promise<SlackLinkVerification> {
  await db.insert(slackLinkVerifications).values({
    id: data.id,
    userId: data.userId,
    slackUserId: data.slackUserId,
    slackDisplayName: data.slackDisplayName || null,
    code: data.code,
    expiresAt: data.expiresAt,
  });

  return {
    id: data.id,
    userId: data.userId,
    slackUserId: data.slackUserId,
    slackDisplayName: data.slackDisplayName || null,
    code: data.code,
    expiresAt: data.expiresAt,
    createdAt: new Date().toISOString(),
  };
}

export async function getSlackLinkVerification(
  db: AppDb,
  userId: string,
): Promise<SlackLinkVerification | null> {
  const now = new Date().toISOString();
  const row = await db
    .select()
    .from(slackLinkVerifications)
    .where(
      and(
        eq(slackLinkVerifications.userId, userId),
        sql`${slackLinkVerifications.expiresAt} > ${now}`,
      ),
    )
    .orderBy(sql`${slackLinkVerifications.createdAt} DESC`)
    .limit(1)
    .get();
  return row ? { ...row, createdAt: row.createdAt! } : null;
}

export async function deleteSlackLinkVerification(
  db: AppDb,
  id: string,
): Promise<void> {
  await db.delete(slackLinkVerifications).where(eq(slackLinkVerifications.id, id));
}

export async function deleteExpiredSlackLinkVerifications(
  db: AppDb,
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .delete(slackLinkVerifications)
    .where(lt(slackLinkVerifications.expiresAt, now));
  return result.meta?.changes ?? 0;
}
