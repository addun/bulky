import Decimal from 'decimal.js';
import hbs from 'hbs';
import { extraQuotes } from '../domain/price-stats';
import { formatBoughtOn, boughtOnDate, boughtOnTime } from '../domain/bought-on';
import { formatMoney, formatQuantity } from '../domain/format';
import type { Product, ProductConversion } from '@app/store/products';
import type { QuotedPrice } from '../domain/price-stats';

let currencySymbol = 'zł';

export function setCurrencySymbol(symbol: string): void {
  currencySymbol = symbol;
}

export function registerHandlebarsHelpers(): void {
  hbs.registerHelper('gt', (a: number, b: number) => Number(a) > Number(b));
  hbs.registerHelper('eq', (a: unknown, b: unknown) => String(a) === String(b));
  hbs.registerHelper('ne', (a: unknown, b: unknown) => String(a) !== String(b));
  hbs.registerHelper('and', (...args: unknown[]) => {
    args.pop();
    return args.every((v) => Boolean(v));
  });
  hbs.registerHelper('or', (...args: unknown[]) => {
    args.pop();
    return args.some((v) => Boolean(v));
  });
  hbs.registerHelper('not', (v: unknown) => !v);
  hbs.registerHelper('len', (v: unknown) => (Array.isArray(v) ? v.length : 0));
  hbs.registerHelper('print', (...args: unknown[]) => {
    args.pop();
    return args.map(String).join('');
  });
  hbs.registerHelper('index', (obj: Record<string, unknown> | undefined, key: unknown) => {
    if (!obj) return undefined;
    return obj[String(key)];
  });
  hbs.registerHelper('at', (obj: Record<string, Record<string, unknown>> | undefined, key: unknown, field: string) => {
    const item = obj?.[String(key)];
    if (!item) return '';
    const value = item[field];
    return value === undefined || value === null ? '' : value;
  });
  hbs.registerHelper('money', (d: Decimal | undefined) => {
    if (!d) return '—';
    return formatMoney(asDecimal(d), currencySymbol);
  });
  hbs.registerHelper('qty', (d: Decimal | undefined) => (d ? formatQuantity(asDecimal(d)) : ''));
  hbs.registerHelper('date', (iso: string) => (iso && iso.length >= 10 ? iso.slice(0, 10) : iso || ''));
  hbs.registerHelper('datetime', (iso: string) => formatBoughtOn(iso || ''));
  hbs.registerHelper('dateValue', (iso: string) => boughtOnDate(iso || ''));
  hbs.registerHelper('timeValue', (iso: string) => boughtOnTime(iso || ''));
  hbs.registerHelper('unitPrice', (amount: Decimal, quantity: Decimal) => {
    const q = asDecimal(quantity);
    if (q.isZero()) return '—';
    return formatMoney(asDecimal(amount).div(q), currencySymbol);
  });
  hbs.registerHelper('extraQuotes', (quote: QuotedPrice | null | undefined, product: Product) =>
    extraQuotes(quote, product),
  );
  hbs.registerHelper('qtyIn', (qty: Decimal, conv: ProductConversion) => qtyInSafe(qty, conv));
  hbs.registerHelper('isZero', (d: Decimal | undefined) => Boolean(d && asDecimal(d).isZero()));
  hbs.registerHelper('hasImage', (path: string) => Boolean(path && path.trim() !== ''));
  hbs.registerHelper('add', (a: number, b: number) => Number(a) + Number(b));
}

function asDecimal(d: Decimal | string | number): Decimal {
  return d instanceof Decimal ? d : new Decimal(d ?? 0);
}

function qtyInSafe(qty: Decimal, conv: ProductConversion): Decimal {
  return asDecimal(qty).mul(asDecimal(conv.factor));
}

/** Handlebars treats [] as truthy; Go templates do not. */
export function viewData(data: Record<string, unknown>): Record<string, unknown> {
  return emptyArraysToNull(data) as Record<string, unknown>;
}

function emptyArraysToNull(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map(emptyArraysToNull);
  }
  if (value && typeof value === 'object' && !(value instanceof Decimal) && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = emptyArraysToNull(v);
    }
    return out;
  }
  return value;
}
