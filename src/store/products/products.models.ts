import { Decimal } from 'decimal.js';
import type { QuotedPrice } from '../../domain/price-stats.js';

export type ProductConversion = {
  unitId: number;
  unitName: string;
  factor: Decimal;
};

export type Product = {
  id: number;
  name: string;
  ean: string;
  unitId: number;
  unitName: string;
  imagePath: string | null;
  createdAt: string;
  conversions: ProductConversion[];
};

export type ProductListItem = Product & {
  lastBought: string | null;
  lifetimeAmount: Decimal;
  purchaseCount: number;
  quote: QuotedPrice | null;
};

export type ProductQuote = {
  product: Product;
  quote: QuotedPrice | null;
};

export type MergePlan = {
  into: Product;
  from: Product;
  history: number;
  aliases: number;
  nameAsAlias: string;
  takePhoto: boolean;
};

export function conversionFor(p: Product, unitId: number): ProductConversion | null {
  return p.conversions.find((c) => c.unitId === unitId) ?? null;
}

export function unitIdsAttr(p: Product): string {
  return [p.unitId, ...p.conversions.map((c) => c.unitId)].join(',');
}

export function packConversionsJSON(p: Product): string {
  return JSON.stringify(
    p.conversions.map((c) => ({ name: c.unitName, factor: c.factor.toString() })),
  );
}
