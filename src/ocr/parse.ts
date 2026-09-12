import Decimal from 'decimal.js';
import { emptyBill, emptyLine, type Bill, type Line } from './types';

export function parse(raw: Buffer | string): Bill {
  return parseBill(raw);
}

export function parseBill(raw: Buffer | string): Bill {
  const payload = extractJSON(typeof raw === 'string' ? raw : raw.toString('utf8'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('model returned invalid JSON');
  }
  const bill = unmarshalBill(parsed);
  bill.Notes = bill.Notes.trim();
  bill.StoryName = bill.StoryName.trim();
  bill.ExternalID = bill.ExternalID.trim();
  bill.StreetName = stripStreetPrefix(bill.StreetName);
  bill.BuildingNumber = bill.BuildingNumber.trim();
  bill.ApartmentNumber = bill.ApartmentNumber.trim();
  bill.PostalCode = normalizePostal(bill.PostalCode);
  bill.City = bill.City.trim();
  const split = splitDateAndTime(bill.BoughtOn, bill.BoughtAt);
  bill.BoughtOn = normalizeDate(split.date);
  bill.BoughtAt = normalizeTime(split.clock);
  for (const line of bill.Lines) {
    normalizeLine(line);
    inferUnitFromSize(line);
    fixWeighedKg(line);
    coalesceQuantity(line);
    inferUnitFromQuantity(line);
    fillMissingAmount(line);
  }
  return bill;
}

function unmarshalBill(parsed: unknown): Bill {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('model returned invalid JSON');
  }
  const raw = parsed as Record<string, unknown>;
  const bill = emptyBill();
  bill.BoughtOn = asStringField(raw.bought_on);
  bill.BoughtAt = asStringField(raw.bought_at);
  bill.Notes = asStringField(raw.notes);
  bill.NotABill = asBoolField(raw.not_a_bill);
  bill.StoryID = flexInt(raw.company_id);
  bill.StoryName = asStringField(raw.company_name);
  bill.ExternalID = asStringField(raw.external_id);
  bill.StreetName = asStringField(raw.street_name);
  bill.BuildingNumber = asStringField(raw.building_number);
  bill.ApartmentNumber = asStringField(raw.apartment_number);
  bill.PostalCode = asStringField(raw.postal_code);
  bill.City = asStringField(raw.city);
  if (raw.lines == null) {
    bill.Lines = [];
  } else if (!Array.isArray(raw.lines)) {
    throw new Error('model returned invalid JSON');
  } else {
    bill.Lines = raw.lines.map(unmarshalLine);
  }
  return bill;
}

function unmarshalLine(item: unknown): Line {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('model returned invalid JSON');
  }
  const raw = item as Record<string, unknown>;
  const line = emptyLine();
  line.ReceiptName = asStringField(raw.receipt_name);
  line.ProductName = asStringField(raw.product_name);
  line.ProductID = flexInt(raw.product_id);
  line.UnitID = flexInt(raw.unit_id);
  line.UnitName = asStringField(raw.unit_name);
  line.VatType = asStringField(raw.vat_type);
  line.PackageCount = flexNum(raw.package_count);
  line.PackageSize = flexNum(raw.package_size);
  line.Quantity = flexNum(raw.quantity);
  line.UnitPrice = flexNum(raw.unit_price);
  line.Discount = flexNum(raw.discount);
  line.Amount = flexNum(raw.amount);
  line.Skip = asBoolField(raw.skip);
  line.SkipReason = asStringField(raw.skip_reason);
  return line;
}

function asStringField(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  throw new Error('model returned invalid JSON');
}

function asBoolField(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  throw new Error('model returned invalid JSON');
}

function flexInt(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return 0;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'boolean') return 0;
  return 0;
}

function flexNum(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  if (typeof v === 'boolean') return '';
  return '';
}

function normalizeLine(line: Line): void {
  line.ReceiptName = line.ReceiptName.trim();
  line.ProductName = line.ProductName.trim();
  if (line.ProductName === '') line.ProductName = line.ReceiptName;
  line.UnitName = normalizeUnitName(line.UnitName);
  line.SkipReason = line.SkipReason.trim();

  const [unitPrice, vatFromPrice] = peelVAT(line.UnitPrice);
  const [amount, vatFromAmount] = peelVAT(line.Amount);
  const [count, vatFromCount] = peelVAT(line.PackageCount);
  const [qty, vatFromQty] = peelVAT(line.Quantity);
  line.UnitPrice = normalizeNumber(unitPrice);
  line.Amount = normalizeNumber(amount);
  line.PackageCount = normalizeNumber(count);
  line.PackageSize = normalizeNumber(line.PackageSize);
  line.Quantity = normalizeNumber(qty);
  line.Discount = normalizeDiscount(line.Discount);
  line.VatType = normalizeVAT(line.VatType, vatFromPrice, vatFromAmount, vatFromCount, vatFromQty);
}

