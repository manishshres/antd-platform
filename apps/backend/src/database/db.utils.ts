import { SQL, isNull, and } from 'drizzle-orm';
import { AnyPgColumn } from 'drizzle-orm/pg-core';

export interface SoftDeletableTable {
  deletedAt: AnyPgColumn;
}

/**
 * Global soft-delete query wrapper to prevent data leaks.
 *
 * Safely combines an existing SQL condition with a check ensuring the record
 * has not been soft-deleted (deletedAt IS NULL).
 *
 * @param table - The Drizzle schema table with a deletedAt column.
 * @param condition - The existing condition (optional).
 * @returns A combined SQL condition.
 */
export function notDeleted(table: SoftDeletableTable, condition?: SQL): SQL {
  const activeCondition = isNull(table.deletedAt);
  return condition ? and(condition, activeCondition)! : activeCondition;
}
