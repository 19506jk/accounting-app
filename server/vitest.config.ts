import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@shared/contracts': path.resolve(__dirname, '../shared/contracts.d.ts'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--require', 'tsx/cjs'],
      },
    },
    include: ['**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'db/migrations/**', 'db/seeds/**'],
    sequence: {
      concurrent: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['**/*.ts'],
      thresholds: {
        statements: 74,
        branches: 60,
        functions: 69,
        lines: 74,
      },
      exclude: [
        'db/migrations/**',
        'db/seeds/**',
        'dist/**',
        '**/*.d.ts',
        'index.ts',
        '**/*.config.*',
        'knexfile.ts',
        'ecosystem.config.cjs',
        'types/**',
        '**/*.tsx',
        '**/*.test.ts',
        'routes/routeTestHelpers.ts',
      ],
    },
  },
});
