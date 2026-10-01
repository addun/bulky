import { z } from 'zod';
import { decimalString } from '../../../../domain/decimal-string.js';

export const AdminCatalogProductResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  ean: z.string(),
  unitId: z.number().int(),
  unitName: z.string(),
  compareValue: decimalString,
  imagePath: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminCatalogProductResponse = z.infer<typeof AdminCatalogProductResponse>;

export const AdminCatalogUnitResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  compareValue: decimalString,
});

export const AdminCatalogGroupResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  unitId: z.number().int(),
  unitName: z.string(),
});

export const AdminCatalogPurchaseResponse = z.looseObject({
  id: z.number().int(),
  productId: z.number().int(),
  storeId: z.number().int().nullable(),
  kind: z.string(),
  receiptId: z.number().int().nullable(),
  boughtOn: z.string(),
  quantity: decimalString,
  amount: decimalString,
  createdAt: z.string(),
});
export type AdminCatalogPurchaseResponse = z.infer<typeof AdminCatalogPurchaseResponse>;

export const AdminCatalogStoreResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
});

export const AdminCatalogBlankResponse = z.object({
  product: AdminCatalogProductResponse,
  units: z.array(AdminCatalogUnitResponse),
  groups: z.array(AdminCatalogGroupResponse),
});
export type AdminCatalogBlankResponse = z.infer<typeof AdminCatalogBlankResponse>;

export const AdminCatalogShowResponse = z.object({
  product: AdminCatalogProductResponse,
  purchases: z.array(AdminCatalogPurchaseResponse),
  storeById: z.record(z.string(), AdminCatalogStoreResponse),
  groups: z.array(AdminCatalogGroupResponse),
  symbol: z.string(),
});
export type AdminCatalogShowResponse = z.infer<typeof AdminCatalogShowResponse>;

export const AdminCatalogIdResponse = z.object({
  id: z.number().int(),
});
export type AdminCatalogIdResponse = z.infer<typeof AdminCatalogIdResponse>;

export const AdminCatalogOkResponse = z.object({
  ok: z.literal(true),
});
export type AdminCatalogOkResponse = z.infer<typeof AdminCatalogOkResponse>;

export const AdminCatalogChangeUnitResponse = z.object({
  product: AdminCatalogProductResponse,
  history: z.number().int(),
});
export type AdminCatalogChangeUnitResponse = z.infer<typeof AdminCatalogChangeUnitResponse>;

export const AdminCatalogMergeOptionsResponse = z.object({
  product: AdminCatalogProductResponse,
  targets: z.array(AdminCatalogProductResponse),
});
export type AdminCatalogMergeOptionsResponse = z.infer<typeof AdminCatalogMergeOptionsResponse>;

export const AdminCatalogMergePlanResponse = z.object({
  plan: z.looseObject({
    into: AdminCatalogProductResponse,
    from: AdminCatalogProductResponse,
    history: z.number().int(),
    aliases: z.number().int(),
    nameAsAlias: z.string(),
    takePhoto: z.boolean(),
  }),
});
export type AdminCatalogMergePlanResponse = z.infer<typeof AdminCatalogMergePlanResponse>;

export const AdminCatalogPurchaseFormResponse = z.object({
  product: AdminCatalogProductResponse,
  purchase: AdminCatalogPurchaseResponse,
  stores: z.array(AdminCatalogStoreResponse),
  symbol: z.string(),
  currency: z.string(),
});
export type AdminCatalogPurchaseFormResponse = z.infer<typeof AdminCatalogPurchaseFormResponse>;

export const AdminCatalogPurchaseUpdatedResponse = z.object({
  id: z.number().int(),
  productId: z.number().int(),
});
export type AdminCatalogPurchaseUpdatedResponse = z.infer<typeof AdminCatalogPurchaseUpdatedResponse>;

export const AdminCatalogPurchaseDeletedResponse = z.object({
  productId: z.number().int(),
  kind: z.string(),
});
export type AdminCatalogPurchaseDeletedResponse = z.infer<typeof AdminCatalogPurchaseDeletedResponse>;
