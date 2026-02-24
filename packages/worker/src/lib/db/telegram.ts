import type { D1Database } from '@cloudflare/workers-types';
import type { UserTelegramConfig } from '@agent-ops/shared';
import { encryptString, decryptString } from '../crypto.js';
import { mapTelegramConfig } from './mappers.js';

export async function getUserTelegramConfig(
  db: D1Database,
  userId: string,
): Promise<UserTelegramConfig | null> {
  const row = await db
    .prepare('SELECT * FROM user_telegram_config WHERE user_id = ?')
    .bind(userId)
    .first();
  return row ? mapTelegramConfig(row) : null;
}

export async function getUserTelegramToken(
  db: D1Database,
  userId: string,
  encryptionKey: string,
): Promise<{ config: UserTelegramConfig; botToken: string } | null> {
  const row = await db
    .prepare('SELECT * FROM user_telegram_config WHERE user_id = ?')
    .bind(userId)
    .first<any>();
  if (!row) return null;
  const botToken = await decryptString(row.bot_token_encrypted, encryptionKey);
  return { config: mapTelegramConfig(row), botToken };
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

  await db
    .prepare(
      `INSERT INTO user_telegram_config (id, user_id, bot_token_encrypted, bot_username, bot_info, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         bot_token_encrypted = excluded.bot_token_encrypted,
         bot_username = excluded.bot_username,
         bot_info = excluded.bot_info,
         updated_at = excluded.updated_at`,
    )
    .bind(data.id, data.userId, encrypted, data.botUsername, data.botInfo, now, now)
    .run();

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
  await db
    .prepare(
      'UPDATE user_telegram_config SET webhook_url = ?, webhook_active = ?, updated_at = datetime(\'now\') WHERE user_id = ?',
    )
    .bind(webhookUrl, active ? 1 : 0, userId)
    .run();
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
