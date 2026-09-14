export type Story = {
  ID: number;
  Name: string;
  StreetName: string;
  BuildingNumber: string;
  ApartmentNumber: string;
  PostalCode: string;
  City: string;
  ExternalID: string;
  RetailChainID: number;
  RetailChainName: string;
  PurchaseCount: number;
};

export type RetailChain = {
  ID: number;
  Name: string;
  LegalName: string;
  TaxID: string;
  StoryCount: number;
};

export function storyStreetLine(c: Story): string {
  let s = `${c.StreetName} ${c.BuildingNumber}`.trim();
  if (c.ApartmentNumber !== '') s += `/${c.ApartmentNumber}`;
  return s;
}

export function storyAddressLine(c: Story): string {
  const street = storyStreetLine(c);
  const loc = `${c.PostalCode} ${c.City}`.trim();
  if (street !== '' && loc !== '') return `${street}, ${loc}`;
  if (street !== '') return street;
  return loc;
}

export function storyLabel(c: Story): string {
  const addr = storyAddressLine(c);
  return addr === '' ? c.Name : `${c.Name} — ${addr}`;
}

export function chainLabel(c: RetailChain): string {
  if (c.LegalName === '' || c.LegalName.toLowerCase() === c.Name.toLowerCase()) return c.Name;
  return `${c.Name} — ${c.LegalName}`;
}
