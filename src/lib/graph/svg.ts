/**
 * svg.ts, re-exports the shared SVG string-builder primitives from `lib/svg.ts`.
 *
 * The graph renderer's escaping/formatting/element helpers were promoted to `lib/svg.ts` so the
 * image-markup block (`lib/imageMarkup/`) could reuse the exact same source of truth rather than
 * reaching into this folder. This shim keeps every existing `from './svg'` import inside
 * `lib/graph/*` working unchanged.
 */
export * from '../svg'
