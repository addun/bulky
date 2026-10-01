import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formInt, formJson, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet(`/api/admin/products/${params.id}/change-unit`);

export const actions = {
  default: async ({ request, params }) => {
    const form = formJson(await request.formData());
    const result = await apiSend('POST', `/api/admin/products/${params.id}/change-unit`, { json: { unit_id: formInt(form, 'unit_id') } });
    if (!result.ok) return rejected(result.status, result.message, { newUnitId: form.unit_id });
    redirect(303, `/admin/products/${params.id}`);
  },
};
