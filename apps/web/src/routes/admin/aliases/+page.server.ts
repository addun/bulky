import { apiGet } from '$lib/admin/client';
export const load = async ({ url }) => {
  const product = url.searchParams.get('product') ?? '';
  const body = await apiGet<Record<string, unknown>>('/api/admin/aliases' + (product ? '?product=' + encodeURIComponent(product) : ''));
  return { ...body, error: url.searchParams.get('error') ?? '' };
};
