import Decimal from 'decimal.js';
import type { Story } from '../locations/locations.models';

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
  storyId: number | null;
  story: Story | null;
  receiptId: number | null;
  boughtOn: string;
  lines: BillLineInput[];
};

export type BillImportResult = {
  storyId: number | null;
  productIds: number[];
  purchases: number;
};

export function receiptStatusLabel(r: Receipt): string {
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
