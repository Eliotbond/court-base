import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    // Minimal PWA setup. À étendre avec un service worker FCM (firebase-messaging-sw.js)
    // dans une PR ultérieure. Pour l'instant on n'enregistre pas de SW autoUpdate.
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Courtbase — Companion club',
        short_name: 'Courtbase',
        description:
          "App du personnel du club (coachs, officiels, admins). À installer sur l'écran d'accueil pour recevoir les notifications.",
        theme_color: '#10b981',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'fr',
        scope: '/',
        start_url: '/',
        icons: [
          // Placeholder paths — à remplacer par les vraies icônes du club lors du provisioning.
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Pas de précache agressif — on évite de servir une UI obsolète après deploy.
        // Seul le shell critique est mis en cache. À itérer.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__/, /^\/firebase-messaging-sw\.js/],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Force `.ts` before `.js` so stale compiled artefacts don't shadow the real source.
    // Cf. memory `vite_js_shadow_trap`.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json', '.vue'],
  },
  server: {
    port: 5175,
  },
})
