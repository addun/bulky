import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formJson, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet<Record<string, unknown>>(`/api/admin/units/${params.id}`);

export const actions = {
  default: async ({ request, params }) => {
    const json = formJson(await request.formData());
    const result = await apiSend('PATCH', `/api/admin/units/${params.id}`, { json });
    if (!result.ok) {
      return rejected(result.status, result.message, {
        unit: { id: Number(params.id), name: json.name, compareValue: json.compare_value, productCount: 0 },
        compareInput: String(json.compare_value ?? ''),
      });
    }
    redirect(303, '/admin/units');
  },
};
