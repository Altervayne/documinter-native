import type { ListMarker } from '../types'

// ###############################################################################################
// # LIST MARKERS                                                                                #
// #                                                                                             #
// # Pure helpers for the per-sub-list marker of a `list` block (see Block.listMarker for the    #
// # root sub-list and ListItem.childMarker for each item's child sub-list). No React, no DOM:   #
// # every function here is a plain data transform, unit-tested in isolation.                    #
// ###############################################################################################

/** The markers that render an ordered list (`<ol>`), in the same order they appear in the picker. */
const ORDERED_MARKERS: ReadonlySet<ListMarker> = new Set([
   'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman',
])

/** Native CSS `list-style-type` value per marker. `dash` and `arrow` return null: they carry no
 *  native type and are drawn through a `::marker` content override instead (see markerMarkerClass). */
const MARKER_TO_LIST_STYLE_TYPE: Record<ListMarker, string | null> = {
   dot:         'disc',
   circle:      'circle',
   square:      'square',
   dash:        null,
   arrow:       null,
   decimal:     'decimal',
   'lower-alpha': 'lower-alpha',
   'upper-alpha': 'upper-alpha',
   'lower-roman': 'lower-roman',
   'upper-roman': 'upper-roman',
}

/** The CSS class that supplies the `::marker` content for the two non-native markers. */
const MARKER_TO_MARKER_CLASS: Record<ListMarker, string | null> = {
   dot:         null,
   circle:      null,
   square:      null,
   dash:        'doc-list-marker-dash',
   arrow:       'doc-list-marker-arrow',
   decimal:     null,
   'lower-alpha': null,
   'upper-alpha': null,
   'lower-roman': null,
   'upper-roman': null,
}

/** Every marker in display order (the five unordered bullets first, then the five ordered numbers),
 *  ready for the future picker to iterate over. */
export const ALL_LIST_MARKERS: ListMarker[] = [
   'dot', 'circle', 'square', 'dash', 'arrow',
   'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman',
]

/** A sub-list's marker, defaulting an absent one to `'dot'` (the historical bullet). Used everywhere
 *  a `Block.listMarker` or `ListItem.childMarker` is read for rendering or serialization. */
export function markerOrDefault(marker: ListMarker | undefined): ListMarker {
   return marker ?? 'dot'
}

/** True for the five ordered markers (decimal / lower-alpha / upper-alpha / lower-roman / upper-roman). */
export function isOrderedMarker(marker: ListMarker): boolean {
   return ORDERED_MARKERS.has(marker)
}

/** The native CSS `list-style-type` for a marker, or null for `dash` / `arrow` (they use a
 *  `::marker` content override, not a native type; see markerMarkerClass). */
export function markerListStyleType(marker: ListMarker): string | null {
   return MARKER_TO_LIST_STYLE_TYPE[marker]
}

/** The CSS class carrying the `::marker` content for `dash` / `arrow`, or null for every marker that
 *  uses a native `list-style-type` instead. */
export function markerMarkerClass(marker: ListMarker): string | null {
   return MARKER_TO_MARKER_CLASS[marker]
}

// ====================================================================
//  Ordered-marker text, used by the editor's custom list-row rendering
// ====================================================================
// The WYSIWYG list rows draw their own marker glyph rather than leaning on a native <ol>, so an
// ordered level needs the item's ordinal formatted in its own numbering. The HTML export never
// calls this: it emits a real <ol> and lets the browser number it.

/** Lower-case bijective base-26 (a, b, ..., z, aa, ab, ...), the spreadsheet-column scheme. */
function toAlpha(oneBasedIndex: number): string {
   let value  = Math.max(1, Math.floor(oneBasedIndex))
   let result = ''
   while (value > 0) {
      const remainder = (value - 1) % 26
      result = String.fromCharCode(97 + remainder) + result
      value  = Math.floor((value - 1) / 26)
   }
   return result
}

/** Lower-case Roman numerals, clamped to a sane upper bound so a runaway index can never loop. */
function toRoman(oneBasedIndex: number): string {
   const clamped = Math.min(Math.max(1, Math.floor(oneBasedIndex)), 3999)
   const table: [number, string][] = [
      [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
      [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
      [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
   ]
   let remaining = clamped
   let result    = ''
   for (const [amount, numeral] of table) {
      while (remaining >= amount) {
         result    += numeral
         remaining -= amount
      }
   }
   return result
}

/**
 * The ordinal text for an item at `oneBasedIndex` under an ordered marker (no trailing separator).
 * decimal -> "1", lower-alpha -> "a", upper-alpha -> "A", lower-roman -> "i", upper-roman -> "I".
 * An unordered marker returns an empty string (it has no ordinal). Used only by the editor.
 */
export function formatOrderedMarker(marker: ListMarker, oneBasedIndex: number): string {
   switch (marker) {
      case 'decimal':     return String(Math.max(1, Math.floor(oneBasedIndex)))
      case 'lower-alpha': return toAlpha(oneBasedIndex)
      case 'upper-alpha': return toAlpha(oneBasedIndex).toUpperCase()
      case 'lower-roman': return toRoman(oneBasedIndex)
      case 'upper-roman': return toRoman(oneBasedIndex).toUpperCase()
      default:            return ''
   }
}
