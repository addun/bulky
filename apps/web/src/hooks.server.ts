import type { Handle } from '@sveltejs/kit';

const API_ORIGIN = process.env.API_ORIGIN ?? '';

function svelteAdmin(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function sveltePage(pathname: string): boolean {
  if (pathname === '/' || pathname === '/health' || pathname.startsWith('/_app')) return true;
  if (pathname === '/products' || pathname.startsWith('/products/')) return true;
  if (pathname === '/imports/biedronka' || pathname.startsWith('/imports/biedronka/')) return true;
  return svelteAdmin(pathname);
}

/** In Docker, JSON, images, and MCP still come from the API. */
function proxied(pathname: string): boolean {
  if (!API_ORIGIN) return false;
  return !sveltePage(pathname);
}

export const handle: Handle = async ({ event, resolve }) => {
  const admin = svelteAdmin(event.url.pathname);
  if (!proxied(event.url.pathname)) {
    return resolve(event, {
      transformPageChunk: ({ html }) =>
        admin
          ? html.replace('<html lang="pl">', '<html lang="en">').replace('<body', '<body class="is-admin"')
          : html,
    });
  }

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
