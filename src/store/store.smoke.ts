import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { Decimal } from 'decimal.js';
import { DatabaseService } from '../db/database.service.js';
import { DuplicateError, NotFoundError } from '../domain/errors.js';
import {
  AliasesRepository,
  ComparisonGroupsRepository,
  KIND_PURCHASE,
  LocationsRepository,
  ProductsRepository,
  PurchasesRepository,
  ReceiptsRepository,
  UnitsRepository,
} from '#app/store';

function createStore(db: DatabaseService) {
  const units = new UnitsRepository(db);
  const locations = new LocationsRepository(db);
  const aliases = new AliasesRepository(db, locations);
  const purchases = new PurchasesRepository(db, locations);
  const groups = new ComparisonGroupsRepository(db, units, purchases);
  const products = new ProductsRepository(db, units, aliases, purchases, groups, locations);
  const receipts = new ReceiptsRepository(db, products, aliases, purchases, locations);
  return { units, locations, aliases, purchases, groups, products, receipts };
}

function assertMigrationCleanup(db: DatabaseService): void {
  const goose = db.sqlite
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='goose_db_version'`)
    .get();
  if (goose) throw new Error('goose_db_version should be dropped');

  const idCol = (db.sqlite.prepare(`PRAGMA table_info("__drizzle_migrations")`).all() as Array<{ name: string; type: string }>).find(
    (c) => c.name === 'id',
  );
  if (!idCol || idCol.type.toLowerCase() !== 'integer') throw new Error(`drizzle id type: ${idCol?.type}`);

  const rows = db.sqlite.prepare(`SELECT id FROM "__drizzle_migrations" ORDER BY created_at`).all() as Array<{ id: number | null }>;
  if (rows.length !== 2 || rows[0]!.id !== 1 || rows[1]!.id !== 2) {
    throw new Error(`drizzle ids: ${JSON.stringify(rows)}`);
  }
}

function runStoreSmoke(): void {
  const dir = mkdtempSync(join(tmpdir(), 'bulkly-drizzle-'));
  const leftover = new Database(join(dir, 'bulkly.db'));
  leftover.exec(`
    CREATE TABLE goose_db_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL,
      is_applied INTEGER NOT NULL,
      tstamp TIMESTAMP DEFAULT (datetime('now'))
    );
    INSERT INTO goose_db_version (version_id, is_applied) VALUES (19, 1);
  `);
  leftover.close();
  const db = new DatabaseService(new ConfigService({ DATA_DIR: dir }));
  try {
    assertMigrationCleanup(db);
    const store = createStore(db);
    store.units.createUnit('kg');
    store.units.createUnit('g');
    const kg = store.units.findUnitByName('KG');
    const g = store.units.findUnitByName('g');
    if (kg.name !== 'kg') throw new Error(`expected kg, got ${kg.name}`);

    const chain = store.locations.createRetailChain('Biedronka', 'Jerónimo Martins', '1234567890');
    const story = store.locations.createStory('Katowice', 'Kosciuszki', '10', '', '40-001', 'Katowice', '2615', chain.id);
    if (story.retailChainName !== 'Biedronka') throw new Error('story chain join');

    const flour = store.products.createProduct(
      'Maka',
      kg.id,
      null,
      [{ unitId: g.id, unitName: 'g', factor: new Decimal(1000) }],
    );
    store.purchases.createPurchase(flour.id, story.id, '2026-01-15 12:00', new Decimal('2.5'), new Decimal('12.50'), KIND_PURCHASE);
    store.aliases.createAlias(flour.id, story.id, null, 'Maka Tortowa');

    const found = store.products.findProductByName('maka', null);
    if (found.id !== flour.id) throw new Error('nocase product lookup');
    const byAlias = store.products.findProductByName('maka tortowa', story.id);
    if (byAlias.id !== flour.id) throw new Error('alias lookup');

    const items = store.products.listProducts('');
    if (items.length !== 1 || items[0]!.purchaseCount !== 1) throw new Error('product list stats');
    if (!items[0]!.quote) throw new Error('quote missing');

    const group = store.groups.createComparisonGroup('Flour', kg.id, [flour.id]);
    if (group.productCount !== 1) throw new Error('group count');
    const rice = store.products.createProduct('Ryz', kg.id, null);
    store.purchases.createPurchase(rice.id, story.id, '2026-01-20 12:00', new Decimal('1'), new Decimal('8'), KIND_PURCHASE);
    store.groups.updateComparisonGroup(group.id, 'Flour', kg.id, [flour.id, rice.id]);
    const related = store.groups.relatedGroupProducts(flour.id, new Date());
    if (related.length !== 1 || related[0]!.id !== rice.id) throw new Error('related group products');
    const leaders = store.groups.comparisonLeaders(flour.id);
    if (leaders.length !== 1 || !leaders[0]!.leader) throw new Error('comparison leaders');

    const merged = store.products.mergeProducts(flour.id, rice.id);
    if (merged.keeper.id !== flour.id) throw new Error('merge keeper');
    if (store.purchases.listPurchases(flour.id).length !== 2) throw new Error('merge purchases');

    store.units.setSetting('ocr_model', 'vision');
    if (store.units.ocrModel() !== 'vision') throw new Error('settings upsert');

    const pending = store.receipts.createReceipt('pending.jpg');
    const pendingRow = store.receipts.listReceipts().find((r) => r.id === pending.id);
    if (!pendingRow || pendingRow.boughtOn !== '' || pendingRow.shopName !== '') throw new Error('pending list extras');
    store.receipts.deleteReceipt(pending.id);

    const receipt = store.receipts.createReceipt('bill.jpg');
    store.receipts.saveAIResponse(
      receipt.id,
      JSON.stringify({ bought_on: '2026-03-01', company_name: 'Biedronka', company_id: story.id }),
    );
    if (store.receipts.latestSourcedBoughtOn('ocr') !== '2026-03-01') throw new Error('json extract');
    const receiptRow = store.receipts.listReceipts().find((r) => r.id === receipt.id);
    if (!receiptRow) throw new Error('list missing receipt');
    if (receiptRow.boughtOn !== '2026-03-01') throw new Error('list boughtOn');
    if (receiptRow.shopName !== story.name) throw new Error('list shopName');
    store.receipts.deleteReceipt(receipt.id);
    try {
      store.receipts.getReceipt(receipt.id);
      throw new Error('deleted receipt should be gone');
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    const named = store.receipts.createReceipt('named.jpg');
    store.receipts.saveAIResponse(named.id, JSON.stringify({ bought_on: '2026-03-02', company_name: 'Lidl' }));
    const namedRow = store.receipts.listReceipts().find((r) => r.id === named.id);
    if (!namedRow || namedRow.boughtOn !== '2026-03-02' || namedRow.shopName !== 'Lidl') {
      throw new Error('list company_name');
    }
    store.receipts.deleteReceipt(named.id);

    const only = store.receipts.createReceipt('only.jpg');
    store.receipts.saveAIResponse(only.id, '{}');
    const onlyRes = store.receipts.migrateReceipt(only.id, {
      storyId: story.id,
      story: null,
      receiptId: only.id,
      boughtOn: '2026-04-01 12:00',
      lines: [
        {
          productId: 0,
          productName: 'Chleb',
          receiptName: 'CHLEB',
          unitId: kg.id,
          quantity: new Decimal(1),
          amount: new Decimal('4.50'),
          ean: '',
        },
      ],
    }, '{}');
    const breadId = onlyRes.productIds[0]!;
    store.receipts.deleteReceipt(only.id);
    try {
      store.products.getProduct(breadId);
      throw new Error('orphan product should be gone');
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    const keep = store.receipts.createReceipt('keep.jpg');
    store.receipts.saveAIResponse(keep.id, '{}');
    store.receipts.migrateReceipt(keep.id, {
      storyId: story.id,
      story: null,
      receiptId: keep.id,
      boughtOn: '2026-04-02 12:00',
      lines: [
        {
          productId: flour.id,
          productName: 'Maka',
          receiptName: 'MAKA',
          unitId: kg.id,
          quantity: new Decimal(1),
          amount: new Decimal('5'),
          ean: '',
        },
      ],
    }, '{}');
    if (store.purchases.listPurchases(flour.id).length !== 3) throw new Error('receipt purchase missing');
    store.receipts.deleteReceipt(keep.id);
    if (store.purchases.listPurchases(flour.id).length !== 2) throw new Error('shared product purchases');
    store.products.getProduct(flour.id);

    try {
      store.units.createUnit('kg');
      throw new Error('duplicate unit should fail');
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
    }

    const listed = store.units.listUnits();
    const kgRow = listed.find((u) => u.name === 'kg');
    if (!kgRow || kgRow.productCount < 1) throw new Error('unit use count');

    const milk = store.products.insertImported('Mleko', kg.id, '5900000000001');
    if (milk.ean !== '5900000000001') throw new Error('imported ean');
    store.products.applyImportedEan(milk.id, '5900000000002');
    if (store.products.getProduct(milk.id).ean !== '5900000000002') throw new Error('update ean');
    store.products.applyImportedEan(milk.id, '');
    if (store.products.getProduct(milk.id).ean !== '5900000000002') throw new Error('empty ean must not clear');
  } finally {
    db.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  }
}

function runDrizzleIdRepairSmoke(): void {
  const dir = mkdtempSync(join(tmpdir(), 'bulkly-drizzle-repair-'));
  const first = new DatabaseService(new ConfigService({ DATA_DIR: dir }));
  first.onModuleDestroy();

  const raw = new Database(join(dir, 'bulkly.db'));
  raw.exec(`
    CREATE TABLE "__drizzle_migrations_broken" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
    INSERT INTO "__drizzle_migrations_broken" (hash, created_at)
    SELECT hash, created_at FROM "__drizzle_migrations";
    DROP TABLE "__drizzle_migrations";
    ALTER TABLE "__drizzle_migrations_broken" RENAME TO "__drizzle_migrations";
  `);
  const broken = raw.prepare(`SELECT id FROM "__drizzle_migrations"`).all() as Array<{ id: number | null }>;
  if (broken.some((row) => row.id != null)) throw new Error(`expected null drizzle ids, got ${JSON.stringify(broken)}`);
  raw.close();

  const db = new DatabaseService(new ConfigService({ DATA_DIR: dir }));
  try {
    assertMigrationCleanup(db);
  } finally {
    db.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  runStoreSmoke();
  runDrizzleIdRepairSmoke();
  console.log('store smoke ok');
}
