import { z } from 'zod';

export const Id = z.coerce.number().int().positive();

export const ReceiptVisitRequest = z.object({
  bought_on: z.string().trim(),
  store_id: z.number().int(),
});

export const ReceiptFormRequest = z.record(z.string(), z.string());
