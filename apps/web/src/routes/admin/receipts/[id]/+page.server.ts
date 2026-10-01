import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formJson, rejected } from '$lib/admin/client';

export const load = async ({ params, url }) => {
  const body = await apiGet<Record<string, unknown>>(`/api/admin/receipts/${params.id}`);
  return { ...body, error: url.searchParams.get('error') ?? '', imported: Number(url.searchParams.get('imported')) || 0 };
};

export const actions = {
  default: async ({ request, params }) => {
    const result = await apiSend<{ imported: number }>('POST', `/api/admin/receipts/${params.id}/confirm`, {
      json: formJson(await request.formData()),
    });
    if (!result.ok) {
      if (result.body.view) return rejected(result.status, result.message, result.body);
      return rejected(result.status, result.message);
    }
    redirect(303, `/admin/receipts/${params.id}?imported=${result.data.imported}`);
  },
  retry: async ({ params }) => {
    const result = await apiSend('POST', `/api/admin/receipts/${params.id}/retry`);
    if (!result.ok) redirect(303, `/admin/receipts/${params.id}?error=${encodeURIComponent(result.message)}`);
    redirect(303, `/admin/receipts/${params.id}`);
  },
};
