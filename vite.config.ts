import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// Read the app version from package.json at config-load time and expose it to the client
// as the compile-time constant __APP_VERSION__ (see src/global.d.ts). This keeps the single
// source of truth in package.json without importing it into the bundle.
const { version: appVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
)

export default defineConfig({
  // Relative asset URLs so the bundle resolves under the Tauri asset protocol, not just a web root.
  base: './',
  // Tauri watches the config output, so a cleared screen swallows its errors.
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  optimizeDeps: {
    // Vite's dependency pre-bundler mangles Temml's LaTeX tokenizer, it truncates
    // every control word to its first letter (\pi -> \p, \frac -> \f), so equations
    // fail to render. Excluding Temml serves its raw ESM build, which tokenizes
    // correctly. Keep this (and the `?url` load in src/lib/math.ts) until the upstream
    // Rolldown bug is fixed.
    exclude: ['temml'],
  },
  server: {
    // Tauri's devUrl is pinned to this port, so a silent fallback would leave the window blank.
    port: 5173,
    strictPort: true,
    watch: {
      // The Rust side owns src-tauri, watching it would loop rebuilds.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // WebView2 on Windows tracks Chromium, the other platforms ship a Safari-era WebKit.
    // No TAURI env (a plain web build) falls to the safari13 branch, which is the safe floor.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Rolldown-Vite drops the bundled esbuild, its minifier is Oxc. A plain 'esbuild'
    // here fails to load (esbuild is no longer a dependency).
    minify: process.env.TAURI_ENV_DEBUG ? false : 'oxc',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  // TAURI_ENV_* vars must reach the client so the frontend can branch on platform/debug.
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})
