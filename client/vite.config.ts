import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const vitePort = Number(env.VITE_PORT) || 5173;
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:5000';
  const tailnetHost = env.TAILNET_HOST;
  const magicDnsHost = tailnetHost || 'endian-prod.tail8f0744.ts.net';
  const hmrClientPort = Number(env.VITE_HMR_CLIENT_PORT) || 8443;
  const googleClientId = mode === 'production'
    ? env.VITE_GOOGLE_CLIENT_ID_PROD
      || env.VITE_GOOGLE_CLIENT_ID
      || env.GOOGLE_CLIENT_ID_PROD
      || env.GOOGLE_CLIENT_ID
    : env.VITE_GOOGLE_CLIENT_ID_DEV
      || env.VITE_GOOGLE_CLIENT_ID
      || env.GOOGLE_CLIENT_ID_DEV
      || env.GOOGLE_CLIENT_ID;

  return {
  define: {
    __GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId || ''),
  },
  plugins: [react()],
  server: {
    port: vitePort,
    allowedHosts: [magicDnsHost],
    host: '0.0.0.0',
    ...(tailnetHost
      ? {
          hmr: {
            protocol: 'wss',
            host: tailnetHost,
            clientPort: hmrClientPort,
          },
        }
      : {}),
    proxy: {
      '/api': {
        target: apiProxyTarget,
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
    fileParallelism: false,
    deps: {
      optimizer: {
        web: {
          include: [
            '@vitest/browser/matchers',
            'vitest-browser-react',
            'vitest-browser-react/pure',
            '@react-oauth/google',
            '@tanstack/react-query',
            'axios',
            'dayjs',
            'react-router-dom',
            'xlsx',
          ],
        },
      },
    },
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
  };
});
