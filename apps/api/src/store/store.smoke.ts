import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { Decimal } from 'decimal.js';
import { DatabaseService } from '../db/database.service.js';
import { DuplicateError, NotFoundError, SameStoreError } from '../domain/errors.js';
import { importedShopsFromBiedronka, shopsFromBiedronka } from '../imports/biedronka-shops.js';
import {
  AliasesRepository,
  ComparisonGroupsRepository,
  KIND_PURCHASE,
  LocationsRepository,
  ProductsRepository,
  PurchasesRepository,
  ReceiptsRepository,
  SettingsRepository,
  UnitsRepository,
} from '#app/store';

function createStore(db: DatabaseService) {
  const settings = new SettingsRepository(db);
  const units = new UnitsRepository(db, settings);
  const locations = new LocationsRepository(db);
  const aliases = new AliasesRepository(db, locations);
  const purchases = new PurchasesRepository(db, locations);
  const groups = new ComparisonGroupsRepository(db, units, purchases);
  const products = new ProductsRepository(db, units, aliases, purchases, groups, locations);
  const receipts = new ReceiptsRepository(db, products, aliases, purchases, locations);
  return { units, locations, aliases, purchases, groups, products, receipts, settings };
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
  if (
    rows.length !== 8 ||
    rows[0]!.id !== 1 ||
    rows[1]!.id !== 2 ||
    rows[2]!.id !== 3 ||
    rows[3]!.id !== 4 ||
    rows[4]!.id !== 5 ||
    rows[5]!.id !== 6 ||
    rows[6]!.id !== 7 ||
    rows[7]!.id !== 8
  ) {
    throw new Error(`drizzle ids: ${JSON.stringify(rows)}`);
  }
  const amountCol = (db.sqlite.prepare(`PRAGMA table_info("purchases")`).all() as Array<{ name: string; type: string }>).find(
    (c) => c.name === 'amount',
  );
  if (!amountCol || amountCol.type.toLowerCase() !== 'integer') throw new Error(`purchase amount type: ${amountCol?.type}`);
  const receiptCols = (db.sqlite.prepare(`PRAGMA table_info("receipts")`).all() as Array<{ name: string }>).map((c) => c.name);
  if (receiptCols.includes('source_payload')) throw new Error('source_payload should be dropped');
  if (!receiptCols.includes('raw_response')) throw new Error('raw_response should remain');
}

