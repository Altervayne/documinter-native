/**
 * palette.ts, the graph block's categorical series palette + color resolution.
 *
 * PURE DATA / PURE FUNCTIONS. The palette is the dataviz-skill-validated 8-hue categorical
 * set (its light + dark columns), NOT the document accent and NOT ACCENT_PRESETS. Hues are
 * assigned in FIXED slot order, never cycled for cosmetics: series index -> slot index. The
 * validated ordering is itself the colorblind-safety mechanism, so the order is load-bearing.
 *
 * v1 caps at 8 distinct series colors. resolveSeriesColor wraps (modulo) past the cap so it
 * can never fail, but the renderer separately caps the number of drawn series at MAX_SERIES.
 */

import type { GraphTheme } from './types'

// ###########
// # PALETTE #
// ###########

/**
 * The 8-hue categorical palette for the LIGHT chart surface (#fcfcfb), in fixed slot order.
 * Validated by the dataviz skill: worst adjacent colorblind separation OKLab dE 9.1 (>=8
 * target), worst adjacent normal-vision dE 19.6 (>=15 floor).
 */
export const GRAPH_SERIES_LIGHT = [
   '#2a78d6', // 1 blue
   '#eb6834', // 2 orange
   '#1baf7a', // 3 aqua
   '#eda100', // 4 yellow
   '#e87ba4', // 5 magenta
   '#008300', // 6 green
   '#4a3aa7', // 7 violet
   '#e34948', // 8 red
] as const

/**
 * The same 8 hues re-stepped for the DARK chart surface (#1a1a19), a selected dark column,
 * not an automatic lightening of the light set. Validated as its own set (worst adjacent
 * colorblind dE 8.4, worst adjacent normal-vision dE 19.3).
 */
export const GRAPH_SERIES_DARK = [
   '#3987e5', // 1 blue
   '#d95926', // 2 orange
   '#199e70', // 3 aqua
   '#c98500', // 4 yellow
   '#d55181', // 5 magenta
   '#008300', // 6 green
   '#9085e9', // 7 violet
   '#e66767', // 8 red
] as const

/**
 * The series cap. v1 assigns 8 distinct palette slots; a 9th+ series is NOT a generated hue.
 * The renderer draws at most this many series; resolveSeriesColor wraps past it defensively.
 */
export const MAX_SERIES = 8

// ##########
// # THEMES #
// ##########

/**
 * The light target theme: dataviz ink/chrome tokens + the light palette column. Pass this to
 * renderGraphToSvg for the in-app light preview and for a light-themed HTML export.
 */
export const LIGHT_GRAPH_THEME: GraphTheme = {
   ink: {
      text:          '#0b0b0b',
      textSecondary: '#52514e',
      textMuted:     '#898781',
      axis:          '#c3c2b7',
      grid:          '#e1e0d9',
      surface:       '#fcfcfb',
   },
   palette: [...GRAPH_SERIES_LIGHT],
}

/**
 * The dark target theme: dataviz dark ink/chrome tokens + the dark palette column. Pass this
 * for the in-app dark preview and for a dark-themed HTML export.
 */
export const DARK_GRAPH_THEME: GraphTheme = {
   ink: {
      text:          '#ffffff',
      textSecondary: '#c3c2b7',
      textMuted:     '#898781',
      axis:          '#383835',
      grid:          '#2c2c2a',
      surface:       '#1a1a19',
   },
   palette: [...GRAPH_SERIES_DARK],
}

// ####################
// # COLOR RESOLUTION #
// ####################

/**
 * Resolve the color a series is drawn in.
 *
 * Precedence: a non-empty per-series `override` wins (this is the author's "match my
 * document colors" hook); otherwise the palette slot at `seriesIndex`. The slot index wraps
 * modulo the palette length (the 8-color cap) so an out-of-range index never throws, but
 * note the renderer caps drawn series at {@link MAX_SERIES}, so wrapping is a defensive
 * fallback, not an expected code path.
 */
export function resolveSeriesColor(
   seriesIndex: number,
   override: string | undefined,
   theme: GraphTheme,
): string {
   if (override !== undefined && override.trim() !== '') {
      return override
   }
   const paletteLength = theme.palette.length
   if (paletteLength === 0) return theme.ink.text
   // Wrap into [0, paletteLength) even for a negative index (defensive; not expected).
   const slot = ((seriesIndex % paletteLength) + paletteLength) % paletteLength
   return theme.palette[slot]
}

// ##################
// # LUMINANCE UTIL #
// ##################

/**
 * The sRGB relative luminance (0..1) of a `#rrggbb` / `#rgb` hex color. Used to pick a
 * readable label color for text set INSIDE a colored fill (pie/donut slice labels, the one
 * place text sits on a series color). Returns 0 for an unparseable input (treated as dark).
 */
export function relativeLuminance(hexColor: string): number {
   const parsed = parseHex(hexColor)
   if (parsed === null) return 0
   const channel = (value: number): number => {
      const normalized = value / 255
      return normalized <= 0.03928
         ? normalized / 12.92
         : Math.pow((normalized + 0.055) / 1.055, 2.4)
   }
   return 0.2126 * channel(parsed.red) + 0.7152 * channel(parsed.green) + 0.0722 * channel(parsed.blue)
}

/**
 * Pick white or near-black for a label placed ON a filled slice, choosing whichever gives the
 * higher WCAG contrast against the fill (per the dataviz "in-slice text picks white-or-ink"
 * rule). Contrast, not a raw luminance threshold, so mid-luminance hues like yellow correctly
 * take ink rather than white.
 */
export function readableTextOn(fillColor: string): string {
   const fillLuminance = relativeLuminance(fillColor)
   const contrastWithInk = (fillLuminance + 0.05) / (relativeLuminance('#0b0b0b') + 0.05)
   const contrastWithWhite = (1 + 0.05) / (fillLuminance + 0.05)
   return contrastWithInk >= contrastWithWhite ? '#0b0b0b' : '#ffffff'
}

/** Parse `#rgb` or `#rrggbb` into 0..255 channels, or null when it is not a hex color. */
function parseHex(hexColor: string): { red: number; green: number; blue: number } | null {
   const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hexColor.trim())
   if (match === null) return null
   let digits = match[1]
   if (digits.length === 3) {
      digits = digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
   }
   return {
      red:   parseInt(digits.slice(0, 2), 16),
      green: parseInt(digits.slice(2, 4), 16),
      blue:  parseInt(digits.slice(4, 6), 16),
   }
}
