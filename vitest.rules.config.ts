import { defineConfig } from 'vitest/config';

// Тесты правил Firestore: запускаются внутри `firebase emulators:exec` (npm run test:rules).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
