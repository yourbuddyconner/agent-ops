import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/**
 * Widened database type that accepts both D1 (production) and
 * better-sqlite3 (tests). Uses the base SQLite database type
 * so Drizzle query builder methods are compatible across both.
 */
export type AppDb = BaseSQLiteDatabase<any, any, any>;

/** Create a Drizzle instance from a D1 binding (production path). */
export function getDb(d1: D1Database): DrizzleD1Database {
  return drizzle(d1, { casing: 'snake_case' });
}

export function toDate(value: string | null | undefined): Date {
  return new Date(value ?? 0);
}
