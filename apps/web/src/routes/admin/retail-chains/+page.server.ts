import { redirect } from '@sveltejs/kit';
import { apiGet } from '$lib/admin/client';

export const load = async ({ url }) => {
  const body = await apiGet<{ retailChains: unknown[] }>('/api/admin/retail-chains');
  return { retailChains: body.retailChains, error: url.searchParams.get('error') ?? '' };
};
