import Decimal from 'decimal.js';
import type { Story } from '../locations/locations.models';

export const RECEIPT_PENDING = 'pending';
export const RECEIPT_READY = 'ready';
export const RECEIPT_FAILED = 'failed';
export const RECEIPT_MIGRATED = 'migrated';

export const RECEIPT_SOURCE_OCR = 'ocr';
export const RECEIPT_SOURCE_BIEDRONKA = 'biedronka';

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
