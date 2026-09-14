import Decimal from 'decimal.js';
import type { QuotedPrice } from '../../domain/price-stats';

export type ImagePath = { Valid: boolean; String: string };

export type ProductConversion = {
  UnitID: number;
  UnitName: string;
  Factor: Decimal;
};

export type Product = {
  ID: number;
  Name: string;
  UnitID: number;
  UnitName: string;
  ImagePath: ImagePath;
  CreatedAt: string;
  Conversions: ProductConversion[];
};

export type ProductListItem = Product & {
  LastBought: ImagePath;
  LifetimeAmount: Decimal;
  PurchaseCount: number;
  Quote: QuotedPrice | null;
};

export type ProductQuote = {
  Product: Product;
  Quote: QuotedPrice | null;
};

export type MergePlan = {
  Into: Product;
  From: Product;
  History: number;
  Aliases: number;
  NameAsAlias: string;
  TakePhoto: boolean;
};

export function emptyImage(): ImagePath {
  return { Valid: false, String: '' };
}

export function imagePath(s: string | null | undefined): ImagePath {
  if (!s) return emptyImage();
  return { Valid: true, String: s };
}

export function conversionFor(p: Product, unitID: number): ProductConversion | null {
  return p.Conversions.find((c) => c.UnitID === unitID) ?? null;
}

export function unitIDsAttr(p: Product): string {
  return [p.UnitID, ...p.Conversions.map((c) => c.UnitID)].join(',');
}

export function packConversionsJSON(p: Product): string {
  return JSON.stringify(
    p.Conversions.map((c) => ({ name: c.UnitName, factor: c.Factor.toString() })),
  );
}
