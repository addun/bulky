import Decimal from 'decimal.js';
import { KIND_PURCHASE, type Purchase } from '../store/purchases/purchases.models';

export type YearSummary = {
  Year: string;
  Quantity: Decimal;
  Amount: Decimal;
};

export function yearlySummaries(purchases: Purchase[]): YearSummary[] {
  const order: string[] = [];
  const byYear = new Map<string, YearSummary>();
  for (const p of purchases) {
    if (p.Kind !== KIND_PURCHASE) continue;
    let year = p.BoughtOn;
    if (year.length >= 4) year = year.slice(0, 4);
    let s = byYear.get(year);
    if (!s) {
      s = { Year: year, Quantity: new Decimal(0), Amount: new Decimal(0) };
      byYear.set(year, s);
      order.push(year);
    }
    s.Quantity = s.Quantity.add(p.Quantity);
    s.Amount = s.Amount.add(p.Amount);
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
