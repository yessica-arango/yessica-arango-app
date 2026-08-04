import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'logo.png'],
      workbox: {
        // El manual de uso es un archivo estático aparte de la SPA: sin esto,
        // el service worker lo intercepta y sirve el shell de React en su
        // lugar (página en blanco), porque por defecto manda TODA navegación
        // al index.html de la app.
        navigateFallbackDenylist: [/^\/manual\.html/]
      },
      manifest: {
        name: 'Yessica Arango - Nail & Beauty Experts',
        short_name: 'Yessica Arango',
        description: 'Registro de trabajos realizados por empleada, para control de caja y auditoría',
        theme_color: '#ec4899',
        background_color: '#fdf2f8',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
