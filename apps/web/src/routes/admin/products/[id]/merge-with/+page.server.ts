import { redirect } from '@sveltejs/kit';
import { apiGet, formJson, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet(`/api/admin/products/${params.id}/merge`);

export const actions = {
  default: async ({ request, params }) => {
    const json = formJson(await request.formData());
    const into = Number(json.into_id) || 0;
    if (!into) return rejected(422, 'Choose a product.', { intoId: 0 });
    redirect(303, `/admin/products/${params.id}/merge-with/${into}`);
  },
};
