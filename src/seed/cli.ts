import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { faker } from '@faker-js/faker';
import Decimal from 'decimal.js';
import { AppModule } from '../app.module';
import { KIND_PRICE, KIND_PURCHASE } from '../domain/types';
import { StoreService } from '../store/store.service';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const store = app.get(StoreService);
  if (args.clamp) {
    const n = clampExistingUnitPrices(store);
    console.log(`clamped unit prices on ${n} purchases in ${store.dataDir()}`);
    await app.close();
    return;
  }
  const units = store.listUnits();
  if (units.length === 0) throw new Error('no units in the database');
  if (args.seed) faker.seed(args.seed);
  else console.log('faker seed: (random)');

  const chains: ReturnType<StoreService['createRetailChain']>[] = [];
  if (args.stories > 0) {
    for (let i = 0; i < 3; i++) {
      const name = `${faker.company.name()} ${i + 1}`;
      chains.push(store.createRetailChain(name, `${name} Sp. z o.o.`, faker.string.numeric(10)));
    }
  }
  const stories: ReturnType<StoreService['createStory']>[] = [];
  for (let i = 0; i < args.stories; i++) {
    const apt = Math.random() < 0.5 ? faker.string.numeric(2) : '';
    const chainID = chains.length && Math.random() < 0.8 ? chains[Math.floor(Math.random() * chains.length)]!.ID : 0;
    stories.push(
      store.createStory(
        faker.company.name(),
        faker.location.street(),
        faker.location.buildingNumber(),
        apt,
        `${faker.string.numeric(2)}-${faker.string.numeric(3)}`,
        faker.location.city(),
        '',
        chainID,
      ),
    );
  }
  const seen = new Set<string>();
  const products: ReturnType<StoreService['createProduct']>[] = [];
  while (products.length < args.products) {
    let name = faker.commerce.productName();
    let key = name.toLowerCase();
    if (seen.has(key)) {
      name = `${name} ${faker.color.human()} ${products.length + 1}`;
      key = name.toLowerCase();
      if (seen.has(key)) continue;
    }
    seen.add(key);
    const unit = units[Math.floor(Math.random() * units.length)]!;
    products.push(store.createProduct(name, unit.ID, null));
  }
  const start = new Date();
  start.setFullYear(start.getFullYear() - 2);
  const end = new Date();
  const span = end.getTime() - start.getTime();
  let purchases = 0;
  store.immediate(() => {
    for (const p of products) {
      let price = 1 + Math.random() * 99;
      for (let n = 0; n < args.history; n++) {
        const kind = Math.random() < 0.12 ? KIND_PRICE : KIND_PURCHASE;
        const storyID = stories.length && Math.random() < 0.8 ? stories[Math.floor(Math.random() * stories.length)]!.ID : 0;
        const when = args.history > 1 ? new Date(start.getTime() + (n * span) / (args.history - 1)) : start;
        const jitterH = Math.floor(Math.random() * 37);
        const bought = new Date(when.getTime() + jitterH * 3600_000);
        const boughtOn = `${bought.getFullYear()}-${pad(bought.getMonth() + 1)}-${pad(bought.getDate())} ${pad(bought.getHours())}:${pad(bought.getMinutes())}`;
        price = Math.min(100, Math.max(1, price * (0.93 + Math.random() * 0.15)));
        const qty = p.UnitName === 'kg' || p.UnitName === 'g' ? new Decimal((0.4 + Math.random() * 11.6).toFixed(3)) : new Decimal(1 + Math.floor(Math.random() * 8));
        const amount = qty.mul(price).toDecimalPlaces(2);
        store.createPurchase(p.ID, storyID, boughtOn, qty, amount, kind);
        purchases++;
      }
    }
  });
  console.log(`inserted ${stories.length} stores, ${products.length} products, ${purchases} purchases into ${store.dataDir()}`);
  await app.close();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const MIN_UNIT_PRICE = 1;
const MAX_UNIT_PRICE = 100;

function clampExistingUnitPrices(store: StoreService): number {
  const products = store.listProducts('');
  return store.immediate(() => {
    let updated = 0;
    for (const p of products) {
      updated += rescalePurchases(store, store.listPurchases(p.ID));
    }
    return updated;
  });
}

function rescalePurchases(store: StoreService, rows: ReturnType<StoreService['listPurchases']>): number {
  const pts: { row: (typeof rows)[number]; price: Decimal }[] = [];
  let lo = new Decimal(0);
  let hi = new Decimal(0);
  for (const row of rows) {
    if (row.Quantity.isZero()) continue;
    const price = row.Amount.div(row.Quantity);
    if (pts.length === 0 || price.lt(lo)) lo = price;
    if (pts.length === 0 || price.gt(hi)) hi = price;
    pts.push({ row, price });
  }
  const minP = new Decimal(MIN_UNIT_PRICE);
  const maxP = new Decimal(MAX_UNIT_PRICE);
  if (pts.length === 0 || (!lo.lt(minP) && !hi.gt(maxP))) return 0;
  const span = hi.sub(lo);
  const mid = minP.add(maxP).div(2);
  let n = 0;
  for (const pt of pts) {
    const newPrice = span.isZero() ? mid : minP.add(pt.price.sub(lo).div(span).mul(maxP.sub(minP)));
    const amount = newPrice.mul(pt.row.Quantity).toDecimalPlaces(2);
    store.updatePurchase(pt.row.ID, pt.row.StoryID, pt.row.BoughtOn, pt.row.Quantity, amount, pt.row.Kind);
    n++;
  }
  return n;
}

function parseArgs(argv: string[]) {
  const out = { dataDir: process.env.DATA_DIR || './data', seed: 0, stories: 16, products: 100, history: 250, clamp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    if (a === '--data-dir' && next) {
      out.dataDir = next;
      process.env.DATA_DIR = next;
      i++;
    } else if (a === '--seed' && next) {
      out.seed = Number(next);
      i++;
    } else if (a === '--stories' && next) {
      out.stories = Number(next);
      i++;
    } else if (a === '--products' && next) {
      out.products = Number(next);
      i++;
    } else if (a === '--history-per-product' && next) {
      out.history = Number(next);
      i++;
    } else if (a === '--clamp-prices') out.clamp = true;
  }
  return out;
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
