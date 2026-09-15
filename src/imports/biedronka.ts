import Decimal from 'decimal.js';
import { parseBill } from '../ocr/parse';
import { emptyBill, NoLinesError, productLines, type Bill, type Line } from '../ocr/types';
import {
  biedronkaReceipt,
  type BiedronkaReceipt,
  type BiedronkaReceiptItem,
  type BiedronkaTx,
} from './biedronka.schema';

export type { BiedronkaTx };

const shopNumber = /\d{3,5}/;

export function billFromBiedronka(raw: unknown, tx: BiedronkaTx): Bill {
  const payload = decodePayload(raw);
  const details = biedronkaReceipt.safeParse(payload);
  if (details.success) return billFromDetails(details.data, tx);
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'receipt' in payload) {
    const nested = biedronkaReceipt.safeParse((payload as { receipt: unknown }).receipt);
    if (nested.success) return billFromDetails(nested.data, tx);
  }
  return billFromTill(payload, tx);
}

function billFromDetails(receipt: BiedronkaReceipt, tx: BiedronkaTx): Bill {
  const bill = emptyBill();
  bill.boughtOn = tx.date.trim() || receipt.date;
  bill.storyName = biedronkaStoreName(tx.store_name || receipt.store_name, receipt.store);
  bill.externalId = receipt.store_id.trim();
  if (bill.externalId === '') {
    const n = shopNumber.exec(tx.store_name || receipt.store_name);
    if (n) bill.externalId = n[0]!;
  }
  bill.streetName = receipt.store.street;
  bill.postalCode = receipt.store.zip_code;
  bill.city = receipt.store.city;
  const num = (tx.receipt_num || receipt.receipt_num).trim();
  if (num !== '') bill.notes = 'Receipt ' + num;
  for (const item of receipt.items) {
    const line = lineFromDetailsItem(item);
    if (!line) continue;
    bill.lines.push(line);
  }
  if (productLines(bill).length === 0) throw new NoLinesError();
  return parseBill(Buffer.from(JSON.stringify(toLooseJSON(bill))));
}

function biedronkaStoreName(listed: string, store: { street: string; city: string }): string {
  const raw = listed.trim();
  if (raw === '') return 'Biedronka';
  const street = store.street.trim();
  const city = store.city.trim();
  if (street !== '' && raw.includes(street)) return 'Biedronka';
  if (city !== '' && raw.includes(city) && /(?:^|[\s,])(ul\.|ulica|al\.|aleja|pl\.)/i.test(raw)) return 'Biedronka';
  return raw;
}

function lineFromDetailsItem(item: BiedronkaReceiptItem): Line | null {
  const receiptName = item.name.trim();
  if (receiptName === '') return null;
  return {
    receiptName,
    productName: '',
    productId: 0,
    unitId: 0,
    unitName: item.measure_unit,
    vatType: item.vat_fiscal_code,
    packageCount: '',
    packageSize: '',
    quantity: formatQty(item.quantity),
    unitPrice: formatMoney(item.unit_price),
    discount: item.total_discount === 0 ? '' : formatMoney(item.total_discount),
    amount: formatMoney(item.total_price),
    skip: false,
    skipReason: '',
    ean: item.ean.trim(),
  };
}

function billFromTill(payload: unknown, tx: BiedronkaTx): Bill {
  const lines = walkBiedronkaLines(payload);
  if (lines.length === 0) throw new NoLinesError();
  const scale = moneyScale(lines, tx.total_price);
  const bill = emptyBill();
  bill.boughtOn = tx.date.trim();
  bill.storyName = tx.store_name.trim();
  if (bill.storyName === '') bill.storyName = 'Biedronka';
  const n = shopNumber.exec(bill.storyName);
  if (n) bill.externalId = n[0]!;
  const num = tx.receipt_num.trim();
  if (num !== '') bill.notes = 'Receipt ' + num;
  let current = -1;
  for (const item of lines) {
    const sell = asObject(item.sellLine);
    if (sell) {
      if (truthy(sell.isStorno)) {
        current = -1;
        continue;
      }
      const line: Line = {
        receiptName: asString(sell.name).trim(),
        productName: '',
        productId: 0,
        unitId: 0,
        unitName: '',
        vatType: asString(sell.vatId),
        packageCount: '',
        packageSize: '',
        quantity: formatQty(asFloat(sell.quantity)),
        unitPrice: formatMoney(asFloat(sell.price) / scale),
        discount: '',
        amount: formatMoney(asFloat(sell.total) / scale),
        skip: false,
        skipReason: '',
        ean: asString(sell.ean),
      };
      if (line.receiptName === '') continue;
      bill.lines.push(line);
      current = bill.lines.length - 1;
      continue;
    }
    const disc = asObject(item.discountLine);
    if (disc) {
      if (current < 0 || truthy(disc.isPercent) || truthy(disc.isStorno)) continue;
      const add = asFloat(disc.value) / scale;
      if (add === 0) continue;
      const sum = asFloat(bill.lines[current]!.discount) + Math.abs(add);
      bill.lines[current]!.discount = formatMoney(sum);
    }
  }
  if (productLines(bill).length === 0) throw new NoLinesError();
  return parseBill(Buffer.from(JSON.stringify(toLooseJSON(bill))));
}

