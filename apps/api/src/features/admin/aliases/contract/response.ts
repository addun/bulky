import { z } from 'zod';

const product = z.looseObject({
  id: z.number().int(),
  name: z.string(),
});

export const AdminAliasResponse = z.looseObject({
  id: z.number().int(),
  productId: z.number().int(),
  productName: z.string(),
  storeId: z.number().int().nullable(),
  storeName: z.string(),
  retailChainId: z.number().int().nullable(),
  retailChainName: z.string(),
  alias: z.string(),
  scopeLabel: z.string(),
  scopeValue: z.string(),
});
export type AdminAliasResponse = z.infer<typeof AdminAliasResponse>;

export const AdminAliasesResponse = z.object({
  aliases: z.array(AdminAliasResponse),
  filter: product.nullable(),
  productQuery: z.string(),
});
export type AdminAliasesResponse = z.infer<typeof AdminAliasesResponse>;

export const AdminAliasFormResponse = z.object({
  products: z.array(product),
  stores: z.array(z.looseObject({ id: z.number().int(), name: z.string() })),
  chains: z.array(z.looseObject({ id: z.number().int(), name: z.string() })),
  alias: AdminAliasResponse,
  lockedProduct: product.nullable(),
  fromProduct: z.number().int(),
});
export type AdminAliasFormResponse = z.infer<typeof AdminAliasFormResponse>;

export const AdminAliasDeletedResponse = z.object({
  ok: z.literal(true),
  alias: z.string(),
});
export type AdminAliasDeletedResponse = z.infer<typeof AdminAliasDeletedResponse>;
