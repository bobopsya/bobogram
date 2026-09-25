import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const base = process.env.BASE_PATH || '/';

export default defineConfig({
  // Сайт живёт в корне своего домена bobogram.org. Без домена (…github.io/bobogram/) —
  // задать переменную BASE_PATH=/bobogram/ в Settings → Secrets and variables → Actions → Variables.
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
      manifest: {
        name: 'Bobogram',
        short_name: 'Bobogram',
        description: 'Мессенджер для друзей',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#17212b',
        theme_color: '#2aabee',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
