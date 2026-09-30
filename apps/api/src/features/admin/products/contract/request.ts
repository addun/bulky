import { z } from 'zod';

const ADMIN_PAGE_SIZE = 40;
const ADMIN_PAGE_MAX = 100;

export const GetAdminProductsRequest = z.object({
  q: z.string().trim().default(''),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(ADMIN_PAGE_MAX).default(ADMIN_PAGE_SIZE),
});
