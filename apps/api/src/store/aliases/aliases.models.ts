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

/** OCR till names gain or lose spaces; aliases are stored without whitespace. */
export function stripAliasWhitespace(alias: string): string {
  return alias.replace(/\s+/gu, '');
}

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
