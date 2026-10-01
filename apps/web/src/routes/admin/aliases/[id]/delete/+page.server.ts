import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params, url }) => {
  const body = await apiGet<{ alias: { alias: string } }>(`/api/admin/aliases/${params.id}`);
  return { alias: body.alias, product: url.searchParams.get('product') ?? '' };
};

export const actions = {
  default: async ({ params, url }) => {
    const result = await apiSend('DELETE', `/api/admin/aliases/${params.id}`);
    if (!result.ok) return rejected(result.status, result.message);
    const product = url.searchParams.get('product') ?? '';
    redirect(303, product ? `/admin/aliases?product=${encodeURIComponent(product)}` : '/admin/aliases');
  },
};
