import { defineConfig } from '@playwright/test';

// E2E-тесты идут против локального Supabase: npm run db:start && npm run test:e2e
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
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      // Стандартный демо-ключ локального Supabase (не секретный).
      VITE_SUPABASE_ANON_KEY:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    },
    url: 'http://127.0.0.1:5173/bobogram/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
