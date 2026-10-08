/** @type {import('tailwindcss').Config} */
const brandSans = ['"Neue Montreal"', '"General Sans"', 'system-ui', 'sans-serif'];

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        soul: {
          blue: '#163d68',
          'blue-dark': '#0f2c4d',
          'blue-50': '#edf1f7',
          'blue-100': '#d6e0ee',
          muted: '#52677e',
          platinum: '#dfe1e2',
          vista: '#83a0e1',
          ivory: '#f3f3f1',
          paper: '#f8f8f7',
          sand: '#ecedee',
          teal: '#52677e',
          ink: '#0c2440',
          line: 'rgba(22, 61, 104, 0.12)',
          accent: '#83a0e1',
        },
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        display: brandSans,
        sans: brandSans,
        num: brandSans,
        tech: brandSans,
      },
      transitionTimingFunction: {
        soul: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      letterSpacing: {
        royal: '0.08em',
        'royal-wide': '0.22em',
      },
      lineHeight: {
        royal: '1.7',
      },
      maxWidth: {
        soul: '1280px',
        wide: '1360px',
      },
    },
  },
  plugins: [],
};
