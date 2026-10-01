export function formatBoughtOn(s: string): string {
  const t = s.trim().replace('T', ' ');
  const day = t.length >= 10 ? t.slice(0, 10) : '';
  const clock = t.length >= 16 ? t.slice(11, 16) : '';
  if (day === '') return s.trim();
  if (clock === '') return day;
  return `${day} ${clock}`;
}

export function formatPrice(unitPrice: string, compareValue: string, unitName: string, symbol: string): string {
  const amount = mul(unitPrice, compareValue);
  const unit = isOne(compareValue) ? unitName : `${formatQuantity(compareValue)} ${unitName}`;
  return `${formatGrouped(amount)} ${symbol} / ${unit}`;
}

function isOne(raw: string): boolean {
  return /^1(?:\.0+)?$/.test(raw.trim());
}

function formatQuantity(raw: string): string {
  let s = raw.trim();
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replaceAll('.', ',');
}

function formatGrouped(amount: string): string {
  const neg = amount.startsWith('-');
  const [whole, frac = '00'] = (neg ? amount.slice(1) : amount).split('.');
  let out = '';
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += '\u00a0';
    out += whole[i];
  }
  out += `,${frac}`;
  return neg ? `−${out}` : out;
}

function mul(a: string, b: string): string {
  const left = scaled(a);
  const right = scaled(b);
  const neg = left.neg !== right.neg && left.digits !== 0n && right.digits !== 0n;
  const product = left.digits * right.digits;
  const scale = left.scale + right.scale;
  const cents = scale <= 2 ? product * 10n ** BigInt(2 - scale) : roundHalfUp(product, scale - 2);
  const text = cents.toString().padStart(3, '0');
  const body = `${text.slice(0, -2)}.${text.slice(-2)}`;
  return neg ? `-${body}` : body;
}

function roundHalfUp(value: bigint, drop: number): bigint {
  const factor = 10n ** BigInt(drop);
  const div = value / factor;
  const rem = value % factor;
  return div + (rem * 2n >= factor ? 1n : 0n);
}

export function formatQty(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '';
  let s = String(raw).trim();
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replaceAll('.', ',');
}

export function isZeroQty(raw: unknown): boolean {
  if (raw === null || raw === undefined || String(raw).trim() === '') return true;
  return /^[+-]?0+(?:\.0+)?$/.test(String(raw).trim());
}

export function formatMoneyAmount(raw: string | number | null | undefined, symbol: string): string {
  if (raw === null || raw === undefined || String(raw).trim() === '') return '—';
  return `${formatGrouped(moneyAmount(String(raw)))} ${symbol}`;
}

export function formatLinePrice(
  amount: string,
  quantity: string,
  compareValue: string,
  unitName: string,
  symbol: string,
): string {
  if (isZeroQty(quantity)) return '—';
  return formatPrice(divide(amount || '0', quantity), compareValue || '1', unitName, symbol);
}

export function toDatetimeLocal(s: string): string {
  const v = formatBoughtOn(s);
  return v.length >= 16 ? `${v.slice(0, 10)}T${v.slice(11, 16)}` : '';
}

export function formatDate(s: string): string {
  const t = s.trim();
  return t.length >= 10 ? t.slice(0, 10) : t;
}

export function qtyHint(quantity: string, amount: string, unit: string, compare: string, symbol: string): string {
  const qty = positive(quantity);
  const paid = positive(amount);
  if (qty === null || paid === null) return '';
  const basisQty = positive(compare) || 1;
  const price = ((paid / qty) * basisQty).toFixed(2).replace('.', ',');
  const sym = symbol.trim();
  const head = `${price}${sym ? ` ${sym}` : ''}`;
  const basis = basisQty === 1 ? unit.trim() : `${String(basisQty).replace('.', ',')}${unit.trim() ? ` ${unit.trim()}` : ''}`;
  return head + (basis ? `/${basis}` : ' per unit');
}

function positive(raw: string): number | null {
  const n = Number(String(raw || '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function moneyAmount(raw: string): string {
  const { neg, digits, scale } = scaled(raw);
  const cents = scale <= 2 ? digits * 10n ** BigInt(2 - scale) : roundHalfUp(digits, scale - 2);
  const text = cents.toString().padStart(3, '0');
  const body = `${text.slice(0, -2)}.${text.slice(-2)}`;
  return neg && cents !== 0n ? `-${body}` : body;
}

function divide(a: string, b: string): string {
  const left = scaled(a);
  const right = scaled(b);
  if (right.digits === 0n) return '0';
  const extra = 8;
  const quotient = (left.digits * 10n ** BigInt(extra + right.scale)) / (right.digits * 10n ** BigInt(left.scale));
  const neg = left.neg !== right.neg && quotient !== 0n;
  const text = quotient.toString().padStart(extra + 1, '0');
  const body = `${text.slice(0, -extra)}.${text.slice(-extra)}`;
  return neg ? `-${body}` : body;
}

function scaled(raw: string): { neg: boolean; digits: bigint; scale: number } {
  const neg = raw.trim().startsWith('-');
  const s = raw.trim().replace(/^[+-]/, '');
  const [whole, frac = ''] = s.split('.');
  const digits = `${whole || '0'}${frac}`.replace(/^0+(?=\d)/, '');
  return { neg, digits: BigInt(digits || '0'), scale: frac.length };
}
