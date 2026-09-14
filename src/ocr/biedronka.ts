import Decimal from 'decimal.js';
import { parseBill } from './parse';
import { emptyBill, NoLinesError, productLines, type Bill, type Line } from './types';

export type Tx = {
  id: string;
  Date: string;
  StoreName: string;
  ReceiptNum: string;
  TotalPrice: number;
};

const shopNumber = /\d{3,5}/;

export function billFromBiedronka(raw: Buffer | string, tx: Tx): Bill {
  const lines = extractBiedronkaLines(typeof raw === 'string' ? Buffer.from(raw) : raw);
  if (lines.length === 0) throw new NoLinesError();
  const scale = moneyScale(lines, tx.TotalPrice);
  const bill = emptyBill();
  bill.boughtOn = tx.Date.trim();
  bill.storyName = tx.StoreName.trim();
  if (bill.storyName === '') bill.storyName = 'Biedronka';
  const n = shopNumber.exec(bill.storyName);
  if (n) bill.externalId = n[0]!;
  const num = tx.ReceiptNum.trim();
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
    })),
  };
}

function extractBiedronkaLines(raw: Buffer): Record<string, unknown>[] {
  const text = raw.toString('utf8').trim();
  if (text === '') return [];
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  return walkBiedronkaLines(payload);
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

export function billSlipText(bill: Bill, tx: Tx): string {
  let out = 'Biedronka e-receipt\n';
  if (tx.StoreName !== '') out += tx.StoreName + '\n';
  if (tx.Date !== '') out += tx.Date + '\n';
  if (tx.ReceiptNum !== '') out += `Receipt ${tx.ReceiptNum}\n`;
  out += '\n';
  for (const line of productLines(bill)) {
    let name = line.receiptName;
    if (name === '') name = line.productName;
    out += `${name}  ${line.quantity} x ${line.unitPrice}  ${line.amount}\n`;
  }
  return out;
}
