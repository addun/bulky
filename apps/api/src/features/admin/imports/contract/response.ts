import { z } from 'zod';

const chain = z.looseObject({
  id: z.number().int(),
  name: z.string(),
});

export const AdminImportsResponse = z.object({
  importers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      href: z.string(),
    }),
  ),
});
export type AdminImportsResponse = z.infer<typeof AdminImportsResponse>;

export const AdminBiedronkaImportResponse = z.object({
  retailChains: z.array(chain),
  retailChainId: z.number().int(),
});
export type AdminBiedronkaImportResponse = z.infer<typeof AdminBiedronkaImportResponse>;

export const AdminBiedronkaImportedResponse = z.object({
  retailChainId: z.number().int(),
  result: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    skipped: z.number().int(),
    total: z.number().int(),
  }),
});
export type AdminBiedronkaImportedResponse = z.infer<typeof AdminBiedronkaImportedResponse>;
