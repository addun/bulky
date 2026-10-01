import { apiGet } from '$lib/admin/client';
export const load = async () => apiGet('/api/admin/imports');
