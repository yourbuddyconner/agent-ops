import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const personaTools = sqliteTable('persona_tools', {
  id: text().primaryKey(),
  personaId: text().notNull(),
  service: text().notNull(),
  actionId: text(),
  enabled: integer().notNull().default(1),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_persona_tools_unique').on(table.personaId, table.service, table.actionId),
  index('idx_persona_tools_persona').on(table.personaId),
]);
