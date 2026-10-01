import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formInt, formJson, formText, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet(`/api/admin/receipts/${params.id}/edit`);

export const actions = {
  default: async ({ request, params }) => {
    const form = formJson(await request.formData());
    const result = await apiSend('PATCH', `/api/admin/receipts/${params.id}`, {
      json: { bought_on: formText(form, 'bought_on'), store_id: formInt(form, 'store_id') },
    });
    if (!result.ok) return rejected(result.status, result.message, { boughtOn: form.bought_on, store: { id: form.store_id } });
    redirect(303, `/admin/receipts/${params.id}`);
  },
};
