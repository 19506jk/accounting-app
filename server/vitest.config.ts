import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    pool: 'forks',
    execArgv: ['--require', 'tsx/cjs'],
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
        statements: 69,
        branches: 58,
        functions: 81,
        lines: 72,
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
