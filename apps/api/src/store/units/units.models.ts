import type { Decimal } from 'decimal.js';

export type Unit = {
  id: number;
  name: string;
  compareValue: Decimal;
  productCount: number;
};

export type UnitDefaults = {
  pieceId: number | null;
  weightId: number | null;
};
