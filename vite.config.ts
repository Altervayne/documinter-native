import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Read the app version from package.json at config-load time and expose it to the client
// as the compile-time constant __APP_VERSION__ (see src/global.d.ts). This keeps the single
// source of truth in package.json without importing it into the bundle.
const { version: appVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
)

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  optimizeDeps: {
    // Vite's dependency pre-bundler mangles Temml's LaTeX tokenizer — it truncates
    // every control word to its first letter (\pi -> \p, \frac -> \f), so equations
    // fail to render. Excluding Temml serves its raw ESM build, which tokenizes
    // correctly. Keep this (and the `?url` load in src/lib/math.ts) until the upstream
    // Rolldown bug is fixed — docs/reference/rolldown-temml-bundler-bug.md (filable issue)
    // + docs/reports/2026-07-31-temml-optimizedeps-fix.md.
    exclude: ['temml'],
  },
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
        // `mjs` is required so Temml's raw ESM asset (temml-[hash].mjs, loaded at
        // runtime via `?url` — see src/lib/math.ts) is precached; without it the
        // dynamic import fails offline and math stops rendering.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2}'],
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
