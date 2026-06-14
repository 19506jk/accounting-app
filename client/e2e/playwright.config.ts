import { defineConfig, devices } from '@playwright/test'

import { E2E_BASE_URL } from './constants'

const e2eApiUrl = 'http://localhost:5001'
const e2eClientUrl = new URL(E2E_BASE_URL)
const e2eClientPort = e2eClientUrl.port || '5174'

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  baseURL: E2E_BASE_URL,
  reporter: process.env.CI ? 'github' : 'list',
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'anonymous',
      testMatch: /.*\.anon\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'authenticated',
      testIgnore: /.*\.anon\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
    },
  ],
  webServer: [
    {
      command: 'cd ../server && npm run dev:test',
      url: `${e2eApiUrl}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --port ${e2eClientPort}`,
      env: {
        ...process.env,
        // The CLI flag is authoritative. VITE_PORT is kept for config parity.
        VITE_PORT: e2eClientPort,
        VITE_API_PROXY_TARGET: e2eApiUrl,
      },
      url: E2E_BASE_URL,
      reuseExistingServer: false,
    },
  ],
})
