/*
 * Re-exports the shared SVG string-builder primitives from `lib/svg.ts` (the single source of
 * truth, shared with the image-markup block), so `lib/graph/*` imports stay inside the folder.
 */
export * from '../svg'
