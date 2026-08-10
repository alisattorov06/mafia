/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/**/*.html', './client/**/*.js'],
  theme: {
    extend: {
      colors: {
        noir: {
          950: '#0b0a08',
          900: '#100e0b',
          850: '#16130e',
          800: '#1c1811',
          700: '#262016',
          600: '#332b1c'
        },
        cream: { DEFAULT: '#ece3cd', dim: '#a99d82', faint: '#6f6650' },
        brass: { DEFAULT: '#d6a14b', bright: '#f0c878', deep: '#8a6427' },
        blood: { DEFAULT: '#c13a2e', bright: '#e55646', deep: '#7c2218' },
        moss: { DEFAULT: '#8aa05f', bright: '#b7c98a' },
        slateblue: { DEFAULT: '#7d95b5', bright: '#b3c6de' },
        town: { DEFAULT: '#22d3ee', dark: '#0e7490', glow: 'rgba(34,211,238,0.30)' },
        mafia: { DEFAULT: '#e11d48', dark: '#9f1239', glow: 'rgba(225,29,72,0.35)' }
      },
      fontFamily: {
        display: ['"Cinzel"', '"Cormorant Garamond"', 'Georgia', 'serif'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        body: ['"Jost"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        card: '0 10px 40px rgba(0,0,0,0.6)',
        glow: '0 0 40px rgba(214,161,75,0.18)',
        glowBlood: '0 0 44px rgba(193,58,46,0.28)'
      }
    }
  },
  plugins: []
};