function extractJSON(raw: string): string {
  let s = raw.trim();
  if (s === '') throw new Error('empty model response');
  const fence = s.indexOf('```');
  if (fence >= 0) {
    s = s.slice(fence + 3);
    s = s.trim();
    if (s.startsWith('json')) s = s.slice(4);
    s = s.trim();
    const end = s.indexOf('```');
    if (end >= 0) s = s.slice(0, end);
    s = s.trim();
  }
  const start = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (start < 0 || last < start) throw new Error('model response was not JSON');
  return s.slice(start, last + 1);
}

function splitDateAndTime(date: string, clock: string): { date: string; clock: string } {
  date = date.trim();
  clock = clock.trim();
  date = date.replaceAll('\u00a0', ' ').replaceAll('T', ' ');
  const parts = date.split(/\s+/).filter((p) => p !== '');
  if (parts.length === 0) return { date, clock };
  date = parts[0]!;
  if (clock === '' && parts.length >= 2) clock = parts[1]!;
  return { date, clock };
}

export function normalizeDate(s: string): string {
  s = s.trim();
  if (s === '') return '';
  s = s.replaceAll('\u00a0', ' ');
  const iso = parseYMD(s, '-', true);
  if (iso) return iso;
  const layouts: Array<() => string | null> = [
    () => parseDMY(s, '.', 2, 2),
    () => parseDMY(s, '.', 1, 2),
    () => parseDMY(s, '.', 2, 1),
    () => parseDMY(s, '.', 1, 1),
    () => parseDMY(s, '/', 2, 2),
    () => parseDMY(s, '/', 1, 1),
    () => parseDMY(s, '-', 2, 2),
    () => parseYMD(s, '/', true),
    () => parseYMD(s, '.', true),
  ];
  for (const tryParse of layouts) {
    const got = tryParse();
    if (got) return got;
  }
  return s;
}

function parseYMD(s: string, sep: string, padded: boolean): string | null {
  const parts = s.split(sep);
  if (parts.length !== 3) return null;
  const [ys, ms, ds] = parts;
  if (!ys || !ms || !ds) return null;
  if (ys.length !== 4) return null;
  if (padded) {
    if (ms.length !== 2 || ds.length !== 2) return null;
  } else if (ms.length < 1 || ds.length < 1) {
    return null;
  }
  const y = Number.parseInt(ys, 10);
  const m = Number.parseInt(ms, 10);
  const d = Number.parseInt(ds, 10);
  return formatYMD(y, m, d);
}

function parseDMY(s: string, sep: string, dayDigits: number, monthDigits: number): string | null {
  const parts = s.split(sep);
  if (parts.length !== 3) return null;
  const [ds, ms, ys] = parts;
  if (!ds || !ms || !ys) return null;
  if (ys.length !== 4) return null;
  if (dayDigits === 2 && ds.length !== 2) return null;
  if (dayDigits === 1 && ds.length < 1) return null;
  if (monthDigits === 2 && ms.length !== 2) return null;
  if (monthDigits === 1 && ms.length < 1) return null;
  const d = Number.parseInt(ds, 10);
  const m = Number.parseInt(ms, 10);
  const y = Number.parseInt(ys, 10);
  return formatYMD(y, m, d);
}

