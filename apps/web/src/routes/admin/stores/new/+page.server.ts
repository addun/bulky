import { redirect } from '@sveltejs/kit';
import { apiGet, apiSend, formCoord, formInt, formJson, formText, rejected } from '$lib/admin/client';

export const load = async ({ url }) => apiGet('/api/admin/stores/new' + url.search);

export const actions = {
  default: async ({ request }) => {
    const form = formJson(await request.formData());
    const result = await apiSend<{ id: number; next?: string }>('POST', '/api/admin/stores', { json: storeJson(form) });
    if (!result.ok) return rejected(result.status, result.message, { store: storeDraft(form), next: form.next ?? '' });
    redirect(303, result.data.next || '/admin/stores');
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

function storeDraft(json: Record<string, unknown>) {
  return {
    name: json.name, streetName: json.street_name, buildingNumber: json.building_number,
    apartmentNumber: json.apartment_number, postalCode: json.postal_code, city: json.city,
    externalId: json.external_id, lat: json.lat, lng: json.lng, retailChainId: json.retail_chain_id,
  };
}
