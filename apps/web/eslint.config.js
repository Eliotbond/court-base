import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.d.ts',
      // Compiled .vue.js / .ts.js artefacts (vue-tsc emit). Source-of-truth = .vue / .ts.
      'src/**/*.vue.js',
      'src/**/*.js',
    ],
  },
  {
    files: ['**/*.{ts,vue}'],
  },
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
