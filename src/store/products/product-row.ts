import { imagePath, type Product } from './products.models';

export type ProductRow = {
  ID: number;
  Name: string;
  UnitID: number;
  UnitName: string;
  image_path: string | null;
  CreatedAt: string;
};

export function mapProduct(row: ProductRow): Product {
  return {
    ID: row.ID,
    Name: row.Name,
    UnitID: row.UnitID,
    UnitName: row.UnitName,
    ImagePath: imagePath(row.image_path),
    CreatedAt: row.CreatedAt,
    Conversions: [],
  };
}
