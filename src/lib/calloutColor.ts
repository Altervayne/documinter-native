/**
 * calloutColor.ts, Pure hex-validation helper for the callout block's custom-color override
 * (`Block.calloutColor`). Shared by the Markdown parser (parse-time sanitization)
 * and the editor's color popover.
 *
 * Exports: isValidCalloutHex, sanitizeCalloutHex
 */

// #############
// # CONSTANTS #
// #############

/** Matches `#rgb` or `#rrggbb`, case-insensitive. */
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// #############
// # FUNCTIONS #
// #############

/** True when `value` is a well-formed `#rgb` / `#rrggbb` hex color. */
export function isValidCalloutHex(value: string): boolean {
   return HEX_COLOR_PATTERN.test(value.trim())
}

/**
 * Validates and normalises a candidate hex string for storage as `Block.calloutColor`.
 * Returns the trimmed, lower-cased hex on success, or `undefined` when malformed, callers
 * treat `undefined` as "fall back to the style preset" rather than throwing.
 */
export function sanitizeCalloutHex(value: string): string | undefined {
   const trimmed = value.trim()
   return isValidCalloutHex(trimmed) ? trimmed.toLowerCase() : undefined
}
