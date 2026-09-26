import { Decimal } from 'decimal.js';
import type { Product } from './products.models.js';

export type ProductRow = {
  id: number;
  name: string;
  ean: string;
  unitId: number;
  unitName: string;
  compareValue: string;
  imagePath: string | null;
  createdAt: string;
};

export function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    ean: row.ean,
    unitId: row.unitId,
    unitName: row.unitName,
    compareValue: new Decimal(row.compareValue),
    imagePath: row.imagePath,
    createdAt: row.createdAt,
    conversions: [],
  };
}
