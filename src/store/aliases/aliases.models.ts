export type ProductAlias = {
  ID: number;
  ProductID: number;
  ProductName: string;
  StoryID: number;
  StoryName: string;
  RetailChainID: number;
  RetailChainName: string;
  Alias: string;
};

export function aliasScopeValue(a: ProductAlias): string {
  if (a.StoryID > 0) return `story:${a.StoryID}`;
  if (a.RetailChainID > 0) return `chain:${a.RetailChainID}`;
  return '';
}

export function aliasScopeLabel(a: ProductAlias): string {
  if (a.StoryID > 0) return a.StoryName;
  if (a.RetailChainID > 0) return a.RetailChainName;
  return 'any shop';
}
