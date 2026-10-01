import { apiGet } from '$lib/admin/client';
export const load = async ({ params, url }) => {
  const body = await apiGet<Record<string, unknown>>(`/api/admin/products/${params.id}`);
  return { ...body, error: url.searchParams.get('error') ?? '' };
};
