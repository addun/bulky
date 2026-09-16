import { isLast30Days as quoteIsLast30Days } from '../domain/price-stats.js';
import type { QuotedPrice } from '../domain/price-stats.js';
import { aliasScopeLabel, aliasScopeValue, type ProductAlias } from '#app/store/aliases';
import { type RelatedProduct } from '#app/store/comparison-groups';
import {
  chainLabel,
  storyAddressLine,
  storyLabel,
  storyStreetLine,
  type RetailChain,
  type Story,
} from '#app/store/locations';
import {
  conversionFor,
  packConversionsJSON,
  unitIdsAttr,
  type Product,
  type ProductListItem,
} from '#app/store/products';
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

export function presentPurchase(p: Purchase): Purchase & { isPurchase: boolean; isPrice: boolean } {
  return { ...p, isPurchase: p.kind === KIND_PURCHASE, isPrice: p.kind === KIND_PRICE };
}

export function presentStory(s: Story): Story & { label: string; streetLine: string; addressLine: string } {
  return {
    ...s,
    label: storyLabel(s),
    streetLine: storyStreetLine(s),
    addressLine: storyAddressLine(s),
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

export function presentRelated(r: RelatedProduct): RelatedProduct & { quote: ReturnType<typeof presentQuote> } {
  return { ...r, quote: presentQuote(r.quote) };
}

export function presentListItem(it: ProductListItem): ProductListItem & { quote: ReturnType<typeof presentQuote> } {
  return { ...it, quote: presentQuote(it.quote) };
}

export function storiesByID(stories: Story[]): Record<string, ReturnType<typeof presentStory>> {
  const out: Record<string, ReturnType<typeof presentStory>> = {};
  for (const s of stories) out[String(s.id)] = presentStory(s);
  return out;
}

export { conversionFor, yearlySummaries };
