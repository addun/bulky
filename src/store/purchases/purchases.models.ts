import Decimal from 'decimal.js';
import type { ImagePath } from '../products/products.models';

export const KIND_PURCHASE = 'purchase';
export const KIND_PRICE = 'price';
export type PurchaseKind = typeof KIND_PURCHASE | typeof KIND_PRICE;

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
