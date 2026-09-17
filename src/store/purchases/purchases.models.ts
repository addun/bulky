import { Decimal } from 'decimal.js';

export const KIND_PURCHASE = 'purchase';
export const KIND_PRICE = 'price';
export type PurchaseKind = typeof KIND_PURCHASE | typeof KIND_PRICE;

export type Purchase = {
  id: number;
  productId: number;
  storyId: number | null;
  kind: PurchaseKind;
  receiptId: number | null;
  boughtOn: string;
  quantity: Decimal;
  amount: Decimal;
  createdAt: string;
};

export type ReceiptPurchase = Purchase & {
  productName: string;
  unitName: string;
  imagePath: string | null;
};
