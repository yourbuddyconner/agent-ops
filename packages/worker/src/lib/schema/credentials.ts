import { sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const credentials = sqliteTable('credentials', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text().notNull(),
  credentialType: text().notNull(),
  encryptedData: text().notNull(),
  scopes: text(),
  expiresAt: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_credentials_user_provider').on(table.userId, table.provider),
  index('idx_credentials_user').on(table.userId),
  index('idx_credentials_provider').on(table.provider),
]);
