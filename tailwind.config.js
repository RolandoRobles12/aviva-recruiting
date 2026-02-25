/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f0f4ff',
          100: '#dde8ff',
          200: '#c3d4fe',
          300: '#9ab8fd',
          400: '#6b91fa',
          500: '#4567f6',
          600: '#2d46eb',
          700: '#2434d8',
          800: '#232caf',
          900: '#222b8a',
          950: '#161a55',
        },
      },
    },
  },
  plugins: [],
}

