import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => {
  const body = await apiGet<{ kind: string; receipt: { status: string } }>(`/api/admin/receipts/${params.id}`);
  return { status: body.receipt.status };
};

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend('DELETE', `/api/admin/receipts/${params.id}`);
    if (!result.ok) return rejected(result.status, result.message);
    redirect(303, '/admin/receipts');
  },
};
