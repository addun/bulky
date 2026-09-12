const BOUGHT_ON_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BOUGHT_ON_CLOCK = /^\d{2}:\d{2}$/;
const MIDDAY = '12:00';

export function joinBoughtOn(date: string, clock: string): string {
  const split = splitBoughtOn(date);
  let day = split.date;
  clock = clock.trim();
  if (clock === '') {
    clock = split.clock;
  } else {
    const t = clockPart(clock);
    if (t !== '') clock = t;
  }
  if (day === '') return '';
  if (clock === '') clock = MIDDAY;
  return `${day} ${clock}`;
}

export function splitBoughtOn(s: string): { date: string; clock: string } {
  s = s.trim();
  if (s === '') return { date: '', clock: '' };
  s = s.replaceAll('T', ' ').replaceAll('\u00a0', ' ');
  const parts = s.split(/\s+/);
  const date = parts[0] ?? '';
  const clock = parts.length >= 2 ? clockPart(parts[1] ?? '') : '';
  return { date, clock };
}

export function normalizeBoughtOn(s: string): string {
  const { date, clock: rawClock } = splitBoughtOn(s);
  if (date === '') throw new Error('required');
  if (!BOUGHT_ON_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) {
    throw new Error('invalid date');
  }
  const clock = rawClock === '' ? MIDDAY : rawClock;
  if (!BOUGHT_ON_CLOCK.test(clock)) throw new Error('invalid time');
  return `${date} ${clock}`;
}

export function boughtOnDate(s: string): string {
  return splitBoughtOn(s).date;
}

export function boughtOnTime(s: string): string {
  return splitBoughtOn(s).clock;
}

export function formatBoughtOn(s: string): string {
  const { date, clock } = splitBoughtOn(s);
  if (date === '') return s.trim();
  if (clock === '') return date;
  return `${date} ${clock}`;
}

function clockPart(s: string): string {
  s = s.trim().replaceAll('.', ':');
  const z = s.indexOf('Z');
  if (z >= 0) s = s.slice(0, z);
  if (s.length >= 8 && /^\d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  if (s.length >= 5 && /^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  return '';
}
