import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  name: text(),
  avatarUrl: text(),
  githubId: text(),
  githubUsername: text(),
  gitName: text(),
  gitEmail: text(),
  onboardingCompleted: integer({ mode: 'boolean' }).default(false),
  idleTimeoutSeconds: integer().default(900),
  role: text().notNull().default('member'),
  modelPreferences: text({ mode: 'json' }).$type<string[]>(),
  discoveredModels: text({ mode: 'json' }),
  maxActiveSessions: integer(),
  uiQueueMode: text().default('followup'),
  createdAt: text().default(sql`(datetime('now'))`),
  updatedAt: text().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_users_github_id').on(table.githubId),
]);

export const apiTokens = sqliteTable('api_tokens', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  tokenHash: text().notNull().unique(),
  prefix: text(),
  scopes: text().default('[]'),
  lastUsedAt: text(),
  expiresAt: text(),
  revokedAt: text(),
  createdAt: text().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_api_tokens_user').on(table.userId),
  index('idx_api_tokens_hash').on(table.tokenHash),
  index('idx_api_tokens_prefix').on(table.prefix),
]);

export const authSessions = sqliteTable('auth_sessions', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text().notNull().unique(),
  provider: text().notNull(),
  expiresAt: text().notNull(),
  createdAt: text().default(sql`(datetime('now'))`),
  lastUsedAt: text(),
}, (table) => [
  index('idx_auth_sessions_token').on(table.tokenHash),
]);

export const oauthTokens = sqliteTable('oauth_tokens', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text().notNull(),
  encryptedAccessToken: text().notNull(),
  encryptedRefreshToken: text(),
  scopes: text(),
  expiresAt: text(),
  createdAt: text().default(sql`(datetime('now'))`),
  updatedAt: text().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_oauth_tokens_user_provider').on(table.userId, table.provider),
]);

export const userCredentials = sqliteTable('user_credentials', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text().notNull(),
  encryptedKey: text().notNull(),
  createdAt: text().default(sql`(datetime('now'))`),
  updatedAt: text().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_user_credentials_unique').on(table.userId, table.provider),
  index('idx_user_credentials_user').on(table.userId),
]);
