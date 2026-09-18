export type ProductAlias = {
  id: number;
  productId: number;
  productName: string;
  storeId: number | null;
  storeName: string;
  retailChainId: number | null;
  retailChainName: string;
  alias: string;
};

export function aliasScopeValue(a: ProductAlias): string {
  if (a.storeId) return `store:${a.storeId}`;
  if (a.retailChainId) return `chain:${a.retailChainId}`;
  return '';
}

export function aliasScopeLabel(a: ProductAlias): string {
  if (a.storeId) return a.storeName;
  if (a.retailChainId) return a.retailChainName;
  return 'any shop';
}
