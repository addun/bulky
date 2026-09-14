import type { Product } from './products.models';

export type ProductRow = {
  id: number;
  name: string;
  unitId: number;
  unitName: string;
  imagePath: string | null;
  createdAt: string;
};

export function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    unitId: row.unitId,
    unitName: row.unitName,
    imagePath: row.imagePath,
    createdAt: row.createdAt,
    conversions: [],
  };
}
