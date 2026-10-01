import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => {
  const body = await apiGet<{ product: { id: number; name: string }; purchase: { kind: string } }>(`/api/admin/purchases/${params.id}`);
  return body;
};

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend<{ productId: number }>('DELETE', `/api/admin/purchases/${params.id}`);
    if (!result.ok) return rejected(result.status, result.message);
    redirect(303, `/admin/products/${result.data.productId}`);
  },
};
