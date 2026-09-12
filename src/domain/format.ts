import Decimal from 'decimal.js';

export function formatQuantity(d: Decimal): string {
  let s = d.toString();
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s.replaceAll('.', ',');
}

export function formatMoney(d: Decimal, symbol: string): string {
  return `${formatGrouped(d, 2)} ${symbol}`;
}

export function formatMoneyPerUnit(d: Decimal, symbol: string, unit: string): string {
  return `${formatMoney(d, symbol)} / ${unit}`;
}

export function formatGrouped(d: Decimal, places: number): string {
  let neg = d.isNegative();
  if (neg) d = d.abs();
  const s = d.toFixed(places);
  const parts = s.split('.');
  const intPart = parts[0] ?? '0';
  let out = '';
  const n = intPart.length;
  for (let i = 0; i < n; i++) {
    if (i > 0 && (n - i) % 3 === 0) out += '\u00a0';
    out += intPart[i];
  }
  if (parts[1] !== undefined) out += `,${parts[1]}`;
  if (neg) out = `−${out}`;
  return out;
}

export function parseDecimal(raw: string, maxFrac: number, allowZero: boolean): Decimal {
  raw = raw.trim().replaceAll('\u00a0', '').replaceAll(' ', '').replaceAll(',', '.');
  if (raw === '') throw new Error('required');
  if ((raw.match(/\./g) ?? []).length > 1) throw new Error('invalid number');
  const i = raw.indexOf('.');
  if (i >= 0 && raw.length - i - 1 > maxFrac) {
    throw new Error(`at most ${maxFrac} decimal places`);
  }
  let d: Decimal;
  try {
    d = new Decimal(raw);
  } catch {
    throw new Error('invalid number');
  }
  if (d.isNegative()) throw new Error('must not be negative');
  if (d.isZero() && !allowZero) throw new Error('must be greater than zero');
  return d;
}
