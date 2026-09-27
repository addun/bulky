import type { Handle } from '@sveltejs/kit';

const API_ORIGIN = process.env.API_ORIGIN ?? '';

/** In Docker, the page and the old screens share this origin. Vite already proxies them in dev. */
function proxied(pathname: string): boolean {
  if (!API_ORIGIN) return false;
  if (pathname === '/' || pathname.startsWith('/_app')) return false;
  return true;
}

export const handle: Handle = async ({ event, resolve }) => {
  if (!proxied(event.url.pathname)) return resolve(event);

  const target = new URL(event.url.pathname + event.url.search, API_ORIGIN);
  const headers = new Headers(event.request.headers);
  headers.delete('host');
  const hasBody = event.request.method !== 'GET' && event.request.method !== 'HEAD';
  return fetch(target, {
    method: event.request.method,
    headers,
    body: hasBody ? event.request.body : undefined,
    redirect: 'manual',
    ...(hasBody ? { duplex: 'half' as const } : {}),
  });
};
