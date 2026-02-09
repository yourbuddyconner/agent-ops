import { Hono } from 'hono';
import { Bot, webhookCallback } from 'grammy';
import type { Env, Variables } from '../env.js';
import { telegramScopeKey, SLASH_COMMANDS } from '@agent-ops/shared';
import * as db from '../lib/db.js';
import { dispatchOrchestratorPrompt } from '../lib/workflow-runtime.js';

// ─── Forward / Quote Formatting ──────────────────────────────────────────────

/**
 * Extract forward attribution from a Telegram message.
 * Returns a display name like "Forwarded from Wyatt Benno" or null.
 */
function getForwardAttribution(message: Record<string, unknown>): string | null {
  const origin = message.forward_origin as Record<string, unknown> | undefined;
  if (!origin) return null;

  const type = origin.type as string;
  switch (type) {
    case 'user': {
      const user = origin.sender_user as Record<string, unknown> | undefined;
      if (!user) return 'Forwarded message';
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
      const username = user.username ? ` (@${user.username})` : '';
      return `Forwarded from ${name}${username}`;
    }
    case 'hidden_user': {
      const name = origin.sender_user_name as string | undefined;
      return name ? `Forwarded from ${name}` : 'Forwarded message';
    }
    case 'chat': {
      const chat = origin.sender_chat as Record<string, unknown> | undefined;
      const title = chat?.title as string | undefined;
      return title ? `Forwarded from ${title}` : 'Forwarded from a group chat';
    }
    case 'channel': {
      const chat = origin.chat as Record<string, unknown> | undefined;
      const title = chat?.title as string | undefined;
      return title ? `Forwarded from ${title}` : 'Forwarded from a channel';
    }
    default:
      return 'Forwarded message';
  }
}

/**
 * Format a Telegram message, wrapping forwarded messages in a quote block
 * with attribution so the agent sees the context.
 */
function formatTelegramMessage(text: string, message: Record<string, unknown>): string {
  const attribution = getForwardAttribution(message);
  if (!attribution) return text;

  // Format as a markdown blockquote with attribution header
  const quotedLines = text.split('\n').map((line) => `> ${line}`).join('\n');
  return `**${attribution}:**\n${quotedLines}`;
}

// ─── Webhook Router (unauthenticated — Telegram calls this) ─────────────────

export const telegramRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /telegram/webhook/:userId
 * Per-user webhook endpoint. Telegram sends updates here for each user's bot.
 */
