import type { ImportedShop } from '../store/locations/locations.models.js';
import { biedronkaShopsResponse, type BiedronkaShop } from './biedronka.schema.js';

export const biedronkaShopsURL = 'https://moja.biedronka.pl/sklepy';
const biedronkaShopsUA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const biedronkaShopsMaxBody = 5 << 20;

export type { ImportedShop };

export function shopsFromBiedronka(payload: unknown): BiedronkaShop[] {
  const parsed = biedronkaShopsResponse.safeParse(payload);
  if (!parsed.success) throw new Error('Biedronka shop list has an unexpected shape');
  if (!parsed.data.success) throw new Error('Biedronka shop list failed');
  return parsed.data.data;
}

export function importedShopsFromBiedronka(shops: BiedronkaShop[]): ImportedShop[] {
  const out: ImportedShop[] = [];
  for (const shop of shops) {
    const mapped = importedShopFromBiedronka(shop);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function importedShopFromBiedronka(shop: BiedronkaShop): ImportedShop | null {
  const name = shop.name.trim();
  if (name === '') return null;
  return {
    name,
    streetName: (shop.street ?? '').trim(),
    buildingNumber: (shop.streetNr ?? '').trim(),
    city: (shop.city ?? '').trim(),
    externalId: String(shop.shopNr),
    lat: shop.lat,
    lng: shop.lng,
  };
}

export async function fetchBiedronkaShops(): Promise<BiedronkaShop[]> {
  let resp: Response;
  try {
    resp = await fetch(biedronkaShopsURL, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': biedronkaShopsUA,
        Referer: biedronkaShopsURL,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Could not reach Biedronka');
  }
  if (!resp.ok) throw new Error('Could not load Biedronka shops');
  const text = await resp.text();
  if (text.length > biedronkaShopsMaxBody) throw new Error('Biedronka shop list is too large');
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Biedronka shop list is not JSON');
  }
  return shopsFromBiedronka(payload);
}
