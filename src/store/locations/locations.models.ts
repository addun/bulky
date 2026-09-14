export type Story = {
  id: number;
  name: string;
  streetName: string;
  buildingNumber: string;
  apartmentNumber: string;
  postalCode: string;
  city: string;
  externalId: string;
  retailChainId: number | null;
  retailChainName: string;
  purchaseCount: number;
};

export type RetailChain = {
  id: number;
  name: string;
  legalName: string;
  taxId: string;
  storyCount: number;
};

export function storyStreetLine(c: Story): string {
  let s = `${c.streetName} ${c.buildingNumber}`.trim();
  if (c.apartmentNumber !== '') s += `/${c.apartmentNumber}`;
  return s;
}

export function storyAddressLine(c: Story): string {
  const street = storyStreetLine(c);
  const loc = `${c.postalCode} ${c.city}`.trim();
  if (street !== '' && loc !== '') return `${street}, ${loc}`;
  if (street !== '') return street;
  return loc;
}

export function storyLabel(c: Story): string {
  const addr = storyAddressLine(c);
  return addr === '' ? c.name : `${c.name} — ${addr}`;
}

export function chainLabel(c: RetailChain): string {
  if (c.legalName === '' || c.legalName.toLowerCase() === c.name.toLowerCase()) return c.name;
  return `${c.name} — ${c.legalName}`;
}
