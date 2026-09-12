import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly sqlite: Database.Database;
  readonly drizzle: BetterSQLite3Database<typeof schema>;
  readonly dataDir: string;
  readonly imagesDir: string;

  constructor(config: ConfigService) {
    this.dataDir = resolve(config.get<string>('DATA_DIR') || './data');
    this.imagesDir = join(this.dataDir, 'images');
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.imagesDir, { recursive: true });
    mkdirSync(join(this.dataDir, 'ocr'), { recursive: true });

    const dbPath = join(this.dataDir, 'bulkly.db');
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
    this.sqlite.pragma('journal_mode = WAL');
    this.ensureSchema();
    this.ensureCompatibleColumns();
    this.drizzle = drizzle(this.sqlite, { schema });
  }

  imagesDirPath(): string {
    return this.imagesDir;
  }

  dataDirPath(): string {
    return this.dataDir;
  }

  immediate<T>(fn: () => T): T {
    const trx = this.sqlite.transaction(fn);
    return trx.immediate();
  }

  onModuleDestroy(): void {
    this.sqlite.close();
  }

  private ensureSchema(): void {
    const row = this.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='units'`).get() as
      | { name: string }
      | undefined;
    if (row) return;
    const sqlPath = join(__dirname, 'schema.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    this.sqlite.exec(sql);
    this.sqlite.exec(`INSERT OR IGNORE INTO units (name) VALUES ('kg'), ('g')`);
  }

  /** Additive columns for DBs created before later Go migrations. Does not replay goose. */
  private ensureCompatibleColumns(): void {
    this.addColumnIfMissing('receipts', 'source', `TEXT NOT NULL DEFAULT ''`);
    this.addColumnIfMissing('receipts', 'external_id', `TEXT NOT NULL DEFAULT ''`);
    this.addColumnIfMissing('receipts', 'source_payload', `TEXT NOT NULL DEFAULT ''`);
    this.sqlite.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_source_external
       ON receipts(source, external_id)
       WHERE source != '' AND external_id != ''`,
    );
  }

  private addColumnIfMissing(table: string, column: string, spec: string): void {
    const cols = this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === column)) return;
    this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }
}
