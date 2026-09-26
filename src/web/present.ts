import { Decimal } from 'decimal.js';
import {
  bestRecentPrice,
  extraQuotes,
  isLast30Days as quoteIsLast30Days,
  lowestSince,
  promotionLabel,
  promotionQuote,
  WINDOW_LAST_RECORD,
} from '../domain/price-stats.js';
import type { PricePoint, QuotedPrice } from '../domain/price-stats.js';
import { boughtOnDate } from '../domain/bought-on.js';
import { aliasScopeLabel, aliasScopeValue, type ProductAlias } from '#app/store/aliases';
import {
  chainLabel,
  storeAddressLine,
  storeLabel,
  storeStreetLine,
  type RetailChain,
  type Store,
} from '#app/store/locations';
import {
  conversionFor,
  packConversionsJSON,
  unitIdsAttr,
  type Product,
  type ProductListItem,
} from '#app/store/products';
import { priceAtCompare } from '../domain/format.js';
import { yearlySummaries } from '../domain/yearly-summaries.js';
import { KIND_PRICE, KIND_PURCHASE, type Purchase } from '#app/store/purchases';
import { RECEIPT_PENDING, receiptStatusLabel, type Receipt, type ReceiptListItem } from '#app/store/receipts';

export type Page = {
  title: string;
  query: string;
  error: string;
  symbol: string;
  currency: string;
  today: string;
  admin: boolean;
  refreshSeconds: number;
};

export function makePage(
  title: string,
  query: string,
  errMsg: string,
  symbol: string,
  currency: string,
  admin = false,
  refreshSeconds = 0,
): Page {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    title,
    query,
    error: errMsg,
    symbol,
    currency,
    today,
    admin,
    refreshSeconds,
  };
}

export function presentProduct(p: Product): Product & { unitIdsAttr: string; packConversionsJSON: string } {
  return { ...p, unitIdsAttr: unitIdsAttr(p), packConversionsJSON: packConversionsJSON(p) };
}

export function presentQuote(q: QuotedPrice | null): (QuotedPrice & { isLast30Days: boolean }) | null {
  if (!q) return null;
  return { ...q, isLast30Days: quoteIsLast30Days(q) };
}

const PROMO_TINTS = ['sky', 'blush', 'peach', 'mint', 'sand', 'mist'] as const;

export function presentPromoCard(
  product: Product,
  quote: QuotedPrice | null,
  purchases: Purchase[],
): {
  product: ReturnType<typeof presentProduct>;
  quote: ReturnType<typeof presentQuote>;
  current: ReturnType<typeof promotionQuote>['current'];
  was: ReturnType<typeof promotionQuote>['was'];
  verdict: ReturnType<typeof promotionQuote>['verdict'];
  verdictLabel: string;
  tint: (typeof PROMO_TINTS)[number];
  initial: string;
  extras: ReturnType<typeof extraQuotes>;
  priceNote: string;
} {
  const promo = promotionQuote(purchases);
  const shown = presentQuote(quote ?? bestRecentPrice(purchases, new Date()));
  const initial = promoInitial(product.name);
  const current = shown?.price ?? promo.current ?? null;
  const extras = current
    ? extraQuotes({ price: current, boughtOn: shown?.boughtOn || '', window: WINDOW_LAST_RECORD }, product).filter(
        (q) => q.price.gte('0.01'),
      )
    : [];
  let priceNote = '';
  if (shown) {
    priceNote = shown.isLast30Days ? 'najniższa cena z ostatnich 30 dni' : daysAgoLabel(shown.boughtOn);
  }
  return {
    product: presentProduct(product),
    quote: shown,
    current,
    was: promo.was,
    verdict: promo.verdict,
    verdictLabel: promotionLabel(promo.verdict),
    tint: promoTint(product.id),
    initial,
    extras,
    priceNote,
  };
}

export type ProductStatRow = {
  label: string;
  money?: Decimal;
  text?: string;
};

