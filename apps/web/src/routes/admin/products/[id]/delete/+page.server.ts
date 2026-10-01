import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => {
  const body = await apiGet<{ product: { name: string } }>(`/api/admin/products/${params.id}`);
  return { product: body.product };
};

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend('DELETE', `/api/admin/products/${params.id}`);
    if (!result.ok) return rejected(result.status, result.message);
    redirect(303, '/admin/products');
  },
};
