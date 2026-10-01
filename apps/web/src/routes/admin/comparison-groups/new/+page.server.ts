import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formInt, formInts, formJson, formText, rejected } from '$lib/admin/client';

export const load = async () => apiGet('/api/admin/comparison-groups/new');

export const actions = {
  default: async ({ request }) => {
    const form = formJson(await request.formData());
    const result = await apiSend('POST', '/api/admin/comparison-groups', {
      json: { name: formText(form, 'name'), unit_id: formInt(form, 'unit_id'), product_id: formInts(form, 'product_id') },
    });
    if (!result.ok) {
      const shell = await apiGet<{ units: unknown[]; products: { id: number }[] }>('/api/admin/comparison-groups/new');
      return rejected(result.status, result.message, {
        group: { id: 0, name: form.name, unitId: form.unit_id },
        units: shell.units,
        products: mark(shell.products, form.product_id),
      });
    }
    redirect(303, '/admin/comparison-groups');
  },
};

function mark(products: { id: number }[], selected: unknown) {
  const ids = new Set((Array.isArray(selected) ? selected : selected == null ? [] : [selected]).map((id) => Number(id)));
  return products.map((product) => ({ ...product, selected: ids.has(product.id) }));
}
