export function arr<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function flag(value: unknown): boolean {
  return value === true;
}

export function sameId(a: unknown, b: unknown): boolean {
  const left = a === null || a === undefined || a === '' ? '' : String(a);
  const right = b === null || b === undefined || b === '' ? '' : String(b);
  return left === right;
}

export function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function resourceView(props: object) {
  const record = props as Record<string, unknown>;
  return {
    ...record,
    new: record.creating,
    page: { symbol: record.symbol ?? '', currency: record.currency ?? '', error: '' },
  };
}
