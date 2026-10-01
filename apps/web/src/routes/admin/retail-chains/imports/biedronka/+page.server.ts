import { apiGet, apiSend, formInt, formJson, rejected } from '$lib/admin/client';

export const load = async () => apiGet('/api/admin/imports/biedronka');

export const actions = {
  default: async ({ request }) => {
    const form = formJson(await request.formData());
    const result = await apiSend<{ retailChainId: number; result: unknown }>('POST', '/api/admin/imports/biedronka', {
      json: { retail_chain_id: formInt(form, 'retail_chain_id') },
    });
    if (!result.ok) return rejected(result.status, result.message, { retailChainId: form.retail_chain_id });
    return { retailChainId: result.data.retailChainId, result: result.data.result };
  },
};
