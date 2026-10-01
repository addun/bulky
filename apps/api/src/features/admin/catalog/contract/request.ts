import { z } from 'zod';

const formTexts = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((value) => {
    if (value == null) return [];
    const items = Array.isArray(value) ? value : [value];
    return items.map((item) => item.trim());
  });

const formIds = z
  .union([z.array(z.coerce.number().int().positive()), z.coerce.number().int().positive()])
  .optional()
  .transform((value) => (value == null ? [] : Array.isArray(value) ? value : [value]));

export const Id = z.coerce.number().int().positive();

export const ProductRequest = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  unit_id: z.coerce.number().int().positive('Choose a unit.'),
  ean: z.string().trim().default(''),
  group_id: formIds,
  clear_image: z.string().trim().default(''),
  extra_unit_id: formTexts,
  extra_factor: formTexts,
});

export const UnitIdRequest = z.object({
  unit_id: z.number().int().positive('Choose one of the extra units on this product.'),
});

export const MergeRequest = z.object({
  into_id: z.number().int().positive('Choose a product.'),
});

export const PurchaseRequest = z.object({
  store_id: z.number().int(),
  kind: z.string().trim(),
  bought_on: z.string().trim(),
  amount: z.string().trim(),
  quantity: z.string().trim(),
});