export function presentProductPage(
  product: Product,
  purchases: Purchase[],
  quote: QuotedPrice | null,
  yearPoints: PricePoint[],
): {
  product: ReturnType<typeof presentProduct>;
  quote: ReturnType<typeof presentQuote>;
  extras: ReturnType<typeof extraQuotes>;
  tint: (typeof PROMO_TINTS)[number];
  initial: string;
  priceEyebrow: string;
  priceNote: string;
  stats: ProductStatRow[];
} {
  const shown = presentQuote(quote);
  const extras = shown
    ? extraQuotes(shown, product).filter((q) => q.price.gte('0.01'))
    : [];
  const today = new Date();
  const from30 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  from30.setDate(from30.getDate() - 30);
  const low30 = lowestSince(purchases, from30);
  const lowest = yearLowest(yearPoints);
  const stats: ProductStatRow[] = [];
  if (low30) stats.push({ label: 'Najniższa w ostatnich 30 dniach', money: priceAtCompare(low30.price, product.compareValue) });
  if (lowest) stats.push({ label: 'Najniższa w ostatnich 365 dniach', money: priceAtCompare(lowest, product.compareValue) });

  let priceEyebrow = 'Najlepsza cena, ostatnie 30 dni';
  let priceNote = '';
  if (shown?.isLast30Days) {
    priceEyebrow = 'Najlepsza cena, ostatnie 30 dni';
  } else if (shown) {
    priceEyebrow = 'Ostatnia cena';
    priceNote = daysAgoLabel(shown.boughtOn);
  }

  return {
    product: presentProduct(product),
    quote: shown,
    extras,
    tint: promoTint(product.id),
    initial: promoInitial(product.name),
    priceEyebrow,
    priceNote,
    stats,
  };
}

function promoTint(id: number): (typeof PROMO_TINTS)[number] {
  return PROMO_TINTS[Math.abs(id) % PROMO_TINTS.length]!;
}

function promoInitial(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

function yearLowest(points: PricePoint[]): Decimal | null {
  let lowest: Decimal | null = null;
  for (const pt of points) {
    if (!lowest || pt.price.lt(lowest)) lowest = pt.price;
  }
  return lowest;
}

function daysAgoLabel(boughtOn: string): string {
  const day = boughtOnDate(boughtOn);
  if (!day) return '';
  const then = new Date(`${day}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86400000);
  if (days <= 0) return 'dzisiaj';
  if (days === 1) return '1 dzień temu';
  return `${days} dni temu`;
}

export function presentPurchase(p: Purchase): Purchase & { isPurchase: boolean; isPrice: boolean } {
  return { ...p, isPurchase: p.kind === KIND_PURCHASE, isPrice: p.kind === KIND_PRICE };
}

export function presentStore(s: Store): Store & { label: string; streetLine: string; addressLine: string } {
  return {
    ...s,
    label: storeLabel(s),
    streetLine: storeStreetLine(s),
    addressLine: storeAddressLine(s),
  };
}

export function presentChain(c: RetailChain): RetailChain & { label: string } {
  return { ...c, label: chainLabel(c) };
}

export function presentAlias(a: ProductAlias): ProductAlias & { scopeLabel: string; scopeValue: string } {
  return { ...a, scopeLabel: aliasScopeLabel(a), scopeValue: aliasScopeValue(a) };
}

export function presentReceipt(r: Receipt): Receipt & { statusLabel: string; reading: boolean } {
  return { ...r, statusLabel: receiptStatusLabel(r), reading: r.status === RECEIPT_PENDING };
}

export function presentReceiptListItem(
  r: ReceiptListItem,
): ReceiptListItem & { statusLabel: string; displayDate: string } {
  return {
    ...r,
    statusLabel: receiptStatusLabel(r),
    displayDate: r.boughtOn.trim() || r.createdAt,
  };
}

export function presentListItem(it: ProductListItem): ProductListItem & { quote: ReturnType<typeof presentQuote> } {
  return { ...it, quote: presentQuote(it.quote) };
}

export function storesByID(stores: Store[]): Record<string, ReturnType<typeof presentStore>> {
  const out: Record<string, ReturnType<typeof presentStore>> = {};
  for (const s of stores) out[String(s.id)] = presentStore(s);
  return out;
}

export { conversionFor, yearlySummaries };
