import { z } from 'zod';

const queryText = z.preprocess((value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null) return '';
  return String(raw);
}, z.string().trim());

const coord = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label} must be a number between ${min} and ${max}.` })
    .min(min, `${label} must be a number between ${min} and ${max}.`)
    .max(max, `${label} must be a number between ${min} and ${max}.`)
    .nullable();

export const Id = z.coerce.number().int().positive();

export const NewStoreRequest = z
  .object({
    next: queryText.optional(),
  })
  .catchall(z.unknown())
  .transform((query) => {
    const nested =
      query.prefill && typeof query.prefill === 'object' && !Array.isArray(query.prefill)
        ? (query.prefill as Record<string, unknown>)
        : {};
    const pick = (key: string) => queryText.parse(nested[key] ?? query[`prefill[${key}]`]);
    return {
      next: queryText.parse(query.next),
      name: pick('name'),
      street_name: pick('street_name'),
      building_number: pick('building_number'),
      apartment_number: pick('apartment_number'),
      postal_code: pick('postal_code'),
      city: pick('city'),
      external_id: pick('external_id'),
    };
  });

export const RetailChainRequest = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  legal_name: z.string().trim().min(1, 'Legal name is required.'),
  tax_id: z
    .string()
    .trim()
    .min(1, 'Tax ID is required.')
    .refine((s) => /[\p{L}\p{N}]/u.test(s), 'Tax ID is required.'),
});

export const StoreRequest = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  street_name: z.string().trim().min(1, 'Street name is required.'),
  building_number: z.string().trim().min(1, 'Building number is required.'),
  apartment_number: z.string().trim(),
  postal_code: z.string().trim().min(1, 'Postal code is required.'),
  city: z.string().trim().min(1, 'City is required.'),
  external_id: z.string().trim(),
  lat: coord('Latitude', -90, 90),
  lng: coord('Longitude', -180, 180),
  next: z.string().trim(),
  retail_chain_id: z.number().int(),
});

export const StoreMergeRequest = z.object({
  into_id: z.number().int().positive('Choose a store.'),
});
