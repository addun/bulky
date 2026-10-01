import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, multipart, rejected } from '$lib/admin/client';

export const load = async ({ url }) => {
  const body = await apiGet<Record<string, unknown>>('/api/admin/receipts');
  return { ...body, error: url.searchParams.get('error') ?? '' };
};

export const actions = {
  default: async ({ request }) => {
    const result = await apiSend<{ id: number }>('POST', '/api/admin/receipts', { form: multipart(await request.formData()) });
    if (!result.ok) return rejected(result.status, result.message);
    redirect(303, `/admin/receipts/${result.data.id}`);
  },
};
