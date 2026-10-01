import { z } from 'zod';
import { biedronkaImportReceipt } from '../imports/biedronka.schema.js';

/** One HTML/query field: missing, scalar, or first of a repeated field, then trimmed. */
const field = z.preprocess((v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v[0] == null ? '' : String(v[0]);
  return String(v);
}, z.string().trim());

export function formIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.';
}

/** Positive integer from a route param. Invalid values fail the pipe. */
export const id = z.coerce.number().int().positive();

export const qQuery = z.object({ q: field });

export const biedronkaTxId = z
  .string()
  .trim()
  .min(1, 'invalid id')
  .max(128, 'invalid id')
  .regex(/^[\p{L}\p{N}_-]+$/u, 'invalid id');

export const biedronkaPageQuery = z.object({
  page: field
    .transform((s) => Number.parseInt(s === '' ? '1' : s, 10))
    .pipe(z.number({ error: 'invalid page' }).int({ error: 'invalid page' }).positive('invalid page')),
  archived: field.transform((s) => s === '1' || s === 'true'),
});

export const biedronkaImportBody = z.object({
  id: field.pipe(biedronkaTxId),
  date: field,
  store_name: field,
  receipt_num: field,
  total_price: z.coerce.number().catch(0),
  receipt: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (s === '') return v;
    try {
      return JSON.parse(s);
    } catch {
      return v;
    }
  }, biedronkaImportReceipt),
});

export const biedronkaTokenBody = z
  .object({
    grant_type: field.transform((v) => v || 'refresh_token'),
    refresh_token: field,
    code: field,
    code_verifier: field,
  })
  .superRefine((val, ctx) => {
    if (val.grant_type === 'refresh_token' && val.refresh_token === '') {
      ctx.addIssue({ code: 'custom', path: ['refresh_token'], message: 'refresh_token is required' });
    }
    if (val.grant_type === 'authorization_code' && val.code_verifier === '') {
      ctx.addIssue({ code: 'custom', path: ['code_verifier'], message: 'code_verifier is required' });
    }
    if (val.grant_type !== 'refresh_token' && val.grant_type !== 'authorization_code') {
      ctx.addIssue({ code: 'custom', path: ['grant_type'], message: 'unsupported grant' });
    }
  });

export type QQuery = z.infer<typeof qQuery>;
