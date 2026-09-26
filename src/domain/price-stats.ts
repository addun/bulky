import { Decimal } from 'decimal.js';
import { boughtOnDate } from './bought-on.js';
import { compareUnitLabel, priceAtCompare } from './format.js';
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
  const out: UnitQuote[] = [
    {
      unitName: compareUnitLabel(p.unitName, p.compareValue),
      price: priceAtCompare(quote.price, p.compareValue),
    },
  ];
  for (const c of p.conversions ?? []) {
    if (c.factor.isZero()) continue;
    const perOne = quote.price.div(c.factor);
    out.push({
      unitName: compareUnitLabel(c.unitName, c.compareValue),
      price: priceAtCompare(perOne, c.compareValue),
    });
  }
  return out;
}

export function extraQuotes(quote: QuotedPrice | null | undefined, p: Product): UnitQuote[] {
  if (!quote) return [];
  const all = unitQuotes(quote, p);
  return all.length <= 1 ? [] : all.slice(1);
}

export const VERDICT_DEAL = 'deal';
export const VERDICT_FAKE = 'fake';
export const VERDICT_NONE = 'none';
export type PromotionVerdict = typeof VERDICT_DEAL | typeof VERDICT_FAKE | typeof VERDICT_NONE;

export type PromotionQuote = {
  current: Decimal | null;
  was: Decimal | null;
  typical: Decimal | null;
  verdict: PromotionVerdict;
};

const MARKDOWN = new Decimal('0.08');

export function promotionLabel(verdict: PromotionVerdict): string {
  if (verdict === VERDICT_DEAL) return 'Prawdziwa promka';
  if (verdict === VERDICT_FAKE) return 'To nie promka';
  return 'Brak promki';
}

export function promotionQuote(purchases: Purchase[]): PromotionQuote {
  const prices: Decimal[] = [];
  for (const p of purchases) {
    const price = unitPriceOf(p);
    if (price) prices.push(price);
  }
  const current = prices[0] ?? null;
  if (!current) return { current: null, was: null, typical: null, verdict: VERDICT_NONE };

  const older = prices.slice(1);
  const typical = medianPrice(older);
  const was = advertisedWas(current, older);
  if (!was) return { current, was: null, typical, verdict: VERDICT_NONE };

  const vsWas = cheaperBy(current, was, MARKDOWN);
  const vsTypical = typical ? cheaperBy(current, typical, MARKDOWN) : vsWas;
  if (vsWas && vsTypical) return { current, was, typical, verdict: VERDICT_DEAL };
  if (vsWas && !vsTypical) return { current, was, typical, verdict: VERDICT_FAKE };
  return { current, was, typical, verdict: VERDICT_NONE };
}

function advertisedWas(current: Decimal, older: Decimal[]): Decimal | null {
  for (const p of older) {
    if (p.gt(current)) return p;
  }
  let high: Decimal | null = null;
  for (const p of older) {
    if (!high || p.gt(high)) high = p;
  }
  if (high && high.gt(current)) return high;
  return null;
}

function medianPrice(values: Decimal[]): Decimal | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return sorted[mid - 1]!.plus(sorted[mid]!).div(2);
}

function cheaperBy(price: Decimal, ref: Decimal, ratio: Decimal): boolean {
  return price.lte(ref.mul(new Decimal(1).minus(ratio)));
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
