import { Bot } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { SLASH_COMMANDS } from '@agent-ops/shared';
import type { UserTelegramConfig } from '@agent-ops/shared';
import type { Env } from '../env.js';
import * as db from '../lib/db.js';
import { storeCredential, getCredential, revokeCredential } from '../services/credentials.js';

// ─── Setup Telegram Bot ─────────────────────────────────────────────────────

export type SetupTelegramResult =
  | { ok: true; config: UserTelegramConfig & { webhookActive: boolean }; webhookUrl: string }
  | { ok: false; error: string };

export async function setupTelegramBot(
  env: Env,
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

  // Store bot token in unified credentials table
  await storeCredential(env, userId, 'telegram', { bot_token: trimmedToken }, {
    credentialType: 'bot_token',
  });

  // Save metadata (token is in credentials table, not here)
  const config = await db.saveUserTelegramConfig(env.DB, {
    id: crypto.randomUUID(),
    userId,
    botUsername: botInfo.username || botInfo.first_name,
    botInfo: JSON.stringify(botInfo),
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
  await db.updateTelegramWebhookStatus(env.DB, userId, webhookUrl, true);

  return { ok: true, config: { ...config, webhookActive: true } as any, webhookUrl };
}

// ─── Disconnect Telegram Bot ────────────────────────────────────────────────

export async function disconnectTelegramBot(
  env: Env,
  userId: string,
): Promise<void> {
  const credResult = await getCredential(env, userId, 'telegram');
  if (credResult.ok) {
    try {
      const bot = new Bot(credResult.credential.accessToken);
      await bot.api.deleteWebhook();
    } catch {
      // Best effort — token may be revoked
    }
  }

  // Remove credential and metadata
  await revokeCredential(env, userId, 'telegram');
  await db.deleteUserTelegramConfig(env.DB, userId);
}
