import { Decimal } from 'decimal.js';
import { combineBoughtOn } from '../../domain/bought-on.js';
import type { Store } from '../locations/locations.models.js';

export const RECEIPT_PENDING = 'pending';
export const RECEIPT_READY = 'ready';
export const RECEIPT_FAILED = 'failed';
export const RECEIPT_MIGRATED = 'migrated';

export const RECEIPT_SOURCE_OCR = 'ocr';
export const RECEIPT_SOURCE_BIEDRONKA = 'biedronka';

export type Receipt = {
  id: number;
  imagePath: string | null;
  rawResponse: string;
  status: string;
  errorMessage: string;
  createdAt: string;
  source: string;
  externalId: string;
  sourcePayload: string;
};

export type ReceiptListItem = {
  id: number;
  imagePath: string | null;
  status: string;
  errorMessage: string;
  createdAt: string;
  boughtOn: string;
  shopName: string;
};

export type ReceiptVisitRow = ReceiptListItem & {
  shopId: number;
  boughtAt: string;
};

export type ReceiptDuplicateGroup = {
  shopName: string;
  boughtOn: string;
  receipts: ReceiptListItem[];
};

export function duplicateReceiptGroups(rows: ReceiptVisitRow[]): ReceiptDuplicateGroup[] {
  const groups = new Map<string, ReceiptDuplicateGroup>();
  for (const row of rows) {
    const boughtOn = combineBoughtOn(row.boughtOn, row.boughtAt);
    if (boughtOn === '') continue;
    const shopId = row.shopId > 0 ? row.shopId : 0;
    const shopName = row.shopName.trim();
    if (shopId === 0 && shopName === '') continue;
    const key = `${shopId > 0 ? `id:${shopId}` : `name:${shopName.toLowerCase()}`}\0${boughtOn}`;
    const receipt: ReceiptListItem = {
      id: row.id,
      imagePath: row.imagePath,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      boughtOn,
      shopName,
    };
    const existing = groups.get(key);
    if (existing) {
      existing.receipts.push(receipt);
      if (existing.shopName === '' && shopName !== '') existing.shopName = shopName;
    } else {
      groups.set(key, { shopName, boughtOn, receipts: [receipt] });
    }
  }
  return [...groups.values()]
    .filter((g) => g.receipts.length >= 2)
    .map((g) => ({
      ...g,
      receipts: [...g.receipts].sort((a, b) => b.id - a.id),
    }))
    .sort(
      (a, b) =>
        b.boughtOn.localeCompare(a.boughtOn) ||
        a.shopName.localeCompare(b.shopName) ||
        b.receipts[0]!.id - a.receipts[0]!.id,
    );
}

export type BillLineInput = {
  productId: number;
  productName: string;
  receiptName: string;
  unitId: number;
  quantity: Decimal;
  amount: Decimal;
  ean: string;
};

export type BillImport = {
  storeId: number | null;
  store: Store | null;
  receiptId: number | null;
  boughtOn: string;
  lines: BillLineInput[];
};

export type BillImportResult = {
  storeId: number | null;
  productIds: number[];
  purchases: number;
};

export function receiptStatusLabel(r: { status: string }): string {
  switch (r.status) {
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
