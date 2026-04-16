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
    include: ['**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'db/migrations/**', 'db/seeds/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['**/*.ts'],
      exclude: [
        'db/migrations/**',
        'db/seeds/**',
        'dist/**',
        '**/*.config.*',
        'knexfile.ts',
        'ecosystem.config.cjs',
        'types/**',
        '**/*.test.ts',
      ],
    },
  },
});
