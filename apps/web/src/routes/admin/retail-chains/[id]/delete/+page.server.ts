import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => {
  const chain = await apiGet<{ name: string; storeCount: number }>(`/api/admin/retail-chains/${params.id}`);
  if (chain.storeCount > 0) {
    redirect(303, '/admin/retail-chains?error=' + encodeURIComponent(`Cannot delete “${chain.name}” while a store still uses it.`));
  }
  return { chain };
};

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend('DELETE', `/api/admin/retail-chains/${params.id}`);
    if (!result.ok) {
      if (result.status === 409) redirect(303, '/admin/retail-chains?error=' + encodeURIComponent(result.message));
      return rejected(result.status, result.message);
    }
    redirect(303, '/admin/retail-chains');
  },
};
