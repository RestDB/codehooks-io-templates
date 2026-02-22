import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Update this URL after running `coho create` in the backend/ directory.
// Run `coho info` to get your project URL.
const BACKEND_URL = 'https://YOUR_PROJECT.api.codehooks.io/dev';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: true,
      },
      '/auth': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: true,
      },
      '/openapi': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    outDir: '../backend/dist',
    emptyOutDir: true,
  },
});
