import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formInt, formJson, formText, rejected } from '$lib/admin/client';

export const load = async () => apiGet<Record<string, unknown>>('/api/admin/settings');

export const actions = {
  default: async ({ request }) => {
    const form = formJson(await request.formData());
    const result = await apiSend('PATCH', '/api/admin/settings', {
      json: {
        ocr_model: formText(form, 'ocr_model'),
        piece_unit_id: formInt(form, 'piece_unit_id'),
        weight_unit_id: formInt(form, 'weight_unit_id'),
      },
    });
    if (!result.ok) return rejected(result.status, result.message, { ocrModel: form.ocr_model, defaults: { pieceId: form.piece_unit_id, weightId: form.weight_unit_id } });
    redirect(303, '/admin/settings');
  },
};
