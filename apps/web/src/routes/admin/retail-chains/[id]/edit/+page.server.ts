import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formJson, rejected } from '$lib/admin/client';

export const load = async ({ params }) => ({ retailChain: await apiGet(`/api/admin/retail-chains/${params.id}`) });

export const actions = {
  default: async ({ request, params }) => {
    const json = formJson(await request.formData());
    const result = await apiSend('PATCH', `/api/admin/retail-chains/${params.id}`, { json });
    if (!result.ok) {
      return rejected(result.status, result.message, {
        retailChain: { id: Number(params.id), name: json.name, legalName: json.legal_name, taxId: json.tax_id },
      });
    }
    redirect(303, '/admin/retail-chains');
  },
};
