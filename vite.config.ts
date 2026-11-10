import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: '/piki-pushok/',
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${buildStamp} UTC)`),
  },
  build: { target: 'es2020', assetsInlineLimit: 0 },
  plugins: [
    VitePWA({
      // Обновление не перезагружает игру посреди процесса: см. src/pwa.ts
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'favicon.png'],
      manifest: {
        name: 'Пики Пушок',
        short_name: 'Пики Пушок',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'landscape',
        background_color: '#FFF4E2',
        theme_color: '#FFF4E2',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
