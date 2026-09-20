/** Stored and displayed as `YYYY-MM-DD HH:MM`. datetime-local uses a `T`. */

export function boughtOnDate(s: string): string {
  const t = s.trim().replace('T', ' ');
  return t.length >= 10 ? t.slice(0, 10) : '';
}

export function boughtOnTime(s: string): string {
  const t = s.trim().replace('T', ' ');
  return t.length >= 16 ? t.slice(11, 16) : '';
}

export function formatBoughtOn(s: string): string {
  const day = boughtOnDate(s);
  const clock = boughtOnTime(s);
  if (day === '') return s.trim();
  if (clock === '') return day;
  return `${day} ${clock}`;
}

export function toDatetimeLocal(s: string): string {
  const v = formatBoughtOn(s);
  return v.length >= 16 ? `${v.slice(0, 10)}T${v.slice(11, 16)}` : '';
}

export function fromDatetimeLocal(s: string): string {
  const v = formatBoughtOn(s);
  return v.length >= 16 ? v : '';
}

export function combineBoughtOn(date: string, clock: string): string {
  const already = fromDatetimeLocal(date);
  if (already) return already;
  return fromDatetimeLocal(`${date.trim()} ${clock.trim()}`);
}

export function nowBoughtOn(): string {
  return formatInWarsaw(new Date());
}

/** Convert an ISO timestamp (`…Z` or `±HH:MM`) to Warsaw `YYYY-MM-DD HH:MM`. Naive values pass through. */
export function fromInstant(s: string): string {
  const t = s.trim();
  if (t === '') return '';
  if (/T/.test(t) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return formatInWarsaw(d);
  }
  return formatBoughtOn(t);
}

function formatInWarsaw(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
