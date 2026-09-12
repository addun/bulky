import Decimal from 'decimal.js';
import type { QuotedPrice } from './price-stats';

export const KIND_PURCHASE = 'purchase';
export const KIND_PRICE = 'price';
export type PurchaseKind = typeof KIND_PURCHASE | typeof KIND_PRICE;

export const RECEIPT_PENDING = 'pending';
export const RECEIPT_READY = 'ready';
export const RECEIPT_FAILED = 'failed';
export const RECEIPT_MIGRATED = 'migrated';

export const RECEIPT_SOURCE_OCR = 'ocr';
export const RECEIPT_SOURCE_BIEDRONKA = 'biedronka';

export const SETTING_OCR_MODEL = 'ocr_model';
export const SETTING_PIECE_UNIT_ID = 'piece_unit_id';
export const SETTING_WEIGHT_UNIT_ID = 'weight_unit_id';

export type ImagePath = { Valid: boolean; String: string };

export type Unit = {
  ID: number;
  Name: string;
  ProductCount: number;
};

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

export type Story = {
  ID: number;
  Name: string;
  StreetName: string;
  BuildingNumber: string;
  ApartmentNumber: string;
  PostalCode: string;
  City: string;
  ExternalID: string;
  RetailChainID: number;
  RetailChainName: string;
  PurchaseCount: number;
};

export type RetailChain = {
  ID: number;
  Name: string;
  LegalName: string;
  TaxID: string;
  StoryCount: number;
};

export type Purchase = {
  ID: number;
  ProductID: number;
  StoryID: number;
  Kind: PurchaseKind;
  ReceiptID: number;
  BoughtOn: string;
  Quantity: Decimal;
  Amount: Decimal;
  CreatedAt: string;
};

export type ReceiptPurchase = Purchase & {
  ProductName: string;
  UnitName: string;
  ImagePath: ImagePath;
};

export type YearSummary = {
  Year: string;
  Quantity: Decimal;
  Amount: Decimal;
};

export type ProductAlias = {
  ID: number;
  ProductID: number;
  ProductName: string;
  StoryID: number;
  StoryName: string;
  RetailChainID: number;
  RetailChainName: string;
  Alias: string;
};

export type Receipt = {
  ID: number;
  ImagePath: string;
  RawResponse: string;
  Status: string;
  ErrorMessage: string;
  CreatedAt: string;
  Source: string;
  ExternalID: string;
  SourcePayload: string;
};

export type ComparisonGroup = {
  ID: number;
  Name: string;
  UnitID: number;
  UnitName: string;
  CreatedAt: string;
  ProductCount: number;
};

export type ComparisonOffer = {
  ProductID: number;
  ProductName: string;
  Price: Decimal;
  BoughtOn: string;
};

export type GroupComparison = {
  Group: ComparisonGroup;
  Selected: ComparisonOffer | null;
  Leader: ComparisonOffer | null;
  SelectedIsLeader: boolean;
  SelectedComparable: boolean;
};

export type RelatedProduct = Product & {
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

export type UnitDefaults = {
  PieceID: number;
  WeightID: number;
};

export type BillLineInput = {
  ProductID: number;
  ProductName: string;
  ReceiptName: string;
  UnitID: number;
  Quantity: Decimal;
  Amount: Decimal;
};

export type BillImport = {
  StoryID: number;
  Story: Story | null;
  ReceiptID: number;
  BoughtOn: string;
  Lines: BillLineInput[];
};

export type BillImportResult = {
  StoryID: number;
  ProductIDs: number[];
  Purchases: number;
};

export function emptyImage(): ImagePath {
  return { Valid: false, String: '' };
}

export function imagePath(s: string | null | undefined): ImagePath {
  if (!s) return emptyImage();
  return { Valid: true, String: s };
}

export function storyStreetLine(c: Story): string {
  let s = `${c.StreetName} ${c.BuildingNumber}`.trim();
  if (c.ApartmentNumber !== '') s += `/${c.ApartmentNumber}`;
  return s;
}

export function storyAddressLine(c: Story): string {
  const street = storyStreetLine(c);
  const loc = `${c.PostalCode} ${c.City}`.trim();
  if (street !== '' && loc !== '') return `${street}, ${loc}`;
  if (street !== '') return street;
  return loc;
}

export function storyLabel(c: Story): string {
  const addr = storyAddressLine(c);
  return addr === '' ? c.Name : `${c.Name} — ${addr}`;
}

export function chainLabel(c: RetailChain): string {
  if (c.LegalName === '' || c.LegalName.toLowerCase() === c.Name.toLowerCase()) return c.Name;
  return `${c.Name} — ${c.LegalName}`;
}

export function aliasScopeValue(a: ProductAlias): string {
  if (a.StoryID > 0) return `story:${a.StoryID}`;
  if (a.RetailChainID > 0) return `chain:${a.RetailChainID}`;
  return '';
}

export function aliasScopeLabel(a: ProductAlias): string {
  if (a.StoryID > 0) return a.StoryName;
  if (a.RetailChainID > 0) return a.RetailChainName;
  return 'any shop';
}

export function receiptStatusLabel(r: Receipt): string {
  switch (r.Status) {
    case RECEIPT_MIGRATED:
      return 'Saved';
    case RECEIPT_READY:
      return 'To confirm';
    case RECEIPT_FAILED:
      return 'Failed';
    default:
      return 'Reading';
  }
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

export function yearlySummaries(purchases: Purchase[]): YearSummary[] {
  const order: string[] = [];
  const byYear = new Map<string, YearSummary>();
  for (const p of purchases) {
    if (p.Kind !== KIND_PURCHASE) continue;
    let year = p.BoughtOn;
    if (year.length >= 4) year = year.slice(0, 4);
    let s = byYear.get(year);
    if (!s) {
      s = { Year: year, Quantity: new Decimal(0), Amount: new Decimal(0) };
      byYear.set(year, s);
      order.push(year);
    }
    s.Quantity = s.Quantity.add(p.Quantity);
    s.Amount = s.Amount.add(p.Amount);
  }
  const seen = new Set<string>();
  const out: YearSummary[] = [];
  for (const y of order) {
    if (seen.has(y)) continue;
    seen.add(y);
    out.push(byYear.get(y)!);
  }
  return out;
}
