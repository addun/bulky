import { z } from 'zod';

export const AdminComparisonGroupResponse = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  unitId: z.number().int(),
  unitName: z.string(),
  createdAt: z.string(),
  productCount: z.number().int(),
});
export type AdminComparisonGroupResponse = z.infer<typeof AdminComparisonGroupResponse>;

export const AdminComparisonGroupsResponse = z.object({
  groups: z.array(AdminComparisonGroupResponse),
});
export type AdminComparisonGroupsResponse = z.infer<typeof AdminComparisonGroupsResponse>;

export const AdminComparisonGroupFormResponse = z.object({
  group: AdminComparisonGroupResponse,
  units: z.array(z.looseObject({ id: z.number().int(), name: z.string(), compareValue: z.string() })),
  products: z.array(z.looseObject({ id: z.number().int(), name: z.string(), selected: z.boolean() })),
});
export type AdminComparisonGroupFormResponse = z.infer<typeof AdminComparisonGroupFormResponse>;

export const AdminComparisonGroupDeletedResponse = z.object({
  ok: z.literal(true),
  name: z.string(),
});
export type AdminComparisonGroupDeletedResponse = z.infer<typeof AdminComparisonGroupDeletedResponse>;
