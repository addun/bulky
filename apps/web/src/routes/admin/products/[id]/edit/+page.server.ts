import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formJson, multipart, rejected } from '$lib/admin/client';

async function save(request: Request, productId: number) {
  const form = await request.formData();
  const json = formJson(form);
  const path = productId ? `/api/admin/products/${productId}` : '/api/admin/products';
  const result = await apiSend<{ id: number }>(productId ? 'PATCH' : 'POST', path, { form: multipart(form) });
  if (!result.ok) {
    const shell = await apiGet<{ product: Record<string, unknown>; units: unknown[]; groups: { id: number }[] }>(
      productId ? `/api/admin/products/${productId}/edit` : '/api/admin/products/new',
    );
    const selected = new Set(list(json.group_id).map((id) => Number(id)));
    const ids = list(json.extra_unit_id);
    const factors = list(json.extra_factor);
    const conversions = [];
    for (let i = 0; i < Math.max(ids.length, factors.length); i++) {
      if (!ids[i] && !factors[i]) continue;
      conversions.push({ unitId: Number(ids[i]) || 0, factor: factors[i] ?? '' });
    }
    return rejected(result.status, result.message, {
      product: { ...shell.product, id: productId, name: json.name, ean: json.ean, unitId: json.unit_id, conversions },
      units: shell.units,
      groups: shell.groups.map((group) => ({ ...group, selected: selected.has(group.id) })),
    });
  }
  redirect(303, `/admin/products/${result.data.id}`);
}

function list(value: unknown): string[] {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

export const load = async ({ params }) => apiGet(`/api/admin/products/${params.id}/edit`);
export const actions = { default: async ({ request, params }) => save(request, Number(params.id)) };
