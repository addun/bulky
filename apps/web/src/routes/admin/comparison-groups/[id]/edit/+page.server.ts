import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formInt, formInts, formJson, formText, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet(`/api/admin/comparison-groups/${params.id}`);

export const actions = {
  default: async ({ request, params }) => {
    const form = formJson(await request.formData());
    const result = await apiSend('PATCH', `/api/admin/comparison-groups/${params.id}`, {
      json: { name: formText(form, 'name'), unit_id: formInt(form, 'unit_id'), product_id: formInts(form, 'product_id') },
    });
    if (!result.ok) {
      const shell = await apiGet<{ units: unknown[]; products: { id: number }[] }>(`/api/admin/comparison-groups/${params.id}`);
      const ids = new Set(formInts(form, 'product_id'));
      return rejected(result.status, result.message, {
        group: { id: Number(params.id), name: form.name, unitId: form.unit_id },
        units: shell.units,
        products: shell.products.map((product) => ({ ...product, selected: ids.has(product.id) })),
      });
    }
    redirect(303, '/admin/comparison-groups');
  },
};
