import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formJson, rejected } from '$lib/admin/client';

export const load = async ({ url }) => {
  const body = await apiGet<{ units: unknown[] }>('/api/admin/units');
  return { units: body.units, error: url.searchParams.get('error') ?? '' };
};

export const actions = {
  default: async ({ request }) => {
    const result = await apiSend('POST', '/api/admin/units', { json: formJson(await request.formData()) });
    if (!result.ok) return rejected(result.status, result.message);
    redirect(303, '/admin/units');
  },
};
