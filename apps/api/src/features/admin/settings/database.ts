import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../../../db/schema.js';

export const DATABASE = 'database';

export type Database = BetterSQLite3Database<typeof schema>;
