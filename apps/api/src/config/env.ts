import { z } from 'zod';

export const envSchema = z.object({
  DATA_DIR: z.string().default('./data'),
  ADDR: z.string().default(':8080'),
  CURRENCY: z.string().default('PLN'),
  CURRENCY_SYMBOL: z.string().default('zł'),
  OCR_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  OCR_BASE_URL: z.string().optional().default(''),
  TZ: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function parseListenAddr(addr: string): { host: string; port: number } {
  const trimmed = addr.trim() || ':8080';
  if (trimmed.startsWith(':')) {
    return { host: '0.0.0.0', port: Number(trimmed.slice(1)) || 8080 };
  }
  const idx = trimmed.lastIndexOf(':');
  if (idx === -1) {
    return { host: '0.0.0.0', port: Number(trimmed) || 8080 };
  }
  return {
    host: trimmed.slice(0, idx) || '0.0.0.0',
    port: Number(trimmed.slice(idx + 1)) || 8080,
  };
}

