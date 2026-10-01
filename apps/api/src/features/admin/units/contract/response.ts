import { z } from 'zod';

export const AdminUnitResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  compareValue: z.string(),
  productCount: z.number().int(),
});
export type AdminUnitResponse = z.infer<typeof AdminUnitResponse>;

export const AdminUnitsResponse = z.object({
  units: z.array(AdminUnitResponse),
});
export type AdminUnitsResponse = z.infer<typeof AdminUnitsResponse>;

export const AdminOkResponse = z.object({
  ok: z.literal(true),
});
export type AdminOkResponse = z.infer<typeof AdminOkResponse>;
