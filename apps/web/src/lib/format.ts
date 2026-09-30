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

function scaled(raw: string): { neg: boolean; digits: bigint; scale: number } {
  const neg = raw.trim().startsWith('-');
  const s = raw.trim().replace(/^[+-]/, '');
  const [whole, frac = ''] = s.split('.');
  const digits = `${whole || '0'}${frac}`.replace(/^0+(?=\d)/, '');
  return { neg, digits: BigInt(digits || '0'), scale: frac.length };
}
