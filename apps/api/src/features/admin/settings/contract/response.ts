import { z } from 'zod';
import { decimalString } from '../../../../domain/decimal-string.js';

export const AdminSettingsUnitResponse = z.object({
  id: z.number().int(),
  name: z.string(),
  compareValue: decimalString,
  productCount: z.number().int(),
});
export type AdminSettingsUnitResponse = z.infer<typeof AdminSettingsUnitResponse>;

export const AdminSettingsDefaultsResponse = z.object({
  pieceId: z.number().int().nullable(),
  weightId: z.number().int().nullable(),
});
export type AdminSettingsDefaultsResponse = z.infer<typeof AdminSettingsDefaultsResponse>;

export const AdminSettingsResponse = z.object({
  ocrModel: z.string(),
  units: z.array(AdminSettingsUnitResponse),
  defaults: AdminSettingsDefaultsResponse,
});
export type AdminSettingsResponse = z.infer<typeof AdminSettingsResponse>;