function formatYMD(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function normalizeTime(s: string): string {
  s = s.trim();
  if (s === '') return '';
  s = s.replaceAll('\u00a0', ' ').replaceAll('.', ':');
  const space = s.indexOf(' ');
  if (space >= 0) s = s.slice(0, space);
  const withZone = /^(\d{2}):(\d{2}):(\d{2})(?:Z|[+-]\d{2}:\d{2})$/i.exec(s);
  const hms = withZone ?? /^(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (hms) {
    const hh = Number.parseInt(hms[1]!, 10);
    const mm = Number.parseInt(hms[2]!, 10);
    const ss = Number.parseInt(hms[3]!, 10);
    if (hh <= 23 && mm <= 59 && ss <= 59) {
      return `${hms[1]}:${hms[2]}`;
    }
    return s;
  }
  const hm = /^(\d{2}):(\d{2})$/.exec(s);
  if (hm) {
    const hh = Number.parseInt(hm[1]!, 10);
    const mm = Number.parseInt(hm[2]!, 10);
    if (hh <= 23 && mm <= 59) return `${hm[1]}:${hm[2]}`;
  }
  return s;
}

function normalizePostal(s: string): string {
  s = s.trim();
  if (s === '') return '';
  let digits = '';
  for (const r of s) {
    if (r >= '0' && r <= '9') digits += r;
  }
  if (digits.length === 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return s;
}

export function stripStreetPrefix(s: string): string {
  s = s.trim();
  if (s === '') return '';
  const lower = s.toLowerCase();
  for (const p of ['ulica ', 'ul. ', 'ul ', 'aleje ', 'aleja ', 'al. ', 'al ', 'plac ', 'pl. ', 'pl ']) {
    if (lower.startsWith(p)) return s.slice(p.length).trim();
  }
  return s;
}

function peelVAT(s: string): [string, string] {
  s = s.trim();
  if (s === '') return ['', ''];
  const runes = [...s];
  const last = runes[runes.length - 1]!.toUpperCase();
  if (last === 'A' || last === 'B' || last === 'C') {
    return [runes.slice(0, -1).join('').trim(), last];
  }
  return [s, ''];
}

function normalizeVAT(...values: string[]): string {
  for (let s of values) {
    s = s.toUpperCase().trim();
    if (s === '') continue;
    s = s.replace(/[\d%\s]+$/u, '').trim();
    if (s === 'A' || s === 'B' || s === 'C') return s;
    const runes = [...s];
    if (runes.length > 0) {
      const last = runes[runes.length - 1]!.toUpperCase();
      if (last === 'A' || last === 'B' || last === 'C') return last;
    }
  }
  return '';
}

function normalizeDiscount(s: string): string {
  s = s.trim();
  if (s.startsWith('−')) s = s.slice(1);
  if (s.startsWith('–')) s = s.slice(1);
  if (s.startsWith('-')) s = s.slice(1);
  s = normalizeNumber(s);
  if (s === '') return '';
  try {
    const d = new Decimal(s);
    return d.abs().toFixed(2, Decimal.ROUND_HALF_EVEN);
  } catch {
    return s;
  }
}

export function normalizeNumber(s: string): string {
  s = s.trim();
  s = s.replaceAll('\u00a0', '').replaceAll(' ', '');
  s = [...s]
    .filter((r) => !/[\p{L}%]/u.test(r))
    .join('');
  s = s.replaceAll(',', '.');
  const dots = s.split('.');
  if (dots.length > 2) {
    s = dots.slice(0, -1).join('') + '.' + dots[dots.length - 1];
  }
  return s;
}

function coalesceQuantity(line: Line): void {
  if (line.Quantity.trim() !== '') return;
  const c = line.PackageCount.trim();
  if (c !== '') line.Quantity = c;
}

function inferUnitFromSize(line: Line): void {
  if (line.UnitName !== '') return;
  if (looksLikeScaleKg(line.PackageSize)) line.UnitName = 'kg';
}

function inferUnitFromQuantity(line: Line): void {
  if (line.UnitName !== '') return;
  if (looksLikeScaleKg(line.Quantity)) line.UnitName = 'kg';
}

function normalizeUnitName(s: string): string {
  s = s.toLowerCase().trim();
  if (s.endsWith('.')) s = s.slice(0, -1);
  switch (s) {
    case 'sztuka':
    case 'sztuk':
    case 'pcs':
    case 'pc':
    case 'piece':
    case 'szt':
      return 'szt';
    case 'opak':
    case 'opakowanie':
    case 'op':
    case 'pkt':
      return 'pkt';
    case 'kilogram':
    case 'kilogramy':
    case 'kilogramów':
    case 'kg':
      return 'kg';
    case 'gram':
    case 'gramy':
    case 'gramów':
    case 'gr':
    case 'g':
      return 'g';
    case 'litr':
    case 'litry':
    case 'litrów':
    case 'liter':
    case 'l':
      return 'l';
    case 'mililitr':
    case 'mililitry':
    case 'ml':
      return 'ml';
    default:
      return s;
  }
}

function fillMissingAmount(line: Line): void {
  if (line.Skip || line.Amount.trim() !== '') return;
  let price: Decimal;
  try {
    price = new Decimal(line.UnitPrice);
  } catch {
    return;
  }
  if (price.isZero()) return;
  let count: Decimal;
  try {
    count = new Decimal(line.Quantity);
  } catch {
    return;
  }
  if (count.isZero()) return;
  let discount = new Decimal(0);
  if (line.Discount !== '') {
    try {
      discount = new Decimal(line.Discount).abs();
    } catch {
      /* ignore */
    }
  }
  line.Amount = count.mul(price).sub(discount).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

function fixWeighedKg(line: Line): void {
  if (line.UnitName.toLowerCase() !== 'kg') return;
  if (!isOne(line.PackageCount)) return;
  if (!looksLikeScaleKg(line.PackageSize)) return;
  line.PackageCount = line.PackageSize;
  line.PackageSize = '1';
}

function isOne(s: string): boolean {
  return s === '1' || s === '1.0' || s === '1.00' || s === '1.000';
}

function looksLikeScaleKg(s: string): boolean {
  const i = s.indexOf('.');
  if (i < 0) return false;
  const frac = s.slice(i + 1);
  if (frac.length < 3) return false;
  return frac.replace(/0+$/, '') !== '';
}