telegramRouter.post('/webhook/:userId', async (c) => {
  const userId = c.req.param('userId');

  const telegramData = await db.getUserTelegramToken(
    c.env.DB, userId, c.env.ENCRYPTION_KEY,
  );
  if (!telegramData) {
    return c.json({ error: 'No telegram config' }, 404);
  }

  const { config, botToken } = telegramData;

  const bot = new Bot(botToken, {
    botInfo: JSON.parse(config.botInfo),
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Connected to Agent-Ops! Send me a message and it will be routed to your orchestrator.',
    );
  });

  // ─── Slash Commands ─────────────────────────────────────────────────
  bot.command('help', async (ctx) => {
    const commands = SLASH_COMMANDS.filter((cmd) => cmd.availableIn.includes('telegram'));
    const text = commands.map((cmd) => `/${cmd.name} — ${cmd.description}`).join('\n');
    await ctx.reply(`Available commands:\n${text}`);
  });

  bot.command('status', async (ctx) => {
    try {
      const orchestratorSessionId = `orchestrator:${userId}`;
      const doId = c.env.SESSIONS.idFromName(orchestratorSessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      const resp = await sessionDO.fetch(new Request('http://do/status'));
      if (!resp.ok) {
        await ctx.reply('Could not get orchestrator status.');
        return;
      }
      const status = await resp.json() as Record<string, unknown>;
      let text = `*Orchestrator Status*\nStatus: ${status.status || 'unknown'}`;
      if (status.runnerConnected) text += '\nRunner: connected';
      if (status.promptsQueued) text += `\nQueued prompts: ${status.promptsQueued}`;
      await ctx.reply(text);
    } catch {
      await ctx.reply('Orchestrator is not running.');
    }
  });

  bot.command('stop', async (ctx) => {
    try {
      const orchestratorSessionId = `orchestrator:${userId}`;
      const doId = c.env.SESSIONS.idFromName(orchestratorSessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      await sessionDO.fetch(new Request('http://do/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interrupt: true, content: '' }),
      }));
      await sessionDO.fetch(new Request('http://do/clear-queue', { method: 'POST' }));
      await ctx.reply('Stopped current work and cleared queue.');
    } catch {
      await ctx.reply('Could not stop — orchestrator may not be running.');
    }
  });

  bot.command('clear', async (ctx) => {
    try {
      const orchestratorSessionId = `orchestrator:${userId}`;
      const doId = c.env.SESSIONS.idFromName(orchestratorSessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      await sessionDO.fetch(new Request('http://do/clear-queue', { method: 'POST' }));
      await ctx.reply('Prompt queue cleared.');
    } catch {
      await ctx.reply('Could not clear queue — orchestrator may not be running.');
    }
  });

  bot.command('refresh', async (ctx) => {
    try {
      const orchestratorSessionId = `orchestrator:${userId}`;
      const doId = c.env.SESSIONS.idFromName(orchestratorSessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      await sessionDO.fetch(new Request('http://do/stop', { method: 'POST' }));
      await sessionDO.fetch(new Request('http://do/start', { method: 'POST' }));
      await ctx.reply('Orchestrator session refreshed.');
    } catch {
      await ctx.reply('Could not refresh — orchestrator may not be running.');
    }
  });

  bot.command('sessions', async (ctx) => {
    try {
      const orchestratorSessionId = `orchestrator:${userId}`;
      const doId = c.env.SESSIONS.idFromName(orchestratorSessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      const resp = await sessionDO.fetch(new Request('http://do/children'));
      if (!resp.ok) {
        await ctx.reply('Could not list sessions.');
        return;
      }
      const data = await resp.json() as { children?: Array<{ id: string; title?: string; status: string; workspace?: string }> };
      const list = data.children || [];
      if (list.length === 0) {
        await ctx.reply('No child sessions.');
        return;
      }
      const lines = list.map((child) =>
        `• ${child.title || child.workspace || child.id.slice(0, 8)} — ${child.status}`
      );
      await ctx.reply(`Child sessions (${list.length}):\n${lines.join('\n')}`);
    } catch {
      await ctx.reply('Could not list sessions — orchestrator may not be running.');
    }
  });

  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const rawText = ctx.message.text;

    // Format forwarded messages with attribution and quote block
    const content = formatTelegramMessage(rawText, ctx.message as unknown as Record<string, unknown>);

    // Check for channel binding
    const scopeKey = telegramScopeKey(userId, chatId);
    const binding = await db.getChannelBindingByScopeKey(c.env.DB, scopeKey);

    if (binding) {
      const doId = c.env.SESSIONS.idFromName(binding.sessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      try {
        const resp = await sessionDO.fetch(
          new Request('http://do/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, queueMode: binding.queueMode }),
          }),
        );
        if (resp.ok) return;
      } catch (err) {
        console.error(`Telegram: failed to route to session ${binding.sessionId}:`, err);
      }
    }

    // Dispatch to orchestrator with structured channel metadata
    const result = await dispatchOrchestratorPrompt(c.env, {
      userId,
      content,
      channelType: 'telegram',
      channelId: chatId,
      authorName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
    });

    if (!result.dispatched) {
      await ctx.reply(
        'Your orchestrator is not running. Start it from the Agent-Ops dashboard.',
      );
    }
  });

  bot.on('message:photo', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const caption = ctx.message.caption || '';

    // Get the largest photo size (last in array)
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

    // Download and convert to base64 data URL
    const resp = await fetch(fileUrl);
    if (!resp.ok) {
      await ctx.reply('Failed to download image.');
      return;
    }

    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mime = file.file_path?.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${base64}`;

    const attachment = {
      type: 'file' as const,
      mime,
      url: dataUrl,
      filename: file.file_path?.split('/').pop(),
    };

    // Route same as text — channel binding first, then orchestrator fallback
    const scopeKey = telegramScopeKey(userId, chatId);
    const binding = await db.getChannelBindingByScopeKey(c.env.DB, scopeKey);

    if (binding) {
      const doId = c.env.SESSIONS.idFromName(binding.sessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      try {
        const doResp = await sessionDO.fetch(
          new Request('http://do/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: caption,
              attachments: [attachment],
              queueMode: binding.queueMode,
            }),
          }),
        );
        if (doResp.ok) return;
      } catch (err) {
        console.error(`Telegram: failed to route photo to session ${binding.sessionId}:`, err);
      }
    }

    // Dispatch to orchestrator
    const result = await dispatchOrchestratorPrompt(c.env, {
      userId,
      content: caption || '[Image]',
      channelType: 'telegram',
      channelId: chatId,
      authorName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
      attachments: [attachment],
    });

    if (!result.dispatched) {
      await ctx.reply(
        'Your orchestrator is not running. Start it from the Agent-Ops dashboard.',
      );
    }
  });

  bot.on('message:voice', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const caption = ctx.message.caption || '';
    const duration = ctx.message.voice.duration;

    const file = await ctx.api.getFile(ctx.message.voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

    const resp = await fetch(fileUrl);
    if (!resp.ok) {
      await ctx.reply('Failed to download voice note.');
      return;
    }

    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const dataUrl = `data:audio/ogg;base64,${base64}`;

    const attachment = {
      type: 'file' as const,
      mime: 'audio/ogg',
      url: dataUrl,
      filename: file.file_path?.split('/').pop() || `voice-${Date.now()}.ogg`,
    };

    const content = caption || `[Voice note, ${duration}s]`;

    const scopeKey = telegramScopeKey(userId, chatId);
    const binding = await db.getChannelBindingByScopeKey(c.env.DB, scopeKey);

    if (binding) {
      const doId = c.env.SESSIONS.idFromName(binding.sessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      try {
        const doResp = await sessionDO.fetch(
          new Request('http://do/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              attachments: [attachment],
              queueMode: binding.queueMode,
            }),
          }),
        );
        if (doResp.ok) return;
      } catch (err) {
        console.error(`Telegram: failed to route voice to session ${binding.sessionId}:`, err);
      }
    }

    const result = await dispatchOrchestratorPrompt(c.env, {
      userId,
      content,
      channelType: 'telegram',
      channelId: chatId,
      authorName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
      attachments: [attachment],
    });

    if (!result.dispatched) {
      await ctx.reply(
        'Your orchestrator is not running. Start it from the Agent-Ops dashboard.',
      );
    }
  });

  bot.on('message:audio', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const caption = ctx.message.caption || '';
    const audio = ctx.message.audio;

    const file = await ctx.api.getFile(audio.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

    const resp = await fetch(fileUrl);
    if (!resp.ok) {
      await ctx.reply('Failed to download audio file.');
      return;
    }

    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mime = audio.mime_type || 'audio/mpeg';
    const dataUrl = `data:${mime};base64,${base64}`;

    const attachment = {
      type: 'file' as const,
      mime,
      url: dataUrl,
      filename: audio.file_name || file.file_path?.split('/').pop() || `audio-${Date.now()}.mp3`,
    };

    const content = caption || `[Audio: ${audio.title || audio.file_name || 'untitled'}, ${audio.duration}s]`;

    const scopeKey = telegramScopeKey(userId, chatId);
    const binding = await db.getChannelBindingByScopeKey(c.env.DB, scopeKey);

    if (binding) {
      const doId = c.env.SESSIONS.idFromName(binding.sessionId);
      const sessionDO = c.env.SESSIONS.get(doId);
      try {
        const doResp = await sessionDO.fetch(
          new Request('http://do/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              attachments: [attachment],
              queueMode: binding.queueMode,
            }),
          }),
        );
        if (doResp.ok) return;
      } catch (err) {
        console.error(`Telegram: failed to route audio to session ${binding.sessionId}:`, err);
      }
    }

    const result = await dispatchOrchestratorPrompt(c.env, {
      userId,
      content,
      channelType: 'telegram',
      channelId: chatId,
      authorName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
      attachments: [attachment],
    });

    if (!result.dispatched) {
      await ctx.reply(
        'Your orchestrator is not running. Start it from the Agent-Ops dashboard.',
      );
    }
  });

  const handler = webhookCallback(bot, 'hono');
  return handler(c);
});

// ─── API Router (authenticated — user calls this) ───────────────────────────

export const telegramApiRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/me/telegram — Set up Telegram bot
 * Body: { botToken: string }
 */
telegramApiRouter.post('/', async (c) => {
  const user = c.get('user');
  const { botToken } = await c.req.json<{ botToken: string }>();

  if (!botToken || typeof botToken !== 'string' || !botToken.trim()) {
    return c.json({ error: 'botToken is required' }, 400);
  }

  // Validate token by calling getMe()
  const bot = new Bot(botToken.trim());
  let botInfo;
  try {
    botInfo = await bot.api.getMe();
  } catch {
    return c.json({ error: 'Invalid bot token — could not reach Telegram API' }, 400);
  }

  // Save config with encrypted token
  const config = await db.saveUserTelegramConfig(c.env.DB, {
    id: crypto.randomUUID(),
    userId: user.id,
    botToken: botToken.trim(),
    botUsername: botInfo.username || botInfo.first_name,
    botInfo: JSON.stringify(botInfo),
    encryptionKey: c.env.ENCRYPTION_KEY,
  });

  // Register webhook with Telegram
  const workerUrl = new URL(c.req.url).origin;
  const webhookUrl = `${workerUrl}/telegram/webhook/${user.id}`;
  await bot.api.setWebhook(webhookUrl);

  // Register bot commands so Telegram shows the command menu
  const tgCommands = SLASH_COMMANDS
    .filter((cmd) => cmd.availableIn.includes('telegram'))
    .map((cmd) => ({ command: cmd.name, description: cmd.description }));
  await bot.api.setMyCommands(tgCommands).catch(() => {
    // Best effort — non-critical if this fails
  });

  // Update webhook status
  await db.updateTelegramWebhookStatus(c.env.DB, user.id, webhookUrl, true);

  return c.json({ config: { ...config, webhookActive: true }, webhookUrl });
});

/**
 * GET /api/me/telegram — Get current Telegram config
 */
telegramApiRouter.get('/', async (c) => {
  const user = c.get('user');
  const config = await db.getUserTelegramConfig(c.env.DB, user.id);
  return c.json({ config });
});

/**
 * DELETE /api/me/telegram — Disconnect Telegram bot
 */
telegramApiRouter.delete('/', async (c) => {
  const user = c.get('user');

  // Get token to call deleteWebhook
  const telegramData = await db.getUserTelegramToken(
    c.env.DB, user.id, c.env.ENCRYPTION_KEY,
  );
  if (telegramData) {
    try {
      const bot = new Bot(telegramData.botToken);
      await bot.api.deleteWebhook();
    } catch {
      // Best effort — token may be revoked
    }
  }

  await db.deleteUserTelegramConfig(c.env.DB, user.id);
  return c.json({ success: true });
});

// ─── Markdown → Telegram HTML Conversion ────────────────────────────────────

/**
 * Convert standard Markdown to Telegram-compatible HTML.
 * Handles: fenced code blocks, inline code, bold, italic, links.
 * Escapes HTML entities in non-code text to prevent Telegram API parse errors.
 */
export function markdownToTelegramHtml(text: string): string {
  // Extract fenced code blocks first to protect them from formatting transforms
  const codeBlocks: string[] = [];
  let result = text.replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_, code: string) => {
    codeBlocks.push(code.trimEnd());
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Extract inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_, code: string) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Escape HTML entities in remaining text
  result = result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Convert markdown formatting to HTML (order matters: bold before italic)
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  result = result.replace(/__(.+?)__/g, '<b>$1</b>');
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<i>$1</i>');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore inline code with HTML escaping
  result = result.replace(/\x00IC(\d+)\x00/g, (_, i) => {
    const code = inlineCodes[Number(i)].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code>${code}</code>`;
  });

  // Restore code blocks with HTML escaping
  result = result.replace(/\x00CB(\d+)\x00/g, (_, i) => {
    const code = codeBlocks[Number(i)].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre>${code}</pre>`;
  });

  return result;
}

// ─── Response Delivery Utility ──────────────────────────────────────────────

/**
 * Send a message back to a Telegram chat via the Bot API.
 * Uses HTML parse mode with Markdown→HTML conversion for reliable formatting.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  const html = markdownToTelegramHtml(text);
  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML' }),
    },
  );
  return resp.ok;
}

/**
 * Send a photo to a Telegram chat via the Bot API using multipart upload.
 * Accepts base64-encoded image data. Optional caption is converted from Markdown to HTML.
 */
export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoBase64: string,
  mimeType: string,
  caption?: string,
): Promise<boolean> {
  const binaryString = atob(photoBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([bytes], { type: mimeType }), `image.${ext}`);
  if (caption) {
    formData.append('caption', markdownToTelegramHtml(caption));
    formData.append('parse_mode', 'HTML');
  }

  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendPhoto`,
    { method: 'POST', body: formData },
  );
  return resp.ok;
}
