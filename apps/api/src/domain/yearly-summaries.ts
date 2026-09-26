import { Decimal } from 'decimal.js';
import { KIND_PURCHASE, type Purchase } from '../store/purchases/purchases.models.js';

export type YearSummary = {
  year: string;
  quantity: Decimal;
  amount: Decimal;
};

export function yearlySummaries(purchases: Purchase[]): YearSummary[] {
  const order: string[] = [];
  const byYear = new Map<string, YearSummary>();
  for (const p of purchases) {
    if (p.kind !== KIND_PURCHASE) continue;
    let year = p.boughtOn;
    if (year.length >= 4) year = year.slice(0, 4);
    let s = byYear.get(year);
    if (!s) {
      s = { year, quantity: new Decimal(0), amount: new Decimal(0) };
      byYear.set(year, s);
      order.push(year);
    }
    s.quantity = s.quantity.add(p.quantity);
    s.amount = s.amount.add(p.amount);
  }
  const seen = new Set<string>();
  const out: YearSummary[] = [];
  for (const y of order) {
    if (seen.has(y)) continue;
    seen.add(y);
    out.push(byYear.get(y)!);
  }
  return out;
}
