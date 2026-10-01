import { Decimal } from 'decimal.js';
import { z } from 'zod';

const decimalInput = z.union([z.string(), z.custom<Decimal>((value) => Decimal.isDecimal(value))]);

/** Amounts are `Decimal` in the app and strings in JSON. */
export const decimalString = z.codec(decimalInput, z.string(), {
  decode: (value) => (typeof value === 'string' ? value : value.toString()),
  encode: (value) => new Decimal(value),
});
