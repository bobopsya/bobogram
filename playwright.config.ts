import { defineConfig } from '@playwright/test';

// E2E-тесты идут против эмуляторов Firebase: npm run test:e2e
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173/bobogram/',
    locale: 'ru-RU',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
      // Фейковые камера и микрофон для теста звонков.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort --host 127.0.0.1',
    env: { VITE_USE_EMULATORS: 'true' },
    url: 'http://127.0.0.1:5173/bobogram/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