function toLooseJSON(bill: Bill): unknown {
  return {
    bought_on: bill.boughtOn,
    bought_at: bill.boughtAt,
    notes: bill.notes,
    not_a_bill: bill.notABill,
    company_id: bill.storyId,
    company_name: bill.storyName,
    external_id: bill.externalId,
    street_name: bill.streetName,
    building_number: bill.buildingNumber,
    apartment_number: bill.apartmentNumber,
    postal_code: bill.postalCode,
    city: bill.city,
    lines: bill.lines.map((line) => ({
      receipt_name: line.receiptName,
      product_name: line.productName,
      product_id: line.productId,
      unit_id: line.unitId,
      unit_name: line.unitName,
      vat_type: line.vatType,
      package_count: line.packageCount,
      package_size: line.packageSize,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      discount: line.discount,
      amount: line.amount,
      skip: line.skip,
      skip_reason: line.skipReason,
      ean: line.ean,
    })),
  };
}

function decodePayload(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    const text = (typeof raw === 'string' ? raw : raw.toString('utf8')).trim();
    if (text === '') return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return raw;
}

function walkBiedronkaLines(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    if (looksLikeTillLines(payload)) return asObjectSlice(payload);
    for (const item of payload) {
      const found = walkBiedronkaLines(item);
      if (found.length > 0) return found;
    }
  } else if (payload && typeof payload === 'object') {
    const v = payload as Record<string, unknown>;
    for (const key of ['lines', 'receiptLines']) {
      if (Array.isArray(v[key])) return asObjectSlice(v[key]);
    }
    for (const key of ['receipt', 'data', 'payload', 'json']) {
      const found = walkBiedronkaLines(v[key]);
      if (found.length > 0) return found;
    }
    if (Array.isArray(v.items)) return linesFromDetails(v.items);
  }
  return [];
}

function looksLikeTillLines(items: unknown[]): boolean {
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if ('sellLine' in obj || 'discountLine' in obj || 'sumInCurrency' in obj) return true;
  }
  return false;
}

function asObjectSlice(items: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item)) out.push(item as Record<string, unknown>);
  }
  return out;
}

function linesFromDetails(items: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const sell: Record<string, unknown> = {};
    const name = asString(obj.name);
    if (name !== '') sell.name = name;
    if ('price' in obj) sell.price = obj.price;
    else if ('unit_price' in obj) sell.price = obj.unit_price;
    if ('total' in obj) sell.total = obj.total;
    else if ('total_price' in obj) sell.total = obj.total_price;
    if ('quantity' in obj) sell.quantity = obj.quantity;
    if ('vatId' in obj) sell.vatId = obj.vatId;
    if (Object.keys(sell).length === 0) continue;
    out.push({ sellLine: sell });
  }
  return out;
}

function moneyScale(lines: Record<string, unknown>[], listTotal: number): number {
  let sum = 0;
  for (const item of lines) {
    const sell = asObject(item.sellLine);
    if (!sell || truthy(sell.isStorno)) continue;
    sum += asFloat(sell.total);
  }
  if (listTotal > 0 && sum > 0) {
    const ratio = sum / listTotal;
    if (ratio > 50 && ratio < 150) return 100;
  }
  return 1;
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asFloat(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.trim().replaceAll(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'boolean') return 0;
  return 0;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') {
    if (v === Math.trunc(v)) return String(Math.trunc(v));
    return String(v);
  }
  return '';
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    return s === 'true' || s === '1';
  }
  if (typeof v === 'number') return v !== 0;
  return false;
}

function formatMoney(v: number): string {
  if (!Number.isFinite(v)) return '';
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

function formatQty(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '';
  const d = new Decimal(v);
  if (d.equals(d.trunc())) return d.trunc().toString();
  return d.toString();
}

