import type { AdminProductResponse, AdminProductsResponse } from '../../../../../api/src/features/admin/products/contract/response';

const LIMIT = 40;

export const load = async ({ url, fetch }: { url: URL; fetch: typeof globalThis.fetch }) => {
  const q = url.searchParams.get('q') ?? '';
  const params = new URLSearchParams({ q, offset: '0', limit: String(LIMIT) });
  const devServer = import.meta.env.DEV && typeof window === 'undefined';
  const endpoint = `${devServer ? 'http://127.0.0.1:8080' : ''}/api/admin/products.json?${params}`;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      return { products: [] as AdminProductResponse[], currency: '', loadError: 'Could not load products.' };
    }
    const body = (await res.json()) as AdminProductsResponse;
    return { products: body.products, currency: body.currency, loadError: '' };
  } catch {
    return { products: [] as AdminProductResponse[], currency: '', loadError: 'API is unavailable.' };
  }
};
