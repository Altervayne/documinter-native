import { defineConfig } from 'vitest/config'

// Dedicated test config, separate from vite.config.ts on purpose: the src/lib/* units under test
// are plain TypeScript (no JSX/React), so the React-Compiler babel pass, Tailwind, and the PWA
// plugin from the app build are unwanted cost here. No plugins → Vitest's built-in esbuild handles
// the TS. `node` is the default environment (the high-value core is DOM-free); DOM suites opt into
// jsdom per-file via a `// @vitest-environment jsdom` docblock.
export default defineConfig({
   test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
   },
})
