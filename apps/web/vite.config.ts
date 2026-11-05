import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const RUNTIME = process.env.NEXO_RUNTIME_URL ?? 'http://127.0.0.1:7420';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: RUNTIME, changeOrigin: true },
      '/ws': { target: RUNTIME.replace('http', 'ws'), ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
