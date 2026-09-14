import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
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
    this.drizzle = drizzle(this.sqlite, { schema });
    this.applyMigrations();
    this.ensureCompatibleColumns();
    this.sqlite.exec(`INSERT OR IGNORE INTO units (name) VALUES ('kg'), ('g')`);
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

  private applyMigrations(): void {
    const migrationsFolder = join(__dirname, 'migrations');
    this.stampLegacySchema(migrationsFolder);
    this.sqlite.pragma('foreign_keys = OFF');
    try {
      migrate(this.drizzle, { migrationsFolder });
    } finally {
      this.sqlite.pragma('foreign_keys = ON');
    }
  }

  /** Existing DBs already have tables; record the baseline as applied so later migrations still run. */
  private stampLegacySchema(migrationsFolder: string): void {
    if (!this.tableExists('units')) return;
    if (this.migrationCount() > 0) return;
    const first = readMigrationFiles({ migrationsFolder })[0];
    if (!first) return;
    this.sqlite.exec(
      `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )`,
    );
    this.sqlite
      .prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
      .run(first.hash, first.folderMillis);
  }

  private tableExists(name: string): boolean {
    const row = this.sqlite.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`).get(name) as
      | { ok: number }
      | undefined;
    return Boolean(row);
  }

  private migrationCount(): number {
    if (!this.tableExists('__drizzle_migrations')) return 0;
    const row = this.sqlite.prepare(`SELECT COUNT(*) AS n FROM "__drizzle_migrations"`).get() as { n: number };
    return Number(row.n);
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
