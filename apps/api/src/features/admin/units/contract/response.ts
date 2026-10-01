import { z } from 'zod';
import { decimalString } from '../../../../domain/decimal-string.js';

export const AdminUnitResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  compareValue: decimalString,
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
