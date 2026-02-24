import { sqliteTable, text, real, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const orchestratorIdentities = sqliteTable('orchestrator_identities', {
  id: text().primaryKey(),
  userId: text(),
  orgId: text().notNull().default('default'),
  type: text().notNull().default('personal'),
  name: text().notNull().default('Agent'),
  handle: text().notNull(),
  avatar: text(),
  customInstructions: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_orch_identity_handle').on(table.orgId, table.handle),
  uniqueIndex('idx_orch_identity_user').on(table.orgId, table.userId),
]);

// Note: orchestrator_memories_fts is an FTS5 virtual table and cannot be represented in Drizzle schema.
// FTS5 queries must use raw SQL via d1.prepare().
export const orchestratorMemories = sqliteTable('orchestrator_memories', {
  id: text().primaryKey(),
  userId: text().notNull(),
  orgId: text().notNull().default('default'),
  category: text().notNull(),
  content: text().notNull(),
  relevance: real().notNull().default(1.0),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  lastAccessedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_orch_memories_user').on(table.userId),
  index('idx_orch_memories_category').on(table.userId, table.category),
]);
