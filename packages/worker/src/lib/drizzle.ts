import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export type AppDb = DrizzleD1Database;

export function getDb(d1: D1Database): AppDb {
  return drizzle(d1, { casing: 'snake_case' });
}

export function toDate(value: string | null | undefined): Date {
  return new Date(value ?? 0);
}
