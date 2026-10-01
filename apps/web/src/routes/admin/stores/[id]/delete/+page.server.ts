import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => {
  const body = await apiGet<{ store: { name: string; purchaseCount: number } }>(`/api/admin/stores/${params.id}`);
  if (body.store.purchaseCount > 0) {
    redirect(303, '/admin/stores?error=' + encodeURIComponent(`Cannot delete “${body.store.name}” while a purchase still uses it.`));
  }
  return { store: body.store };
};

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend('DELETE', `/api/admin/stores/${params.id}`);
    if (!result.ok) {
      if (result.status === 409) redirect(303, '/admin/stores?error=' + encodeURIComponent(result.message));
      return rejected(result.status, result.message);
    }
    redirect(303, '/admin/stores');
  },
};
