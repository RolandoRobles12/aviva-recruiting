/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta Aviva — escala completa basada en colores de marca
        primary: {
          50:  '#f0fdf6',
          100: '#b0f5cd', // Verde Esmeralda
          200: '#7dedb3',
          300: '#4cdf98',
          400: '#27cc80',
          500: '#16b877', // Verde Aviva (principal)
          600: '#0f9461',
          700: '#026149', // Verde Musgo
          800: '#074739', // Verde Pino
          900: '#053d32',
          950: '#022b23',
        },
        // Alias semánticos de la marca
        aviva: {
          esmeralda: '#b0f5cd',
          verde:     '#16b877',
          musgo:     '#026149',
          pino:      '#074739',
          fondo:     '#F0F5FA', // Gris frío (fondo general)
        },
      },
      backgroundColor: {
        app: '#F0F5FA', // Gris frío para el fondo de la app
      },
    },
  },
  plugins: [],
}


