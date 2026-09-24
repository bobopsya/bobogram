import { defineConfig } from 'vitest/config';

// Интеграционные тесты базы: нужен запущенный локальный Supabase (npx supabase start).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
