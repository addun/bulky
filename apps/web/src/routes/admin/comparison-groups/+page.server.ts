import { apiGet } from '$lib/admin/client';
export const load = async ({ url }) => {
  const body = await apiGet<{ groups: unknown[] }>('/api/admin/comparison-groups');
  return { groups: body.groups, error: url.searchParams.get('error') ?? '' };
};
