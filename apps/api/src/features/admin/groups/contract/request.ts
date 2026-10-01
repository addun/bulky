import { z } from 'zod';

export const Id = z.coerce.number().int().positive();

export const ComparisonGroupRequest = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  unit_id: z.number().int().positive('Choose a comparison unit.'),
  product_id: z.array(z.number().int().positive()),
});
