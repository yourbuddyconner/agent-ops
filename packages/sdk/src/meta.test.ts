import { describe, it, expect } from 'vitest';
import {
  getChannelMeta,
  listChannelMeta,
  formatChannelLabel,
} from './meta.js';

describe('getChannelMeta', () => {
  it('returns metadata for known channel types', () => {
    const telegram = getChannelMeta('telegram');
    expect(telegram.channelType).toBe('telegram');
    expect(telegram.displayName).toBe('Telegram');
    expect(telegram.iconId).toBe('telegram');
    expect(telegram.capabilities.supportsEditing).toBe(true);
    expect(telegram.capabilities.supportsTypingIndicator).toBe(true);
  });

  it('returns metadata for web channel', () => {
    const web = getChannelMeta('web');
    expect(web.channelType).toBe('web');
    expect(web.displayName).toBe('Web');
    expect(web.iconId).toBe('web');
    expect(web.capabilities.supportsEditing).toBe(false);
    expect(web.capabilities.supportsAttachments).toBe(true);
  });

  it('returns metadata for slack channel', () => {
    const slack = getChannelMeta('slack');
    expect(slack.channelType).toBe('slack');
    expect(slack.displayName).toBe('Slack');
    expect(slack.capabilities.supportsThreads).toBe(true);
    expect(slack.capabilities.supportsEditing).toBe(true);
  });

  it('returns metadata for github channel', () => {
    const github = getChannelMeta('github');
    expect(github.channelType).toBe('github');
    expect(github.displayName).toBe('GitHub');
    expect(github.capabilities.supportsThreads).toBe(true);
    expect(github.capabilities.supportsAttachments).toBe(false);
  });

  it('returns metadata for api channel', () => {
    const api = getChannelMeta('api');
    expect(api.channelType).toBe('api');
    expect(api.displayName).toBe('API');
    expect(api.capabilities.supportsEditing).toBe(false);
  });

  it('returns generic fallback for unknown channel types', () => {
    const unknown = getChannelMeta('discord');
    expect(unknown.channelType).toBe('discord');
    expect(unknown.displayName).toBe('Discord');
    expect(unknown.iconId).toBe('generic');
    expect(unknown.capabilities.supportsEditing).toBe(false);
    expect(unknown.capabilities.supportsDeleting).toBe(false);
    expect(unknown.capabilities.supportsThreads).toBe(false);
    expect(unknown.capabilities.supportsTypingIndicator).toBe(false);
    expect(unknown.capabilities.supportsAttachments).toBe(false);
  });

  it('capitalizes first letter for unknown channel display name', () => {
    expect(getChannelMeta('whatsapp').displayName).toBe('Whatsapp');
    expect(getChannelMeta('sms').displayName).toBe('Sms');
  });
});

describe('listChannelMeta', () => {
  it('returns all known channels', () => {
    const all = listChannelMeta();
    expect(all.length).toBeGreaterThanOrEqual(5);

    const types = all.map((m) => m.channelType);
    expect(types).toContain('web');
    expect(types).toContain('telegram');
    expect(types).toContain('slack');
    expect(types).toContain('github');
    expect(types).toContain('api');
  });

  it('returns a new array each time (not mutable reference)', () => {
    const a = listChannelMeta();
    const b = listChannelMeta();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('formatChannelLabel', () => {
  it('returns "Web" for web channel', () => {
    expect(formatChannelLabel('web', 'default')).toBe('Web');
    expect(formatChannelLabel('web', 'anything')).toBe('Web');
  });

  it('returns "Slack" for slack with default channelId', () => {
    expect(formatChannelLabel('slack', 'default')).toBe('Slack');
  });

  it('returns "Slack #channel" for slack with specific channelId', () => {
    expect(formatChannelLabel('slack', 'general')).toBe('Slack #general');
  });

  it('returns "Telegram" for telegram channel', () => {
    expect(formatChannelLabel('telegram', 'default')).toBe('Telegram');
    expect(formatChannelLabel('telegram', '12345')).toBe('Telegram');
  });

  it('returns display name for known channel with default id', () => {
    expect(formatChannelLabel('github', 'default')).toBe('GitHub');
    expect(formatChannelLabel('api', 'default')).toBe('API');
  });

  it('returns capitalized name for unknown channel types', () => {
    expect(formatChannelLabel('discord', 'default')).toBe('Discord');
  });
});
