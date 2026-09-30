import { Decimal } from 'decimal.js';

const GROSZE_PER_ZLOTY = new Decimal(100);

export function toGrosze(amount: Decimal): number {
  const grosze = amount.mul(GROSZE_PER_ZLOTY);
  if (!grosze.isInteger()) throw new Error('amount must have at most 2 decimal places');
  return grosze.toNumber();
}

export function fromGrosze(grosze: number): Decimal {
  return new Decimal(grosze).div(GROSZE_PER_ZLOTY);
}
