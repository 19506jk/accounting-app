import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['endian-server.tail8f0744.ts.net'],
    host: '0.0.0.0',
    proxy: {
      // All /api requests proxied to Express during development.
      // In production, Nginx handles the same proxy — no code changes needed.
      '/api': {
        target:       'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
