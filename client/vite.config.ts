import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          const pdfVendorPackages = [
            '@react-pdf',
            'marked',
            'fontkit',
            'browserify-zlib',
            'crypto-js',
            'jay-peg',
            'vite-compatible-readable-stream',
            'brotli',
            'clone',
            'dfa',
            'fast-deep-equal',
            'linebreak',
            'pako',
            'restructure',
            'tiny-inflate',
            'unicode-properties',
            'unicode-trie',
          ];

          if (pdfVendorPackages.some((pkg) => id.includes(`node_modules/${pkg}`))) return 'vendor-pdf';
          if (id.includes('xlsx')) return 'vendor-xlsx';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'vendor-react';
        },
      },
    },
  },
});
