/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        soul: {
          blue: '#283f5e',
          'blue-dark': '#16233a',
          'blue-50': '#eef2f7',
          'blue-100': '#dbe3ef',
          muted: '#5c6b83',
          ivory: '#f5f1e9',
          sand: '#efe9dc',
          teal: '#134e5e',
          ink: '#020617',
          line: 'rgba(40, 63, 94, 0.12)',
          accent: '#F28C28',
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
        display: ['"Cormorant Garamond"', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['"Outfit"', 'system-ui', 'sans-serif'],
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
      },
    },
  },
  plugins: [],
};
