/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  corePlugins: {
    // PrimeVue + nos tokens gèrent déjà le reset (cf. style.css). On garde
    // Tailwind sans preflight pour ne pas écraser les valeurs PrimeVue.
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Aligné sur les CSS vars de `src/assets/tokens.css`.
        surface: {
          0: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          150: '#e9eef4',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04)',
        pop: '0 8px 24px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)',
      },
      borderRadius: {
        md2: '7px',
      },
    },
  },
  plugins: [],
}
