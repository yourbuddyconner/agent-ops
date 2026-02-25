import type { D1Database } from '@cloudflare/workers-types';
import type { UserTelegramConfig } from '@agent-ops/shared';
import { eq, sql } from 'drizzle-orm';
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

export async function saveUserTelegramConfig(
  db: D1Database,
  data: {
    id: string;
    userId: string;
    botUsername: string;
    botInfo: string;
  },
): Promise<UserTelegramConfig> {
  const now = new Date().toISOString();
  const drizzle = getDb(db);

  await drizzle.insert(userTelegramConfig).values({
    id: data.id,
    userId: data.userId,
    botUsername: data.botUsername,
    botInfo: data.botInfo,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: userTelegramConfig.userId,
    set: {
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
