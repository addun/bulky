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
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
}
