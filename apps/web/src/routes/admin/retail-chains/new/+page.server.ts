import { redirect } from '@sveltejs/kit';
import { apiSend, formJson, rejected } from '$lib/admin/client';

export const actions = {
  default: async ({ request }) => {
    const json = formJson(await request.formData());
    const result = await apiSend('POST', '/api/admin/retail-chains', { json });
    if (!result.ok) {
      return rejected(result.status, result.message, {
        retailChain: { id: 0, name: json.name, legalName: json.legal_name, taxId: json.tax_id },
      });
    }
    redirect(303, '/admin/retail-chains');
  },
};
