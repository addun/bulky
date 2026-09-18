import { z } from 'zod';
import { biedronkaImportReceipt } from '../imports/biedronka.schema.js';

/** One HTML/query field: missing, scalar, or first of a repeated field, then trimmed. */
const field = z.preprocess((v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v[0] == null ? '' : String(v[0]);
  return String(v);
}, z.string().trim());

const optInt = field.transform((s) => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}).pipe(z.number().int());

const ids = z.preprocess((v) => {
  const arr = v == null ? [] : Array.isArray(v) ? v : [v];
  return arr.map(String).filter((s) => s.trim() !== '');
}, z.array(z.coerce.number().int().positive()));

const strs = z.preprocess((v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((item) => String(item).trim());
  return [String(v).trim()];
}, z.array(z.string()));

export function formIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.';
}

/** Positive integer from a route param. Invalid values fail the pipe. */
export const id = z.coerce.number().int().positive();

export const qQuery = z.object({ q: field });

export const flashQuery = z.object({ error: field });

export const adminIndexQuery = z.object({
  q: field,
  error: field,
  imported: optInt,
});

export const productRefQuery = z.object({
  product: optInt,
  error: field,
});

export const mergeQuery = z.object({ into_id: optInt });

export const mergeParams = z.object({
  id,
  into: optInt,
});

export const newStoreQuery = z
  .object({ next: field })
  .catchall(z.unknown())
  .transform((q) => {
    const nested =
      q.prefill && typeof q.prefill === 'object' && !Array.isArray(q.prefill)
        ? (q.prefill as Record<string, unknown>)
        : {};
    const pick = (key: string) => field.parse(nested[key] ?? q[`prefill[${key}]`]);
    return {
      next: q.next,
      name: pick('name'),
      street_name: pick('street_name'),
      building_number: pick('building_number'),
      apartment_number: pick('apartment_number'),
      postal_code: pick('postal_code'),
      city: pick('city'),
      external_id: pick('external_id'),
    };
  });

export const receiptShowQuery = z.object({
  error: field,
  imported: optInt,
});

export const nameFields = z.object({
  name: field,
});

export const nameForm = z.object({
  name: field.pipe(z.string().min(1, 'Name is required.')),
});

export const settingsForm = z.object({
  ocr_model: field.pipe(z.string().min(1, 'AI model is required.')),
  piece_unit_id: field
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().positive('Choose a unit from the list.')),
  weight_unit_id: field
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().positive('Choose a unit from the list.')),
});

export const retailChainFields = z.object({
  name: field,
  legal_name: field,
  tax_id: field,
});

export const retailChainForm = z.object({
  name: field.pipe(z.string().min(1, 'Name is required.')),
  legal_name: field.pipe(z.string().min(1, 'Legal name is required.')),
  tax_id: field.pipe(
    z.string().min(1, 'Tax ID is required.').refine((s) => /[\p{L}\p{N}]/u.test(s), 'Tax ID is required.'),
  ),
});

const optCoord = (label: string, min: number, max: number) =>
  field.superRefine((s, ctx) => {
    if (s === '') return;
    const n = Number.parseFloat(s.replace(',', '.'));
    if (!Number.isFinite(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: `${label} must be a number between ${min} and ${max}.` });
    }
  }).transform((s): number | null => {
    if (s === '') return null;
    return Number.parseFloat(s.replace(',', '.'));
  });

export const storeFields = z.object({
  name: field,
  street_name: field,
  building_number: field,
  apartment_number: field,
  postal_code: field,
  city: field,
  external_id: field,
  lat: field,
  lng: field,
  next: field,
  retail_chain_id: optInt,
});

export const storeForm = z.object({
  name: field.pipe(z.string().min(1, 'Name is required.')),
  street_name: field.pipe(z.string().min(1, 'Street name is required.')),
  building_number: field.pipe(z.string().min(1, 'Building number is required.')),
  apartment_number: field,
  postal_code: field.pipe(z.string().min(1, 'Postal code is required.')),
  city: field.pipe(z.string().min(1, 'City is required.')),
  external_id: field,
  lat: optCoord('Latitude', -90, 90),
  lng: optCoord('Longitude', -180, 180),
  next: field,
  retail_chain_id: optInt,
});

export const aliasFields = z.object({
  product_id: optInt,
  from_product: optInt,
  scope: field,
  alias: field,
});

export const aliasForm = z.object({
  product_id: field
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().positive('Choose a product.')),
  from_product: optInt,
  scope: field,
  alias: field.pipe(z.string().min(1, 'Alias is required.')),
});

export const comparisonGroupFields = z.object({
  name: field,
  unit_id: optInt,
  product_id: ids,
});

export const comparisonGroupForm = z.object({
  name: field.pipe(z.string().min(1, 'Name is required.')),
  unit_id: field
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().positive('Choose a comparison unit.')),
  product_id: ids,
});

export const productFields = z.object({
  name: field,
  unit_id: optInt,
  ean: field,
  group_id: ids,
  clear_image: field,
  extra_unit_id: strs,
  extra_factor: strs,
});

export const productForm = z.object({
  name: field.pipe(z.string().min(1, 'Name is required.')),
  unit_id: field
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().positive('Choose a unit.')),
  ean: field,
  group_id: ids,
  clear_image: field,
  extra_unit_id: strs,
  extra_factor: strs,
});

export const unitIdForm = z.object({
  unit_id: field
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().positive('Choose one of the extra units on this product.')),
});

export const mergeForm = z.object({
  into_id: field
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().positive('Choose a product.')),
});

export const purchaseForm = z.object({
  store_id: optInt,
  kind: field,
  bought_on: field,
  amount: field,
  quantity: field,
});

export const receiptVisitForm = z.object({
  bought_on: field,
  store_id: optInt,
});

export const formBody = z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.record(z.string(), z.unknown()));

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
});

export const biedronkaFormatQuery = z.object({
  format: field
    .transform((raw) => (raw === '' ? 'json' : raw.toLowerCase()))
    .pipe(z.enum(['json', 'pdf'], { error: 'invalid format' })),
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

export { field, optInt };

export type QQuery = z.infer<typeof qQuery>;
export type NameForm = z.infer<typeof nameForm>;
export type SettingsForm = z.infer<typeof settingsForm>;
export type RetailChainForm = z.infer<typeof retailChainForm>;
export type StoreForm = z.infer<typeof storeForm>;
export type StoreFields = z.infer<typeof storeFields>;
export type AliasForm = z.infer<typeof aliasForm>;
export type AliasFields = z.infer<typeof aliasFields>;
export type ComparisonGroupForm = z.infer<typeof comparisonGroupForm>;
export type ProductForm = z.infer<typeof productForm>;
export type ProductFields = z.infer<typeof productFields>;
export type PurchaseForm = z.infer<typeof purchaseForm>;
export type ReceiptVisitForm = z.infer<typeof receiptVisitForm>;
export type MergeParams = z.infer<typeof mergeParams>;
export type NewStoreQuery = z.infer<typeof newStoreQuery>;
