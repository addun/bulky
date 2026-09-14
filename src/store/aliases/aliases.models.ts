export type ProductAlias = {
  id: number;
  productId: number;
  productName: string;
  storyId: number | null;
  storyName: string;
  retailChainId: number | null;
  retailChainName: string;
  alias: string;
};

export function aliasScopeValue(a: ProductAlias): string {
  if (a.storyId) return `story:${a.storyId}`;
  if (a.retailChainId) return `chain:${a.retailChainId}`;
  return '';
}

export function aliasScopeLabel(a: ProductAlias): string {
  if (a.storyId) return a.storyName;
  if (a.retailChainId) return a.retailChainName;
  return 'any shop';
}
