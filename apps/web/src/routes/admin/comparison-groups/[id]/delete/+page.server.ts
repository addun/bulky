import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => {
  const body = await apiGet<{ group: { name: string } }>(`/api/admin/comparison-groups/${params.id}`);
  return { group: body.group };
};

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend('DELETE', `/api/admin/comparison-groups/${params.id}`);
    if (!result.ok) return rejected(result.status, result.message);
    redirect(303, '/admin/comparison-groups');
  },
};
