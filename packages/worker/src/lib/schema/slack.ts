import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const orgSlackInstalls = sqliteTable('org_slack_installs', {
  id: text().primaryKey(),
  teamId: text().notNull().unique(),
  teamName: text(),
  botUserId: text().notNull(),
  appId: text(),
  encryptedBotToken: text().notNull(),
  encryptedSigningSecret: text(),
  installedBy: text().notNull().references(() => users.id),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_org_slack_installs_team').on(table.teamId),
]);

export const slackBotThreads = sqliteTable('slack_bot_threads', {
  id: text().primaryKey(),
  teamId: text('team_id').notNull(),
  channelId: text('channel_id').notNull(),
  threadTs: text('thread_ts').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_slack_bot_threads_unique').on(table.teamId, table.channelId, table.threadTs),
  index('idx_slack_bot_threads_lookup').on(table.teamId, table.channelId, table.threadTs),
]);

export const slackLinkVerifications = sqliteTable('slack_link_verifications', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id),
  slackUserId: text().notNull(),
  slackDisplayName: text(),
  code: text().notNull(),
  expiresAt: text().notNull(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_slack_link_verifications_user').on(table.userId),
]);
