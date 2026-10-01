import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const api = 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/images': api,
      '/static': api,
      '/mcp': api,
      '/admin': {
        target: api,
        bypass(req) {
          const path = (req.url ?? '').split('?')[0] ?? '';
          if (/^\/admin\/receipts\/\d+\/preview$/.test(path)) return;
          if (path === '/admin' || path.startsWith('/admin/')) return req.url;
        },
      },
    },
  },
});
