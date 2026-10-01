import { z } from 'zod';
import { decimalString } from '../../../../domain/decimal-string.js';

export const AdminReceiptListItemResponse = z.looseObject({
  id: z.number().int(),
  imagePath: z.string().nullable(),
  status: z.string(),
  errorMessage: z.string(),
  createdAt: z.string(),
  boughtOn: z.string(),
  shopName: z.string(),
  statusLabel: z.string(),
  displayDate: z.string(),
});

export const AdminReceiptResponse = z.looseObject({
  id: z.number().int(),
  imagePath: z.string().nullable(),
  status: z.string(),
  errorMessage: z.string(),
  createdAt: z.string(),
  statusLabel: z.string(),
  reading: z.boolean(),
});

export const AdminReceiptsResponse = z.object({
  configured: z.boolean(),
  model: z.string(),
  receipts: z.array(AdminReceiptListItemResponse),
});
export type AdminReceiptsResponse = z.infer<typeof AdminReceiptsResponse>;

export const AdminReceiptDuplicatesResponse = z.object({
  groups: z.array(
    z.object({
      shopName: z.string(),
      boughtOn: z.string(),
      count: z.number().int(),
      receipts: z.array(AdminReceiptListItemResponse),
    }),
  ),
});
export type AdminReceiptDuplicatesResponse = z.infer<typeof AdminReceiptDuplicatesResponse>;

export const AdminReceiptIdResponse = z.object({
  id: z.number().int(),
});
export type AdminReceiptIdResponse = z.infer<typeof AdminReceiptIdResponse>;

const store = z.looseObject({
  id: z.number().int(),
  name: z.string(),
});

export const AdminReceiptStatusResponse = z.object({
  kind: z.literal('status'),
  receipt: AdminReceiptResponse,
});

export const AdminReceiptShowResponse = z.object({
  kind: z.literal('show'),
  receipt: AdminReceiptResponse,
  purchases: z.array(
    z.looseObject({
      id: z.number().int(),
      productId: z.number().int(),
      quantity: decimalString,
      amount: decimalString,
      productName: z.string(),
      unitName: z.string(),
    }),
  ),
  boughtOn: z.string(),
  notes: z.string(),
  store,
  symbol: z.string(),
});

export const AdminReceiptReviewResponse = z.object({
  kind: z.literal('review'),
  view: z.looseObject({}),
  products: z.array(z.looseObject({ id: z.number().int(), name: z.string() })),
  units: z.array(z.looseObject({ id: z.number().int(), name: z.string() })),
  stores: z.array(store),
  symbol: z.string(),
  currency: z.string(),
});

export const AdminReceiptDetailResponse = z.discriminatedUnion('kind', [
  AdminReceiptStatusResponse,
  AdminReceiptShowResponse,
  AdminReceiptReviewResponse,
]);
export type AdminReceiptDetailResponse = z.infer<typeof AdminReceiptDetailResponse>;

export const AdminReceiptEditResponse = z.object({
  receipt: AdminReceiptResponse,
  boughtOn: z.string(),
  store,
  stores: z.array(store),
});
export type AdminReceiptEditResponse = z.infer<typeof AdminReceiptEditResponse>;

export const AdminReceiptConfirmedResponse = z.object({
  id: z.number().int(),
  imported: z.number().int(),
});
export type AdminReceiptConfirmedResponse = z.infer<typeof AdminReceiptConfirmedResponse>;

export const AdminReceiptDeletedResponse = z.object({
  ok: z.literal(true),
});
export type AdminReceiptDeletedResponse = z.infer<typeof AdminReceiptDeletedResponse>;
