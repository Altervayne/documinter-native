import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: 'prompt',

      manifest: {
        name:             'Documinter',
        short_name:       'Documinter',
        description:      'Personal documentation builder. Write, preview, and export structured HTML docs.',
        display:          'standalone',
        background_color: '#0a0f0d',
        theme_color:      '#0B5E4A',
        start_url:        '/',
        orientation:      'any',
        icons: [
          { src: 'pwa-64x64.png',             sizes: '64x64',   type: 'image/png' },
          { src: 'pwa-192x192.png',            sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',            sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png',  sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            // Google Fonts CSS manifest, can change between versions
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Google Fonts binary files, immutable, cache aggressively
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
})
