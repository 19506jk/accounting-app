import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-xlsx',
              test: /node_modules[\\/]xlsx/,
              priority: 30,
            },
            {
              name: 'vendor-query',
              test: /node_modules[\\/]@tanstack/,
              priority: 20,
            },
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom)/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/api/**/*.{ts,tsx}',
        'src/components/**/*.{ts,tsx}',
        'src/context/**/*.{ts,tsx}',
        'src/utils/**/*.{ts,tsx}',
        'src/pages/**/*Helpers.ts',
        'src/pages/**/*Modal.tsx',
        'src/pages/**/*Tab.tsx',
        'src/pages/bills/BillForm.tsx',
        'src/pages/bills/BillsTable.tsx',
        'src/pages/importCsv/ImportSetupPanel.tsx',
        'src/pages/reports/ReportSections.tsx',
        'src/pages/reports/reportRenderers.tsx',
        'src/pages/reports/reportExports.ts',
      ],
      exclude: [
        'src/main.tsx',
        'src/test/**',
        'src/pages/*.tsx',
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        'src/pages/importCsv/importCsvTypes.ts',
      ],
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 30,
        lines: 30,
      },
    },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      isolate: false,
      instances: [
        {
          browser: 'chromium',
        },
      ],
    },
  },
});
