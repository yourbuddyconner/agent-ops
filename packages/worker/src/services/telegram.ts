import { Bot } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { SLASH_COMMANDS } from '@agent-ops/shared';
import * as db from '../lib/db.js';

// ─── Setup Telegram Bot ─────────────────────────────────────────────────────

export type SetupTelegramResult =
  | { ok: true; config: Awaited<ReturnType<typeof db.saveUserTelegramConfig>>; webhookUrl: string }
  | { ok: false; error: string };

export async function setupTelegramBot(
  database: D1Database,
  encryptionKey: string,
  userId: string,
  botToken: string,
  workerUrl: string,
): Promise<SetupTelegramResult> {
  if (!botToken || typeof botToken !== 'string' || !botToken.trim()) {
    return { ok: false, error: 'botToken is required' };
  }

  const trimmedToken = botToken.trim();

  // Validate token by calling getMe()
  const bot = new Bot(trimmedToken);
  let botInfo;
  try {
    botInfo = await bot.api.getMe();
  } catch {
    return { ok: false, error: 'Invalid bot token — could not reach Telegram API' };
  }

  // Save config with encrypted token
  const config = await db.saveUserTelegramConfig(database, {
    id: crypto.randomUUID(),
    userId,
    botToken: trimmedToken,
    botUsername: botInfo.username || botInfo.first_name,
    botInfo: JSON.stringify(botInfo),
    encryptionKey,
  });

  // Register webhook with Telegram
  const webhookUrl = `${workerUrl}/telegram/webhook/${userId}`;
  await bot.api.setWebhook(webhookUrl);

  // Register bot commands
  const tgCommands = SLASH_COMMANDS
    .filter((cmd) => cmd.availableIn.includes('telegram'))
    .map((cmd) => ({ command: cmd.name, description: cmd.description }));
  await bot.api.setMyCommands(tgCommands).catch(() => {
    // Best effort
  });

  // Update webhook status
  await db.updateTelegramWebhookStatus(database, userId, webhookUrl, true);

  return { ok: true, config: { ...config, webhookActive: true } as any, webhookUrl };
}

// ─── Disconnect Telegram Bot ────────────────────────────────────────────────

export async function disconnectTelegramBot(
  database: D1Database,
  encryptionKey: string,
  userId: string,
): Promise<void> {
  const telegramData = await db.getUserTelegramToken(database, userId, encryptionKey);
  if (telegramData) {
    try {
      const bot = new Bot(telegramData.botToken);
      await bot.api.deleteWebhook();
    } catch {
      // Best effort — token may be revoked
    }
  }

  await db.deleteUserTelegramConfig(database, userId);
}
