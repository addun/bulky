import { Decimal } from 'decimal.js';
import { boughtOnDate } from './bought-on.js';
import type { Product, ProductConversion } from '../store/products/products.models.js';
import type { Purchase } from '../store/purchases/purchases.models.js';

export const WINDOW_LAST_30_DAYS = 'last_30_days';
export const WINDOW_LAST_RECORD = 'last_record';

export type PricePoint = {
  boughtOn: string;
  price: Decimal;
};

export type QuotedPrice = PricePoint & {
  window: string;
};

export function isLast30Days(q: QuotedPrice): boolean {
  return q.window === WINDOW_LAST_30_DAYS;
}

export type UnitQuote = {
  unitName: string;
  price: Decimal;
};

export function unitQuotes(quote: QuotedPrice, p: Product): UnitQuote[] {
  const out: UnitQuote[] = [{ unitName: p.unitName, price: quote.price }];
  for (const c of p.conversions ?? []) {
    if (c.factor.isZero()) continue;
    out.push({ unitName: c.unitName, price: quote.price.div(c.factor) });
  }
  return out;
}

export function extraQuotes(quote: QuotedPrice | null | undefined, p: Product): UnitQuote[] {
  if (!quote) return [];
  const all = unitQuotes(quote, p);
  return all.length <= 1 ? [] : all.slice(1);
}

export function qtyIn(primaryQty: Decimal, conv: ProductConversion): Decimal {
  return primaryQty.mul(conv.factor);
}

function unitPriceOf(p: Purchase): Decimal | null {
  if (p.quantity.isZero()) return null;
  return p.amount.div(p.quantity);
}

function onOrAfter(boughtOn: string, day: string): boolean {
  const d = boughtOnDate(boughtOn);
  return d !== '' && d >= day;
}

function onOrBefore(boughtOn: string, day: string): boolean {
  const d = boughtOnDate(boughtOn);
  return d !== '' && d <= day;
}

export function lastUnitPrice(purchases: Purchase[]): PricePoint | null {
  for (const p of purchases) {
    const price = unitPriceOf(p);
    if (!price) continue;
    return { boughtOn: p.boughtOn, price };
  }
  return null;
}

export function lowestSince(purchases: Purchase[], since: Date): PricePoint | null {
  const day = formatDay(since);
  let best: PricePoint | null = null;
  for (const p of purchases) {
    if (!onOrAfter(p.boughtOn, day)) continue;
    const price = unitPriceOf(p);
    if (!price) continue;
    if (!best || price.lt(best.price)) best = { boughtOn: p.boughtOn, price };
  }
  return best;
}

export function bestRecentPrice(purchases: Purchase[], now: Date): QuotedPrice | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  const low = lowestSince(purchases, from);
  if (low) return { ...low, window: WINDOW_LAST_30_DAYS };
  const last = lastUnitPrice(purchases);
  if (last) return { ...last, window: WINDOW_LAST_RECORD };
  return null;
}

export function quotesByProduct(buys: Purchase[], now: Date): Map<number, QuotedPrice> {
  const byProduct = new Map<number, Purchase[]>();
  for (const p of buys) {
    const list = byProduct.get(p.productId) ?? [];
    list.push(p);
    byProduct.set(p.productId, list);
  }
  const out = new Map<number, QuotedPrice>();
  for (const [id, list] of byProduct) {
    const q = bestRecentPrice(list, now);
    if (q) out.set(id, q);
  }
  return out;
}

export function pricesBetween(purchases: Purchase[], from: Date, to: Date): PricePoint[] {
  const fromDay = formatDay(from);
  const toDay = formatDay(to);
  const out: PricePoint[] = [];
  for (let i = purchases.length - 1; i >= 0; i--) {
    const p = purchases[i]!;
    if (!onOrAfter(p.boughtOn, fromDay) || !onOrBefore(p.boughtOn, toDay)) continue;
    const price = unitPriceOf(p);
    if (!price) continue;
    out.push({ boughtOn: p.boughtOn, price });
  }
  return out;
}

export function lastPricesByProduct(buys: Purchase[]): Map<number, PricePoint> {
  const byProduct = new Map<number, Purchase[]>();
  for (const p of buys) {
    const list = byProduct.get(p.productId) ?? [];
    list.push(p);
    byProduct.set(p.productId, list);
  }
  const out = new Map<number, PricePoint>();
  for (const [id, list] of byProduct) {
    const pt = lastUnitPrice(list);
    if (pt) out.set(id, pt);
  }
  return out;
}

function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
