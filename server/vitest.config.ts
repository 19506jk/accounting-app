import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      // The @react-pdf/renderer ESM bundle runs through Vite's module runner,
      // which cannot replicate the dynamic getter re-exports that
      // yoga-layout (a transitive CJS dependency) exposes. Loading the
      // renderer's native CommonJS bundle instead keeps the whole
      // renderer → layout → yoga chain inside Node's CJS loader, where
      // `import * as Yoga` interop works. Test-only; production ESM is
      // unaffected.
      '@react-pdf/renderer': require.resolve('@react-pdf/renderer'),
    },
  },
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
