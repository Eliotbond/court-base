import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Force `.ts` before `.js` so stale compiled artefacts (e.g. `router/index.js`
    // from a previous tsc emit) don't shadow the real source.
    // Cf. memory `vite_js_shadow_trap`.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json', '.vue'],
  },
  server: {
    port: 5174,
  },
})
