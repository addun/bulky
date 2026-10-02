import { z } from 'zod';

export const envSchema = z.object({
  DATA_DIR: z.string().default('./data'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.string().default('8080'),
  CURRENCY: z.string().default('PLN'),
  CURRENCY_SYMBOL: z.string().default('zł'),
  OCR_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  OCR_BASE_URL: z.string().optional().default(''),
  TZ: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

