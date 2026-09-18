export type Store = {
  id: number;
  name: string;
  streetName: string;
  buildingNumber: string;
  apartmentNumber: string;
  postalCode: string;
  city: string;
  externalId: string;
  lat: number | null;
  lng: number | null;
  retailChainId: number | null;
  retailChainName: string;
  purchaseCount: number;
};

export type RetailChain = {
  id: number;
  name: string;
  legalName: string;
  taxId: string;
  storeCount: number;
};

export function storeStreetLine(c: Store): string {
  let s = `${c.streetName} ${c.buildingNumber}`.trim();
  if (c.apartmentNumber !== '') s += `/${c.apartmentNumber}`;
  return s;
}

export function storeAddressLine(c: Store): string {
  const street = storeStreetLine(c);
  const loc = `${c.postalCode} ${c.city}`.trim();
  if (street !== '' && loc !== '') return `${street}, ${loc}`;
  if (street !== '') return street;
  return loc;
}

export function storeLabel(c: Store): string {
  const addr = storeAddressLine(c);
  return addr === '' ? c.name : `${c.name} — ${addr}`;
}

export function chainLabel(c: RetailChain): string {
  if (c.legalName === '' || c.legalName.toLowerCase() === c.name.toLowerCase()) return c.name;
  return `${c.name} — ${c.legalName}`;
}
