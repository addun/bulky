import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function nocaseEq(column: SQLWrapper, value: string): SQL {
  return sql`${column} = ${value} collate nocase`;
}

export function nocaseOrder(column: SQLWrapper): SQL {
  return sql`${column} collate nocase`;
}

export function int0(column: SQLWrapper): SQL<number> {
  return sql<number>`coalesce(${column}, 0)`.mapWith(Number);
}

export function emptyStr(column: SQLWrapper): SQL<string> {
  return sql<string>`coalesce(${column}, '')`.mapWith(String);
}

export function lastId(row: { lastInsertRowid: number | bigint }): number {
  return Number(row.lastInsertRowid);
}

export function changesOf(row: { changes: number }): number {
  return row.changes;
}

export function countOf(n: number | bigint | null | undefined): number {
  return Number(n ?? 0);
}
