import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formInt, formJson, formText, rejected } from '$lib/admin/client';

export const load = async ({ url }) => {
  const product = url.searchParams.get('product') ?? '';
  return apiGet('/api/admin/aliases/new' + (product ? '?product=' + encodeURIComponent(product) : ''));
};

export const actions = {
  default: async ({ request, url }) => {
    const form = formJson(await request.formData());
    const result = await apiSend('POST', '/api/admin/aliases', {
      json: { product_id: formInt(form, 'product_id'), scope: formText(form, 'scope'), alias: formText(form, 'alias') },
    });
    if (!result.ok) return rejected(result.status, result.message, aliasDraft(form));
    const from = Number(form.from_product) || Number(url.searchParams.get('product')) || 0;
    redirect(303, from > 0 ? `/admin/aliases?product=${from}` : '/admin/aliases');
  },
};

function aliasDraft(json: Record<string, unknown>) {
  return {
    alias: { productId: json.product_id, alias: json.alias, scopeValue: json.scope },
    fromProduct: json.from_product,
  };
}
