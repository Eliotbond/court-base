import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Force `.ts` resolution before `.js` so stale compiled artefacts (e.g.
    // `router/index.js` from a previous `tsc --emit` run) don't shadow the
    // real source. Vite default is `['.mjs', '.js', '.mts', '.ts', …]`.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
  server: {
    port: 5173,
  },
})
