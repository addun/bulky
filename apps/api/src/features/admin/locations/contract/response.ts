import { z } from 'zod';

export const AdminChainResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  legalName: z.string(),
  taxId: z.string(),
  storeCount: z.number().int(),
  label: z.string(),
});
export type AdminChainResponse = z.infer<typeof AdminChainResponse>;

export const AdminChainsResponse = z.object({
  retailChains: z.array(AdminChainResponse),
});
export type AdminChainsResponse = z.infer<typeof AdminChainsResponse>;

export const AdminStoreResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  streetName: z.string(),
  buildingNumber: z.string(),
  apartmentNumber: z.string(),
  postalCode: z.string(),
  city: z.string(),
  externalId: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  retailChainId: z.number().int().nullable(),
  retailChainName: z.string(),
  purchaseCount: z.number().int(),
  label: z.string(),
  streetLine: z.string(),
  addressLine: z.string(),
});
export type AdminStoreResponse = z.infer<typeof AdminStoreResponse>;

export const AdminStoresResponse = z.object({
  stores: z.array(AdminStoreResponse),
});
export type AdminStoresResponse = z.infer<typeof AdminStoresResponse>;

export const AdminNewStoreResponse = z.object({
  store: AdminStoreResponse,
  retailChains: z.array(AdminChainResponse),
  next: z.string(),
});
export type AdminNewStoreResponse = z.infer<typeof AdminNewStoreResponse>;

export const AdminStoreFormResponse = z.object({
  store: AdminStoreResponse,
  retailChains: z.array(AdminChainResponse),
});
export type AdminStoreFormResponse = z.infer<typeof AdminStoreFormResponse>;

export const AdminCreatedStoreResponse = AdminStoreResponse.and(z.object({ next: z.string() }));
export type AdminCreatedStoreResponse = z.infer<typeof AdminCreatedStoreResponse>;

export const AdminStoreMergeOptionsResponse = z.object({
  store: AdminStoreResponse,
  targets: z.array(AdminStoreResponse),
});
export type AdminStoreMergeOptionsResponse = z.infer<typeof AdminStoreMergeOptionsResponse>;

export const AdminStoreMergePlanResponse = z.object({
  plan: z.looseObject({
    into: AdminStoreResponse,
    from: AdminStoreResponse,
    history: z.number().int(),
    aliases: z.number().int(),
    takeCode: z.boolean(),
    takeCoords: z.boolean(),
    takeChain: z.boolean(),
  }),
});
export type AdminStoreMergePlanResponse = z.infer<typeof AdminStoreMergePlanResponse>;

export const AdminStoreMergedResponse = z.object({
  id: z.number().int(),
});
export type AdminStoreMergedResponse = z.infer<typeof AdminStoreMergedResponse>;

export const AdminOkResponse = z.object({
  ok: z.literal(true),
});
export type AdminOkResponse = z.infer<typeof AdminOkResponse>;
