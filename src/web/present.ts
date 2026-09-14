import { isLast30Days as quoteIsLast30Days } from '../domain/price-stats';
import type { QuotedPrice } from '../domain/price-stats';
import { aliasScopeLabel, aliasScopeValue, type ProductAlias } from '@app/store/aliases';
import { type RelatedProduct } from '@app/store/comparison-groups';
import {
  chainLabel,
  storyAddressLine,
  storyLabel,
  storyStreetLine,
  type RetailChain,
  type Story,
} from '@app/store/locations';
import {
  conversionFor,
  packConversionsJSON,
  unitIDsAttr,
  type Product,
  type ProductListItem,
} from '@app/store/products';
import { yearlySummaries } from '../domain/yearly-summaries';
import { KIND_PRICE, KIND_PURCHASE, type Purchase } from '@app/store/purchases';
import { RECEIPT_PENDING, receiptStatusLabel, type Receipt } from '@app/store/receipts';

export type Page = {
  Title: string;
  Query: string;
  Error: string;
  Symbol: string;
  Currency: string;
  Today: string;
  Admin: boolean;
  RefreshSeconds: number;
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
    Title: title,
    Query: query,
    Error: errMsg,
    Symbol: symbol,
    Currency: currency,
    Today: today,
    Admin: admin,
    RefreshSeconds: refreshSeconds,
  };
}

export function presentProduct(p: Product): Product & { UnitIDsAttr: string; PackConversionsJSON: string } {
  return { ...p, UnitIDsAttr: unitIDsAttr(p), PackConversionsJSON: packConversionsJSON(p) };
}

export function presentQuote(q: QuotedPrice | null): (QuotedPrice & { IsLast30Days: boolean }) | null {
  if (!q) return null;
  return { ...q, IsLast30Days: quoteIsLast30Days(q) };
}

export function presentPurchase(p: Purchase): Purchase & { IsPurchase: boolean; IsPrice: boolean } {
  return { ...p, IsPurchase: p.Kind === KIND_PURCHASE, IsPrice: p.Kind === KIND_PRICE };
}

export function presentStory(s: Story): Story & { Label: string; StreetLine: string; AddressLine: string } {
  return {
    ...s,
    Label: storyLabel(s),
    StreetLine: storyStreetLine(s),
    AddressLine: storyAddressLine(s),
  };
}

export function presentChain(c: RetailChain): RetailChain & { Label: string } {
  return { ...c, Label: chainLabel(c) };
}

export function presentAlias(a: ProductAlias): ProductAlias & { ScopeLabel: string; ScopeValue: string } {
  return { ...a, ScopeLabel: aliasScopeLabel(a), ScopeValue: aliasScopeValue(a) };
}

export function presentReceipt(r: Receipt): Receipt & { StatusLabel: string; Reading: boolean } {
  return { ...r, StatusLabel: receiptStatusLabel(r), Reading: r.Status === RECEIPT_PENDING };
}

export function presentRelated(r: RelatedProduct): RelatedProduct & { Quote: ReturnType<typeof presentQuote> } {
  return { ...r, Quote: presentQuote(r.Quote) };
}

export function presentListItem(it: ProductListItem): ProductListItem & { Quote: ReturnType<typeof presentQuote> } {
  return { ...it, Quote: presentQuote(it.Quote) };
}

export function storiesByID(stories: Story[]): Record<string, ReturnType<typeof presentStory>> {
  const out: Record<string, ReturnType<typeof presentStory>> = {};
  for (const s of stories) out[String(s.ID)] = presentStory(s);
  return out;
}

export { conversionFor, yearlySummaries };
