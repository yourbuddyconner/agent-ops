import type { D1Database } from '@cloudflare/workers-types';
import type { UserTelegramConfig } from '@agent-ops/shared';
import { eq, sql } from 'drizzle-orm';
import { encryptString, decryptString } from '../crypto.js';
import { getDb } from '../drizzle.js';
import { userTelegramConfig } from '../schema/index.js';

export async function getUserTelegramConfig(
  db: D1Database,
  userId: string,
): Promise<UserTelegramConfig | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({
      id: userTelegramConfig.id,
      userId: userTelegramConfig.userId,
      botUsername: userTelegramConfig.botUsername,
      botInfo: userTelegramConfig.botInfo,
      webhookActive: userTelegramConfig.webhookActive,
      createdAt: userTelegramConfig.createdAt,
      updatedAt: userTelegramConfig.updatedAt,
    })
    .from(userTelegramConfig)
    .where(eq(userTelegramConfig.userId, userId))
    .get();
  if (!row) return null;
  return {
    ...row,
    webhookActive: !!row.webhookActive,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

export async function getUserTelegramToken(
  db: D1Database,
  userId: string,
  encryptionKey: string,
): Promise<{ config: UserTelegramConfig; botToken: string } | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(userTelegramConfig)
    .where(eq(userTelegramConfig.userId, userId))
    .get();
  if (!row) return null;
  const botToken = await decryptString(row.botTokenEncrypted, encryptionKey);
  return {
    config: {
      id: row.id,
      userId: row.userId,
      botUsername: row.botUsername,
      botInfo: row.botInfo,
      webhookActive: !!row.webhookActive,
      createdAt: row.createdAt!,
      updatedAt: row.updatedAt!,
    },
    botToken,
  };
}

export async function saveUserTelegramConfig(
  db: D1Database,
  data: {
    id: string;
    userId: string;
    botToken: string;
    botUsername: string;
    botInfo: string;
    encryptionKey: string;
  },
): Promise<UserTelegramConfig> {
  const encrypted = await encryptString(data.botToken, data.encryptionKey);
  const now = new Date().toISOString();
  const drizzle = getDb(db);

  await drizzle.insert(userTelegramConfig).values({
    id: data.id,
    userId: data.userId,
    botTokenEncrypted: encrypted,
    botUsername: data.botUsername,
    botInfo: data.botInfo,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: userTelegramConfig.userId,
    set: {
      botTokenEncrypted: sql`excluded.bot_token_encrypted`,
      botUsername: sql`excluded.bot_username`,
      botInfo: sql`excluded.bot_info`,
      updatedAt: sql`excluded.updated_at`,
    },
  });

  return {
    id: data.id,
    userId: data.userId,
    botUsername: data.botUsername,
    botInfo: data.botInfo,
    webhookActive: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTelegramWebhookStatus(
  db: D1Database,
  userId: string,
  webhookUrl: string,
  active: boolean,
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(userTelegramConfig)
    .set({
      webhookUrl,
      webhookActive: active,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(userTelegramConfig.userId, userId));
}

export async function deleteUserTelegramConfig(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM user_telegram_config WHERE user_id = ?')
    .bind(userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
