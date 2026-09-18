import { z } from 'zod';

const money = z.number();
const nullableId = z.union([z.string(), z.number()]).nullable();

/** Store block on GET /transactions/:id/. */
export const biedronkaStore = z.object({
  street: z.string(),
  zip_code: z.string(),
  city: z.string(),
});

/** Line item on GET /transactions/:id/. `position` is a string; `quantity` may be fractional (KG). */
export const biedronkaReceiptItem = z.object({
  position: z.string(),
  name: z.string(),
  quantity: money,
  unit_price: money,
  total_discount: money,
  total_price_without_discount: money,
  total_price: money,
  ean: z.string(),
  vat_rate: money,
  vat_fiscal_code: z.string(),
  measure_unit: z.string(),
});

export const biedronkaPayment = z.object({
  payment_type: z.string(),
  name: z.string(),
  value: money,
  guid: z.string(),
});

export const biedronkaTaxSummary = z.object({
  vat_rate: money,
  sale_value: money,
  tax_value: money,
  vat_fiscal_code: z.string(),
});

/** Body of GET /api/v7/transactions/:id/. */
export const biedronkaReceipt = z.object({
  id: z.string(),
  date: z.string(),
  total_price: money,
  store_name: z.string(),
  receipt_num: z.string(),
  is_e_receipt_available: z.boolean(),
  total_discount: money,
  store_id: z.string(),
  cash_register_id: z.number().int(),
  id_from_receipt: z.string(),
  cashier_id: nullableId,
  basket_id: nullableId,
  invoice_id: nullableId,
  total_tax: money,
  due_change: money,
  store: biedronkaStore,
  items: z.array(biedronkaReceiptItem),
  payments: z.array(biedronkaPayment),
  tax_summaries: z.array(biedronkaTaxSummary),
  receipt_barcode: z.string(),
  extended_transaction_number: z.string(),
  collected_returnable_packagings_value: money,
  sold_returnable_packagings_value: money,
  payment_rounding: money.nullable(),
});

/** Flattened sell line from `public/biedronka.js` (`sellLines`). */
export const biedronkaSellLine = z.object({
  name: z.string(),
  price: money,
  total: money,
  quantity: money,
});

/** List transaction plus optional details fetched by the Biedronka import page. */
export const biedronkaTransaction = z.object({
  id: z.string(),
  date: z.string(),
  total_price: money,
  store_name: z.string(),
  receipt_num: z.string(),
  is_e_receipt_available: z.boolean(),
  receipt: biedronkaReceipt.optional(),
  source: z.enum(['details']).optional(),
  lines: z.array(biedronkaSellLine).optional(),
  receipt_error: z.string().optional(),
});

/** JSON downloaded from the Biedronka import page (`lastPayload`). */
export const biedronkaDump = z.object({
  fetched_at: z.string(),
  since: z.string(),
  via: z.enum(['proxy', 'browser']),
  transactions: z.array(biedronkaTransaction),
});

/**
 * POST /api/biedronka/import `receipt`: transaction details object
 * (or a wrapper / till JSON dump).
 */
export const biedronkaImportReceipt = z.union([
  biedronkaReceipt.loose(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export type BiedronkaStore = z.infer<typeof biedronkaStore>;
export type BiedronkaReceiptItem = z.infer<typeof biedronkaReceiptItem>;
export type BiedronkaPayment = z.infer<typeof biedronkaPayment>;
export type BiedronkaTaxSummary = z.infer<typeof biedronkaTaxSummary>;
export type BiedronkaReceipt = z.infer<typeof biedronkaReceipt>;
export type BiedronkaSellLine = z.infer<typeof biedronkaSellLine>;
export type BiedronkaTransaction = z.infer<typeof biedronkaTransaction>;
export type BiedronkaDump = z.infer<typeof biedronkaDump>;
export type BiedronkaTx = Pick<BiedronkaTransaction, 'id' | 'date' | 'store_name' | 'receipt_num' | 'total_price'>;

const nullableText = z.string().nullable();
const nullableCoord = z.number().finite().nullable();

/** One shop from GET https://moja.biedronka.pl/sklepy */
export const biedronkaShop = z.object({
  name: z.string(),
  searchName: z.string(),
  city: nullableText,
  street: nullableText,
  streetNr: nullableText,
  hours: nullableText,
  hoursSat: nullableText,
  hoursSun: nullableText,
  lat: nullableCoord,
  lng: nullableCoord,
  shopNr: z.number().int(),
});

export const biedronkaShopsResponse = z.object({
  success: z.boolean(),
  data: z.array(biedronkaShop),
});

export type BiedronkaShop = z.infer<typeof biedronkaShop>;
export type BiedronkaShopsResponse = z.infer<typeof biedronkaShopsResponse>;
