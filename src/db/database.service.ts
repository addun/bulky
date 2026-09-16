import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
    this.sqlite.exec(`DROP TABLE IF EXISTS goose_db_version`);
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
    this.sqlite.pragma('foreign_keys = OFF');
    try {
      migrate(this.drizzle, { migrationsFolder });
    } finally {
      this.sqlite.pragma('foreign_keys = ON');
    }
    this.repairDrizzleMigrationsTable();
  }

  /**
   * drizzle-orm 0.44 still creates this table with Postgres `SERIAL`, so SQLite
   * stores id as NULL. Rebuild it as INTEGER PRIMARY KEY after migrate().
   */
  private repairDrizzleMigrationsTable(): void {
    const exists = this.sqlite
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
      .get() as { ok: number } | undefined;
    if (!exists) return;

    const cols = this.sqlite.prepare(`PRAGMA table_info("__drizzle_migrations")`).all() as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    const idCol = cols.find((c) => c.name === 'id');
    const integerPk = Boolean(idCol && idCol.type.toLowerCase() === 'integer' && idCol.pk === 1);
    const nullIds = (this.sqlite.prepare(`SELECT COUNT(*) AS n FROM "__drizzle_migrations" WHERE id IS NULL`).get() as { n: number })
      .n;
    if (integerPk && Number(nullIds) === 0) return;

    const rebuild = this.sqlite.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE "__drizzle_migrations_new" (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          hash text NOT NULL,
          created_at numeric
        );
        INSERT INTO "__drizzle_migrations_new" (hash, created_at)
        SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at ASC;
        DROP TABLE "__drizzle_migrations";
        ALTER TABLE "__drizzle_migrations_new" RENAME TO "__drizzle_migrations";
      `);
    });
    rebuild();
  }
}
