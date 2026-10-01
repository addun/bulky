import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet(`/api/admin/products/${params.id}/merge/${params.into}`);

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend<{ id: number }>('POST', `/api/admin/products/${params.id}/merge`, { json: { into_id: Number(params.into) } });
    if (!result.ok) return rejected(result.status, result.message);
    redirect(303, `/admin/products/${result.data.id}`);
  },
};
