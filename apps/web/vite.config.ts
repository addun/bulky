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
    },
  },
});
