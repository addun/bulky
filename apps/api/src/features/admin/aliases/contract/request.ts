import { z } from 'zod';
import { stripAliasWhitespace } from '#app/store/aliases';

export const Id = z.coerce.number().int().positive();

export const ProductRefRequest = z.object({
  product: z.coerce.number().int().nonnegative().default(0),
  error: z.string().trim().default(''),
});

export const AliasRequest = z.object({
  product_id: z.number().int().positive('Choose a product.'),
  scope: z.string().trim(),
  alias: z
    .string()
    .trim()
    .min(1, 'Alias is required.')
    .transform(stripAliasWhitespace)
    .pipe(z.string().min(1, 'Alias is required.')),
});
