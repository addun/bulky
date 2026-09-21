import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function nocaseEq(column: SQLWrapper, value: string): SQL {
  return sql`${column} = ${value} collate nocase`;
}

/** Case-insensitive equality after stripping spaces from the column and the value. */
export function nocaseCompactEq(column: SQLWrapper, value: string): SQL {
  const compact = value.replace(/\s+/gu, '');
  return sql`replace(replace(replace(replace(replace(${column}, ${'\u00a0'}, ''), ${'\t'}, ''), ${'\n'}, ''), ${'\r'}, ''), ' ', '') = ${compact} collate nocase`;
}

export function nocaseOrder(column: SQLWrapper): SQL {
  return sql`${column} collate nocase`;
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
