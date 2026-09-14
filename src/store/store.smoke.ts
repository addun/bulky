import '../paths';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { DatabaseService } from '../db/database.service';
import { DuplicateError } from '../domain/errors';
import {
  AliasesRepository,
  ComparisonGroupsRepository,
  KIND_PURCHASE,
  LocationsRepository,
  ProductsRepository,
  PurchasesRepository,
  ReceiptsRepository,
  UnitsRepository,
} from '@app/store';

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

function runStoreSmoke(): void {
  const dir = mkdtempSync(join(tmpdir(), 'bulkly-drizzle-'));
  const db = new DatabaseService(new ConfigService({ DATA_DIR: dir }));
  try {
    const store = createStore(db);
    const kg = store.units.findUnitByName('KG');
    const g = store.units.findUnitByName('g');
    if (kg.Name !== 'kg') throw new Error(`expected kg, got ${kg.Name}`);

    const chain = store.locations.createRetailChain('Biedronka', 'Jerónimo Martins', '1234567890');
    const story = store.locations.createStory('Katowice', 'Kosciuszki', '10', '', '40-001', 'Katowice', '2615', chain.ID);
    if (story.RetailChainName !== 'Biedronka') throw new Error('story chain join');

    const flour = store.products.createProduct(
      'Maka',
      kg.ID,
      null,
      [{ UnitID: g.ID, UnitName: 'g', Factor: new Decimal(1000) }],
    );
    store.purchases.createPurchase(flour.ID, story.ID, '2026-01-15 12:00', new Decimal('2.5'), new Decimal('12.50'), KIND_PURCHASE);
    store.aliases.createAlias(flour.ID, story.ID, 0, 'Maka Tortowa');

    const found = store.products.findProductByName('maka', 0);
    if (found.ID !== flour.ID) throw new Error('nocase product lookup');
    const byAlias = store.products.findProductByName('maka tortowa', story.ID);
    if (byAlias.ID !== flour.ID) throw new Error('alias lookup');

    const items = store.products.listProducts('');
    if (items.length !== 1 || items[0]!.PurchaseCount !== 1) throw new Error('product list stats');
    if (!items[0]!.Quote) throw new Error('quote missing');

    const group = store.groups.createComparisonGroup('Flour', kg.ID, [flour.ID]);
    if (group.ProductCount !== 1) throw new Error('group count');
    const rice = store.products.createProduct('Ryz', kg.ID, null);
    store.purchases.createPurchase(rice.ID, story.ID, '2026-01-20 12:00', new Decimal('1'), new Decimal('8'), KIND_PURCHASE);
    store.groups.updateComparisonGroup(group.ID, 'Flour', kg.ID, [flour.ID, rice.ID]);
    const related = store.groups.relatedGroupProducts(flour.ID, new Date());
    if (related.length !== 1 || related[0]!.ID !== rice.ID) throw new Error('related group products');
    const leaders = store.groups.comparisonLeaders(flour.ID);
    if (leaders.length !== 1 || !leaders[0]!.Leader) throw new Error('comparison leaders');

    const merged = store.products.mergeProducts(flour.ID, rice.ID);
    if (merged.keeper.ID !== flour.ID) throw new Error('merge keeper');
    if (store.purchases.listPurchases(flour.ID).length !== 2) throw new Error('merge purchases');

    store.units.setSetting('ocr_model', 'vision');
    if (store.units.ocrModel() !== 'vision') throw new Error('settings upsert');

    const receipt = store.receipts.createReceipt('bill.jpg');
    store.receipts.saveAIResponse(receipt.ID, JSON.stringify({ bought_on: '2026-03-01' }));
    if (store.receipts.latestSourcedBoughtOn('ocr') !== '2026-03-01') throw new Error('json extract');

    try {
      store.units.createUnit('kg');
      throw new Error('duplicate unit should fail');
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
    }

    const listed = store.units.listUnits();
    const kgRow = listed.find((u) => u.Name === 'kg');
    if (!kgRow || kgRow.ProductCount < 1) throw new Error('unit use count');
  } finally {
    db.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runStoreSmoke();
  console.log('store smoke ok');
}
