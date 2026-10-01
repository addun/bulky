import { apiGet } from '$lib/admin/client';
export const load = async ({ url }) => {
  const body = await apiGet<{ stores: unknown[] }>('/api/admin/stores');
  return { stores: body.stores, error: url.searchParams.get('error') ?? '' };
};
