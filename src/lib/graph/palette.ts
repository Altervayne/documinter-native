/*
 * The graph block's categorical series palette + color resolution. A validated 8-hue set (light +
 * dark columns), NOT the document accent. Hues are assigned in FIXED slot order (series index ->
 * slot index); that validated ordering IS the colorblind-safety mechanism, so the order is
 * load-bearing. The palette caps at 8; resolveSeriesColor wraps past the cap defensively.
 */

import type { GraphTheme } from './types'

// ###########
// # PALETTE #
// ###########

/** The 8-hue palette for the LIGHT chart surface (#fcfcfb), in fixed slot order. Worst adjacent
 *  colorblind dE 9.1, worst adjacent normal-vision dE 19.6. */
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

/** The same 8 hues re-stepped for the DARK chart surface (#1a1a19), a selected column, not an
 *  automatic lightening. Validated as its own set (worst adjacent colorblind dE 8.4, normal dE 19.3). */
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

/** The series cap: 8 distinct palette slots. The renderer draws at most this many series. */
export const MAX_SERIES = 8

// ##########
// # THEMES #
// ##########

/** The light target theme: ink/chrome tokens + the light palette column. */
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

/** The dark target theme: ink/chrome tokens + the dark palette column. */
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

/** Resolve the color a series is drawn in: a non-empty per-series `override` wins, otherwise the
 *  palette slot at `seriesIndex` (wrapped modulo the palette length so it never throws). */
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
   // Wrap into [0, paletteLength) even for a negative index.
   const slot = ((seriesIndex % paletteLength) + paletteLength) % paletteLength
   return theme.palette[slot]
}

// ##################
// # LUMINANCE UTIL #
// ##################

/** The sRGB relative luminance (0..1) of a hex color, for picking a readable label color on a
 *  colored fill (pie/donut slice labels). Returns 0 (treated as dark) for an unparseable input. */
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

/** Pick white or near-black for a label on a filled slice, whichever has the higher WCAG contrast.
 *  Contrast, not a raw luminance threshold, so mid-luminance hues like yellow take ink. */
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
