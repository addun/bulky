import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formInt, formJson, formText, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet(`/api/admin/products/${params.id}/purchases/new`);

export const actions = {
  default: async ({ request, params }) => {
    const form = formJson(await request.formData());
    const result = await apiSend<{ productId: number }>('POST', `/api/admin/products/${params.id}/purchases`, { json: purchaseJson(form) });
    if (!result.ok) return rejected(result.status, result.message, { purchase: purchaseDraft(form) });
    redirect(303, `/admin/products/${params.id}`);
  },
};

function purchaseJson(form: Record<string, unknown>) {
  return {
    store_id: formInt(form, 'store_id'),
    kind: formText(form, 'kind'),
    bought_on: formText(form, 'bought_on'),
    amount: formText(form, 'amount'),
    quantity: formText(form, 'quantity'),
  };
}

function purchaseDraft(json: Record<string, unknown>) {
  return { storeId: json.store_id, kind: json.kind, boughtOn: json.bought_on, amount: json.amount, quantity: json.quantity, isPrice: json.kind === 'price' };
}
