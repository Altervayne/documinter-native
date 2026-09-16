/*
 * Pure hex-validation for the callout block's custom-color override (`Block.calloutColor`). Shared
 * by the Markdown parser (parse-time sanitization) and the editor's color popover.
 */

// #############
// # CONSTANTS #
// #############

/** Matches `#rgb` or `#rrggbb`, case-insensitive. */
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// #############
// # FUNCTIONS #
// #############

export function isValidCalloutHex(value: string): boolean {
   return HEX_COLOR_PATTERN.test(value.trim())
}

/** Trimmed, lower-cased hex on success; `undefined` when malformed, which callers read as "fall
 *  back to the style preset". */
export function sanitizeCalloutHex(value: string): string | undefined {
   const trimmed = value.trim()
   return isValidCalloutHex(trimmed) ? trimmed.toLowerCase() : undefined
}