function applyAliasStripMigration(db: DatabaseService): void {
  const sql = readFileSync(join(import.meta.dirname, '../db/migrations/0004_alias_strip_spaces.sql'), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed !== '') db.sqlite.exec(trimmed);
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
    const repos = createStore(db);
    repos.units.createUnit('kg');
    repos.units.createUnit('g');
    const kg = repos.units.findUnitByName('KG');
    const g = repos.units.findUnitByName('g');
    if (kg.name !== 'kg') throw new Error(`expected kg, got ${kg.name}`);

    const chain = repos.locations.createRetailChain('Biedronka', 'Jerónimo Martins', '1234567890');
    const store = repos.locations.createStore(
      'Katowice',
      'Kosciuszki',
      '10',
      '',
      '40-001',
      'Katowice',
      '2615',
      chain.id,
      50.88258,
      18.688478,
    );
    if (store.retailChainName !== 'Biedronka') throw new Error('store chain join');
    if (repos.locations.getRetailChain(chain.id).storeCount !== 1) throw new Error('chain store count');
    if (store.lat == null || store.lng == null || Math.abs(store.lat - 50.88258) > 1e-9 || Math.abs(store.lng - 18.688478) > 1e-9) {
      throw new Error(`store coords: ${store.lat}, ${store.lng}`);
    }
    repos.locations.updateStore(
      store.id,
      store.name,
      store.streetName,
      store.buildingNumber,
      store.apartmentNumber,
      store.postalCode,
      store.city,
      store.externalId,
      store.retailChainId,
      null,
      null,
    );
    const cleared = repos.locations.getStore(store.id);
    if (cleared.lat !== null || cleared.lng !== null) throw new Error('store coords cleared');

    try {
      shopsFromBiedronka({ success: true, data: [{ name: 'X' }] });
      throw new Error('invalid biedronka shops should fail');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('unexpected shape')) throw err;
    }
    const shops = shopsFromBiedronka({
      success: true,
      data: [
        {
          name: 'Rzeszów Hetmańska 56',
          searchName: 'Rzeszów, Hetmańska 56',
          city: 'Rzeszów',
          street: 'Hetmańska',
          streetNr: '56',
          hours: '05:00-00:00',
          hoursSat: '00:00-23:30',
          hoursSun: '08:00-22:00',
          lat: 50.0194847,
          lng: 21.9941132,
          shopNr: 2089,
        },
        {
          name: '',
          searchName: ',  ',
          city: null,
          street: null,
          streetNr: null,
          hours: 'Zamknięte',
          hoursSat: 'Zamknięte',
          hoursSun: 'Zamknięte',
          lat: null,
          lng: null,
          shopNr: 1023,
        },
      ],
    });
    const imported = importedShopsFromBiedronka(shops);
    if (imported.length !== 1 || imported[0]!.externalId !== '2089') throw new Error('biedronka shop skip');

    const firstImport = repos.locations.upsertImportedStores(chain.id, [
      {
        name: 'Katowice',
        streetName: 'Kosciuszki',
        buildingNumber: '10',
        city: 'Katowice',
        externalId: '2615',
        lat: 50.88258,
        lng: 18.688478,
      },
      {
        name: 'Rzeszów Hetmańska 56',
        streetName: 'Hetmańska',
        buildingNumber: '56',
        city: 'Rzeszów',
        externalId: '2089',
        lat: 50.0194847,
        lng: 21.9941132,
      },
    ]);
    if (firstImport.created !== 1 || firstImport.updated !== 1) {
      throw new Error(`store import counts: ${firstImport.created} ${firstImport.updated}`);
    }
    const updatedKatowice = repos.locations.getStore(store.id);
    if (updatedKatowice.postalCode !== '40-001') throw new Error('import kept postal');
    if (updatedKatowice.lat == null || Math.abs(updatedKatowice.lat - 50.88258) > 1e-9) throw new Error('import restored coords');
    if (updatedKatowice.name !== 'Katowice') throw new Error('import kept name');
    const rzeszow = repos.locations.listStores().find((s) => s.externalId === '2089');
    if (!rzeszow || rzeszow.city !== 'Rzeszów') throw new Error('import created shop');
    if (repos.locations.getRetailChain(chain.id).storeCount !== 2) throw new Error('chain store count after import');

    const unnamed = repos.locations.createStore('Old Lidl', 'Hetmańska', '56', '2', '35-001', 'Rzeszów', '', chain.id);
    const addrImport = repos.locations.upsertImportedStores(chain.id, [
      {
        name: 'Rzeszów Hetmańska 56',
        streetName: 'Hetmańska',
        buildingNumber: '56',
        city: 'Rzeszów',
        externalId: '2089',
        lat: 50.0194847,
        lng: 21.9941132,
      },
    ]);
    if (addrImport.created !== 0 || addrImport.updated !== 1) throw new Error('import matched shop number first');
    if (repos.locations.getStore(unnamed.id).externalId !== '') throw new Error('import must not steal addressed store with different shop number');

    const orphan = repos.locations.createStore('Old Warsaw', 'Marszałkowska', '1', '', '00-001', 'Warszawa', '', chain.id);
    const orphanImport = repos.locations.upsertImportedStores(chain.id, [
      {
        name: 'Warszawa Marszałkowska 1',
        streetName: 'Marszałkowska',
        buildingNumber: '1',
        city: 'Warszawa',
        externalId: '7777',
        lat: 52.2297,
        lng: 21.0122,
      },
    ]);
    if (orphanImport.created !== 0 || orphanImport.updated !== 1) throw new Error('import matched empty shop number by address');
    const linked = repos.locations.getStore(orphan.id);
    if (linked.externalId !== '7777' || linked.postalCode !== '00-001' || linked.name !== 'Warszawa Marszałkowska 1') {
      throw new Error('import address match');
    }


    const flour = repos.products.createProduct(
      'Maka',
      kg.id,
      null,
      [{ unitId: g.id, unitName: 'g', compareValue: new Decimal(1), factor: new Decimal(1000) }],
    );
    const flourBuy = repos.purchases.createPurchase(flour.id, store.id, '2026-01-15 12:00', new Decimal('2.5'), new Decimal('12.50'), KIND_PURCHASE);
    const storedAmount = db.sqlite.prepare(`SELECT amount, typeof(amount) AS t FROM purchases WHERE id = ?`).get(flourBuy.id) as {
      amount: number;
      t: string;
    };
    if (storedAmount.amount !== 1250 || storedAmount.t !== 'integer') {
      throw new Error(`stored amount: ${storedAmount.amount} ${storedAmount.t}`);
    }
    if (!flourBuy.amount.eq('12.50')) throw new Error(`loaded amount: ${flourBuy.amount.toString()}`);
    const flourAlias = repos.aliases.createAlias(flour.id, store.id, null, 'Maka Tortowa');
    if (flourAlias.alias !== 'MakaTortowa') throw new Error(`alias stored with spaces: ${flourAlias.alias}`);

    const found = repos.products.findProductByName('maka', null);
    if (found.id !== flour.id) throw new Error('nocase product lookup');
    const byAlias = repos.products.findProductByName('maka tortowa', store.id);
    if (byAlias.id !== flour.id) throw new Error('alias lookup');
    const byAliasTight = repos.products.findProductByName('makatortowa', store.id);
    if (byAliasTight.id !== flour.id) throw new Error('alias lookup without spaces');
    const byAliasExtra = repos.products.findProductByName('maka  tortowa', store.id);
    if (byAliasExtra.id !== flour.id) throw new Error('alias lookup extra spaces');
    try {
      repos.aliases.createAlias(flour.id, store.id, null, 'Maka  Tortowa');
      throw new Error('spaced alias should be duplicate');
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
    }
    try {
      repos.products.createProduct('Maka Tortowa', kg.id, null);
      throw new Error('product name matching compacted alias');
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
    }

    const oats = repos.products.createProduct('Oats', kg.id, null);
    const insertAlias = db.sqlite.prepare(
      `INSERT INTO product_aliases (product_id, store_id, retail_chain_id, alias) VALUES (?, ?, NULL, ?)`,
    );
    insertAlias.run(oats.id, store.id, 'Foo Bar');
    insertAlias.run(oats.id, store.id, 'Foo  Bar');
    insertAlias.run(oats.id, store.id, 'FooBar');
    insertAlias.run(oats.id, store.id, 'Foo\u00a0Bar');
    applyAliasStripMigration(db);
    const oatAliases = repos.aliases.listAliasesByProduct(oats.id).filter((a) => a.storeId === store.id);
    if (oatAliases.length !== 1 || oatAliases[0]!.alias !== 'FooBar') {
      throw new Error(`alias strip migration: ${oatAliases.map((a) => a.alias).join(',')}`);
    }
    if (repos.products.findProductByName('foo bar', store.id).id !== oats.id) throw new Error('alias lookup after strip migration');
    repos.products.deleteProduct(oats.id);

    const items = repos.products.listProducts('');
    if (items.length !== 1 || items[0]!.purchaseCount !== 1 || !items[0]!.lifetimeAmount.eq('12.50')) {
      throw new Error(`product list stats: ${items[0]?.lifetimeAmount.toString()}`);
    }
    if (!items[0]!.quote) throw new Error('quote missing');

    const group = repos.groups.createComparisonGroup('Flour', kg.id, [flour.id]);
    if (group.productCount !== 1) throw new Error('group count');
    const rice = repos.products.createProduct('Ryz', kg.id, null);
    repos.purchases.createPurchase(rice.id, store.id, '2026-01-20 12:00', new Decimal('1'), new Decimal('8'), KIND_PURCHASE);
    const firstPage = repos.products.listProductsPage('', 0, 1);
    const secondPage = repos.products.listProductsPage('', 1, 1);
    if (firstPage.total !== 2 || firstPage.items.length !== 1 || secondPage.items.length !== 1) {
      throw new Error('product list page');
    }
    if (firstPage.items[0]!.id === secondPage.items[0]!.id) throw new Error('product list page overlap');
    const namedPage = repos.products.listProductsPage('ryz', 0, 40);
    if (namedPage.total !== 1 || namedPage.items[0]!.id !== rice.id) throw new Error('product list page search');
    repos.groups.updateComparisonGroup(group.id, 'Flour', kg.id, [flour.id, rice.id]);
    const related = repos.groups.relatedGroupProducts(flour.id, new Date());
    if (related.length !== 1 || related[0]!.id !== rice.id) throw new Error('related group products');
    const leaders = repos.groups.comparisonLeaders(flour.id);
    if (leaders.length !== 1 || !leaders[0]!.leader) throw new Error('comparison leaders');

    const merged = repos.products.mergeProducts(flour.id, rice.id);
    if (merged.keeper.id !== flour.id) throw new Error('merge keeper');
    if (repos.purchases.listPurchases(flour.id).length !== 2) throw new Error('merge purchases');

    repos.settings.setSetting('ocr_model', 'vision');
    if (repos.settings.getSetting('ocr_model') !== 'vision') throw new Error('settings upsert');

    const pending = repos.receipts.createReceipt('pending.jpg');
    const pendingRow = repos.receipts.listReceipts().find((r) => r.id === pending.id);
    if (!pendingRow || pendingRow.boughtOn !== '' || pendingRow.shopName !== '') throw new Error('pending list extras');
    repos.receipts.deleteReceipt(pending.id);

    const receipt = repos.receipts.createReceipt('bill.jpg');
    repos.receipts.saveAIResponse(
      receipt.id,
      JSON.stringify({ bought_on: '2026-03-01', company_name: 'Biedronka', company_id: store.id }),
    );
    if (repos.receipts.latestSourcedBoughtOn('ocr') !== '2026-03-01') throw new Error('json extract');
    const receiptRow = repos.receipts.listReceipts().find((r) => r.id === receipt.id);
    if (!receiptRow) throw new Error('list missing receipt');
    if (receiptRow.boughtOn !== '2026-03-01') throw new Error('list boughtOn');
    if (receiptRow.shopName !== store.name) throw new Error('list shopName');
    repos.receipts.deleteReceipt(receipt.id);
    try {
      repos.receipts.getReceipt(receipt.id);
      throw new Error('deleted receipt should be gone');
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    const named = repos.receipts.createReceipt('named.jpg');
    repos.receipts.saveAIResponse(named.id, JSON.stringify({ bought_on: '2026-03-02', company_name: 'Lidl' }));
    const namedRow = repos.receipts.listReceipts().find((r) => r.id === named.id);
    if (!namedRow || namedRow.boughtOn !== '2026-03-02' || namedRow.shopName !== 'Lidl') {
      throw new Error('list company_name');
    }
    repos.receipts.deleteReceipt(named.id);

    const dupA = repos.receipts.createReceipt('dup-a.jpg');
    const dupB = repos.receipts.createReceipt('dup-b.jpg');
    const dupC = repos.receipts.createReceipt('dup-c.jpg');
    const otherShop = repos.locations.createStore('Other', 'Street', '1', '', '', 'City', 'other-dup', chain.id);
    repos.receipts.saveAIResponse(
      dupA.id,
      JSON.stringify({ bought_on: '2026-05-01', bought_at: '14:32', company_id: store.id, company_name: 'Biedronka' }),
    );
    repos.receipts.saveAIResponse(
      dupB.id,
      JSON.stringify({ bought_on: '2026-05-01 14:32', company_id: store.id, company_name: 'Biedronka' }),
    );
    repos.receipts.saveAIResponse(
      dupC.id,
      JSON.stringify({ bought_on: '2026-05-01', bought_at: '15:00', company_id: store.id, company_name: 'Biedronka' }),
    );
    const dups = repos.receipts.listDuplicateReceipts();
    if (dups.length !== 1) throw new Error(`dup groups: ${dups.length}`);
    if (dups[0]!.receipts.length !== 2) throw new Error('dup count');
    if (dups[0]!.boughtOn !== '2026-05-01 14:32') throw new Error('dup time');
    if (dups[0]!.shopName !== store.name) throw new Error('dup shop');
    if (!dups[0]!.receipts.some((r) => r.id === dupA.id) || !dups[0]!.receipts.some((r) => r.id === dupB.id)) {
      throw new Error('dup members');
    }

    const other = repos.receipts.createReceipt('dup-other.jpg');
    repos.receipts.saveAIResponse(
      other.id,
      JSON.stringify({ bought_on: '2026-05-01', bought_at: '14:32', company_id: otherShop.id }),
    );
    if (repos.receipts.listDuplicateReceipts().length !== 1) throw new Error('other shop should not join');

    const lidlA = repos.receipts.createReceipt('lidl-a.jpg');
    const lidlB = repos.receipts.createReceipt('lidl-b.jpg');
    repos.receipts.saveAIResponse(
      lidlA.id,
      JSON.stringify({ bought_on: '2026-05-02', bought_at: '09:10', company_name: 'Lidl' }),
    );
    repos.receipts.saveAIResponse(
      lidlB.id,
      JSON.stringify({ bought_on: '2026-05-02', bought_at: '09:10', company_name: 'lidl' }),
    );
    if (repos.receipts.listDuplicateReceipts().length !== 2) throw new Error('named dup groups');

    const datelessA = repos.receipts.createReceipt('date-a.jpg');
    const datelessB = repos.receipts.createReceipt('date-b.jpg');
    repos.receipts.saveAIResponse(datelessA.id, JSON.stringify({ bought_on: '2026-05-03', company_name: 'Lidl' }));
    repos.receipts.saveAIResponse(datelessB.id, JSON.stringify({ bought_on: '2026-05-03', company_name: 'Lidl' }));
    if (repos.receipts.listDuplicateReceipts().length !== 2) throw new Error('date-only should not duplicate');

    for (const r of [dupA, dupB, dupC, other, lidlA, lidlB, datelessA, datelessB]) {
      repos.receipts.deleteReceipt(r.id);
    }

    const only = repos.receipts.createReceipt('only.jpg');
    repos.receipts.saveAIResponse(only.id, '{}');
    const onlyRes = repos.receipts.migrateReceipt(only.id, {
      storeId: store.id,
      store: null,
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
    repos.receipts.deleteReceipt(only.id);
    try {
      repos.products.getProduct(breadId);
      throw new Error('orphan product should be gone');
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    const keep = repos.receipts.createReceipt('keep.jpg');
    repos.receipts.saveAIResponse(keep.id, '{}');
    repos.receipts.migrateReceipt(keep.id, {
      storeId: store.id,
      store: null,
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
    if (repos.purchases.listPurchases(flour.id).length !== 3) throw new Error('receipt purchase missing');
    repos.receipts.deleteReceipt(keep.id);
    if (repos.purchases.listPurchases(flour.id).length !== 2) throw new Error('shared product purchases');
    repos.products.getProduct(flour.id);

    try {
      repos.units.createUnit('kg');
      throw new Error('duplicate unit should fail');
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
    }

    const listed = repos.units.listUnits();
    const kgRow = listed.find((u) => u.name === 'kg');
    if (!kgRow || kgRow.productCount < 1) throw new Error('unit use count');
    if (!kgRow.compareValue.eq(1) || !repos.units.getUnit(g.id).compareValue.eq(1)) throw new Error('default compare value');
    repos.units.updateUnit(g.id, 'g', new Decimal(100));
    if (!repos.units.getUnit(g.id).compareValue.eq(100)) throw new Error('compare value');
    const gConv = repos.products.getProduct(flour.id).conversions.find((c) => c.unitId === g.id);
    if (!gConv || !gConv.compareValue.eq(100)) throw new Error('conversion compare value');

    const milk = repos.products.insertImported('Mleko', kg.id, '5900000000001');
    if (milk.ean !== '5900000000001') throw new Error('imported ean');
    repos.products.applyImportedEan(milk.id, '5900000000002');
    if (repos.products.getProduct(milk.id).ean !== '5900000000002') throw new Error('update ean');
    repos.products.applyImportedEan(milk.id, '');
    if (repos.products.getProduct(milk.id).ean !== '5900000000002') throw new Error('empty ean must not clear');

    const salt = repos.products.createProduct('Sol', kg.id, null);
    const keepShop = repos.locations.createStore('Keep Shop', 'Main', '1', '', '', 'KeepCity', '', chain.id);
    const dropShop = repos.locations.createStore(
      'Drop Shop',
      'Side',
      '2',
      '4',
      '00-123',
      'DropCity',
      '4242',
      chain.id,
      50.1,
      19.9,
    );
    repos.purchases.createPurchase(salt.id, dropShop.id, '2026-01-16 12:00', new Decimal('1'), new Decimal('3'), KIND_PURCHASE);
    repos.aliases.createAlias(salt.id, keepShop.id, null, 'Sol Shop');
    repos.aliases.createAlias(salt.id, dropShop.id, null, 'Sol Shop');
    repos.aliases.createAlias(salt.id, dropShop.id, null, 'Sol Drop');
    const dropReceipt = repos.receipts.createReceipt('drop-shop.jpg');
    repos.receipts.saveAIResponse(dropReceipt.id, JSON.stringify({ bought_on: '2026-01-16', company_id: dropShop.id }));
    const shopPlan = repos.locations.mergePlan(keepShop.id, dropShop.id);
    if (shopPlan.history !== 1 || shopPlan.aliases !== 2 || !shopPlan.takeCode || !shopPlan.takeCoords) {
      throw new Error('store merge plan');
    }
    const mergedShop = repos.locations.mergeStores(keepShop.id, dropShop.id);
    if (mergedShop.keeper.id !== keepShop.id) throw new Error('store merge keeper');
    const keptShop = repos.locations.getStore(keepShop.id);
    if (
      keptShop.externalId !== '4242' ||
      keptShop.lat !== 50.1 ||
      keptShop.lng !== 19.9 ||
      keptShop.apartmentNumber !== '4' ||
      keptShop.postalCode !== '00-123'
    ) {
      throw new Error('store merge fields');
    }
    if (keptShop.name !== 'Keep Shop' || keptShop.city !== 'KeepCity' || keptShop.streetName !== 'Main') {
      throw new Error('store merge kept identity');
    }
    if (keptShop.purchaseCount !== 1) throw new Error('store merge purchase count');
    try {
      repos.locations.getStore(dropShop.id);
      throw new Error('merged store should be gone');
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const shopBuys = repos.purchases.listPurchases(salt.id);
    if (shopBuys.length !== 1 || shopBuys[0]!.storeId !== keepShop.id) throw new Error('store merge purchases');
    const shopAliases = repos.aliases.listAliasesByProduct(salt.id).filter((a) => a.storeId === keepShop.id);
    const shopAliasNames = shopAliases.map((a) => a.alias).sort();
    if (shopAliasNames.join(',') !== 'SolDrop,SolShop') throw new Error('store merge aliases');
    const dropReceiptRow = repos.receipts.listReceipts().find((r) => r.id === dropReceipt.id);
    if (!dropReceiptRow || dropReceiptRow.shopName !== 'Keep Shop') throw new Error('store merge receipts');
    try {
      repos.locations.mergeStores(keepShop.id, keepShop.id);
      throw new Error('same store merge should fail');
    } catch (err) {
      if (!(err instanceof SameStoreError)) throw err;
    }
    const codedA = repos.locations.createStore('Coded A', 'A', '1', '', '', 'City', 'AAAA', chain.id);
    const codedB = repos.locations.createStore('Coded B', 'B', '2', '', '', 'City', 'BBBB', chain.id);
    try {
      repos.locations.mergeStores(codedA.id, codedB.id);
      throw new Error('conflicting store codes should fail');
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
    }
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

function applyMigrationFile(db: Database.Database, file: string): void {
  const sql = readFileSync(join(import.meta.dirname, '../db/migrations', file), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed !== '') db.exec(trimmed);
  }
}

function assertAmountGroszeMigration(): void {
  const dir = mkdtempSync(join(tmpdir(), 'bulkly-grosze-'));
  const raw = new Database(join(dir, 'bulkly.db'));
  try {
    raw.exec(`
      CREATE TABLE purchases (
        id integer PRIMARY KEY NOT NULL,
        product_id integer NOT NULL,
        store_id integer,
        bought_on text NOT NULL,
        quantity text NOT NULL,
        amount text NOT NULL,
        created_at text NOT NULL,
        kind text DEFAULT 'purchase' NOT NULL,
        receipt_id integer
      );
    `);
    const insert = raw.prepare(
      `INSERT INTO purchases (id, product_id, bought_on, quantity, amount, created_at) VALUES (?, 1, '2026-01-01', '1', ?, '2026-01-01')`,
    );
    const samples: Array<[string, number]> = [
      ['10.45', 1045],
      ['5', 500],
      ['4.5', 450],
      ['0.05', 5],
      ['12.50', 1250],
      ['0', 0],
      ['8.00', 800],
    ];
    samples.forEach(([text], i) => insert.run(i + 1, text));
    applyMigrationFile(raw, '0007_amount_grosze.sql');
    const rows = raw.prepare(`SELECT id, amount, typeof(amount) AS t FROM purchases ORDER BY id`).all() as Array<{
      id: number;
      amount: number;
      t: string;
    }>;
    if (rows.length !== samples.length) throw new Error(`converted rows: ${rows.length}`);
    for (const [i, [, grosze]] of samples.entries()) {
      const row = rows[i]!;
      if (row.amount !== grosze || row.t !== 'integer') throw new Error(`amount ${samples[i]![0]} stored as ${row.amount} ${row.t}`);
    }
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }

  const badDir = mkdtempSync(join(tmpdir(), 'bulkly-grosze-bad-'));
  const bad = new Database(join(badDir, 'bulkly.db'));
  try {
    bad.exec(`
      CREATE TABLE purchases (
        id integer PRIMARY KEY NOT NULL,
        product_id integer NOT NULL,
        store_id integer,
        bought_on text NOT NULL,
        quantity text NOT NULL,
        amount text NOT NULL,
        created_at text NOT NULL,
        kind text DEFAULT 'purchase' NOT NULL,
        receipt_id integer
      );
      INSERT INTO purchases (id, product_id, bought_on, quantity, amount, created_at) VALUES (1, 1, '2026-01-01', '1', '10.456', '2026-01-01');
    `);
    let failed = false;
    try {
      applyMigrationFile(bad, '0007_amount_grosze.sql');
    } catch {
      failed = true;
    }
    if (!failed) throw new Error('amount with 3 decimal places should fail the migration');
  } finally {
    bad.close();
    rmSync(badDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  runStoreSmoke();
  runDrizzleIdRepairSmoke();
  assertAmountGroszeMigration();
  console.log('store smoke ok');
}
