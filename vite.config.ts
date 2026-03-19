import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    proxy: {
      '/api/getOffer': {
        target: 'https://getoffer-wp5lebnvja-uc.a.run.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/getOffer/, '/'),
      },
      '/api/signOffer': {
        target: 'https://signoffer-wp5lebnvja-uc.a.run.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/signOffer/, '/'),
      },
      '/api/getContract': {
        target: 'https://getcontract-wp5lebnvja-uc.a.run.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/getContract/, '/'),
      },
      '/api/signContract': {
        target: 'https://signcontract-wp5lebnvja-uc.a.run.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/signContract/, '/'),
      },
      '/api/analyzePdfTemplate': {
        target: 'https://analyzepdftemplate-wp5lebnvja-uc.a.run.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/analyzePdfTemplate/, '/'),
      },
    },
  },
})
