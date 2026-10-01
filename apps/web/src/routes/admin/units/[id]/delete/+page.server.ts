import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, rejected } from '$lib/admin/client';

export const load = async ({ params }) => {
  const unit = await apiGet<{ name: string; productCount: number }>(`/api/admin/units/${params.id}`);
  if (unit.productCount > 0) {
    redirect(303, '/admin/units?error=' + encodeURIComponent(`Cannot delete “${unit.name}” while a product still uses it.`));
  }
  return { unit };
};

export const actions = {
  default: async ({ params }) => {
    const result = await apiSend('DELETE', `/api/admin/units/${params.id}`);
    if (!result.ok) {
      if (result.status === 409) redirect(303, '/admin/units?error=' + encodeURIComponent(result.message));
      return rejected(result.status, result.message);
    }
    redirect(303, '/admin/units');
  },
};
