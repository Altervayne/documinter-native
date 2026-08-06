/**
 * svg.ts, re-exports the shared SVG string-builder primitives from `lib/svg.ts`.
 *
 * The escaping/formatting/element helpers live in `lib/svg.ts` as the single source of truth,
 * shared with the image-markup block (`lib/imageMarkup/`). This shim keeps every `from './svg'`
 * import inside `lib/graph/*` working without reaching outside the folder.
 */
export * from '../svg'
