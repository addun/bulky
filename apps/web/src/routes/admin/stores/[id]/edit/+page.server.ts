import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formCoord, formInt, formJson, formText, rejected } from '$lib/admin/client';

export const load = async ({ params }) => apiGet(`/api/admin/stores/${params.id}`);

export const actions = {
  default: async ({ request, params }) => {
    const form = formJson(await request.formData());
    const result = await apiSend('PATCH', `/api/admin/stores/${params.id}`, { json: storeJson(form) });
    if (!result.ok) {
      return rejected(result.status, result.message, {
        store: {
          id: Number(params.id), name: form.name, streetName: form.street_name, buildingNumber: form.building_number,
          apartmentNumber: form.apartment_number, postalCode: form.postal_code, city: form.city,
          externalId: form.external_id, lat: form.lat, lng: form.lng, retailChainId: form.retail_chain_id,
        },
      });
    }
    redirect(303, '/admin/stores');
  },
};

function storeJson(form: Record<string, unknown>) {
  return {
    name: formText(form, 'name'),
    street_name: formText(form, 'street_name'),
    building_number: formText(form, 'building_number'),
    apartment_number: formText(form, 'apartment_number'),
    postal_code: formText(form, 'postal_code'),
    city: formText(form, 'city'),
    external_id: formText(form, 'external_id'),
    lat: formCoord(form, 'lat'),
    lng: formCoord(form, 'lng'),
    next: formText(form, 'next'),
    retail_chain_id: formInt(form, 'retail_chain_id'),
  };
}
