/**
 * layout.ts, the DOM-free plot-area layout engine for the cartesian core.
 *
 * PURE FUNCTIONS. This is the trickiest pure piece: an SVG string has NO DOM, so text cannot
 * be measured. Axis-tick, axis-caption, and legend widths are ESTIMATED from character count
 * times an average glyph advance for the chart font-size. The estimate intentionally runs a
 * little wide (over-reserving margin) rather than risk clipping — the same limitation every
 * server-side SVG chart lives with.
 *
 * The renderer draws into a fixed internal coordinate space (CANVAS_WIDTH x CANVAS_HEIGHT);
 * the <svg> is then made responsive with a viewBox + width:100% (see index.ts), so no runtime
 * resize is needed.
 */

// #############
// # CONSTANTS #
// #############

/** The fixed internal drawing width (the viewBox width). */
export const CANVAS_WIDTH = 720

/** The fixed internal drawing height (the viewBox height). */
export const CANVAS_HEIGHT = 440

/** Font sizes for the chart's text roles (internal coordinate units). */
export const TITLE_FONT_SIZE = 16
export const AXIS_CAPTION_FONT_SIZE = 12
export const TICK_FONT_SIZE = 11
export const LEGEND_FONT_SIZE = 12

/**
 * Average glyph advance as a fraction of the font-size, for the system-ui sans the chart
 * inherits. Deliberately generous (~0.6em) so estimated widths over-reserve rather than clip.
 */
export const AVERAGE_CHAR_WIDTH_RATIO = 0.6

/** A uniform outer breathing margin around the whole canvas. */
const OUTER_PADDING = 14

/** The legend swatch size and the gaps around legend pieces. */
const LEGEND_SWATCH_SIZE = 12
const LEGEND_SWATCH_TEXT_GAP = 6
const LEGEND_ITEM_GAP = 20
const LEGEND_ROW_HEIGHT = LEGEND_FONT_SIZE + 8

// ##########################
// # TEXT WIDTH ESTIMATION  #
// ##########################

/**
 * Estimate the rendered pixel width of `text` at `fontSize`, with no DOM to measure against.
 * `characters x fontSize x AVERAGE_CHAR_WIDTH_RATIO`. This is the honest constraint of
 * string-generated SVG: it is an estimate, tuned to over-reserve. Empty text is zero width.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
   if (text.length === 0) return 0
   return text.length * fontSize * AVERAGE_CHAR_WIDTH_RATIO
}

/** The widest estimated width among several strings at one font-size (0 for an empty list). */
export function widestTextWidth(texts: string[], fontSize: number): number {
   let widest = 0
   for (const text of texts) {
      const width = estimateTextWidth(text, fontSize)
      if (width > widest) widest = width
   }
   return widest
}

// ################
// # LEGEND FLOW  #
// ################

/** One positioned legend item: its label plus the x offset of its swatch within its row. */
export interface LegendItem {
   label: string
   /** The x offset of the swatch's left edge, relative to the row's left edge. */
   offsetX: number
   /** The total width this item occupies (swatch + gap + text). */
   width: number
}

/** A laid-out legend: rows of positioned items, plus the width of the widest row (to center it). */
export interface LegendLayout {
   rows: LegendItem[][]
   rowCount: number
   widestRowWidth: number
}

/**
 * Flow legend labels into rows that fit within `availableWidth`. Each item is a swatch + gap +
 * estimated text width; items are separated by LEGEND_ITEM_GAP. A single item that is wider
 * than the available width still gets its own row (it is never dropped). Deterministic.
 */
export function layoutLegend(labels: string[], availableWidth: number): LegendLayout {
   const rows: LegendItem[][] = []
   let currentRow: LegendItem[] = []
   let currentRowWidth = 0
   let widestRowWidth = 0

   for (const label of labels) {
      const itemWidth =
         LEGEND_SWATCH_SIZE + LEGEND_SWATCH_TEXT_GAP + estimateTextWidth(label, LEGEND_FONT_SIZE)
      const gapBefore = currentRow.length === 0 ? 0 : LEGEND_ITEM_GAP
      const projectedWidth = currentRowWidth + gapBefore + itemWidth

      if (currentRow.length > 0 && projectedWidth > availableWidth) {
         rows.push(currentRow)
         widestRowWidth = Math.max(widestRowWidth, currentRowWidth)
         currentRow = []
         currentRowWidth = 0
      }

      const offsetX = currentRow.length === 0 ? 0 : currentRowWidth + LEGEND_ITEM_GAP
      currentRow.push({ label, offsetX, width: itemWidth })
      currentRowWidth = offsetX + itemWidth
   }

   if (currentRow.length > 0) {
      rows.push(currentRow)
      widestRowWidth = Math.max(widestRowWidth, currentRowWidth)
   }

   return { rows, rowCount: rows.length, widestRowWidth }
}

/** The vertical space a legend of `rowCount` rows consumes (0 rows -> 0). */
export function legendHeight(rowCount: number): number {
   return rowCount === 0 ? 0 : rowCount * LEGEND_ROW_HEIGHT + 8
}

// #####################
// # PLOT-AREA LAYOUT  #
// #####################

/** A rectangle in the internal coordinate space. */
export interface PlotRect {
   x: number
   y: number
   width: number
   height: number
}

/** Margins around the plot rect. */
export interface Margins {
   top: number
   right: number
   bottom: number
   left: number
}

/** The full cartesian layout: canvas size, margins, and the resulting plot rect. */
export interface CartesianLayout {
   canvasWidth: number
   canvasHeight: number
   margin: Margins
   plot: PlotRect
}

/** Inputs the cartesian layout needs to size its margins (all already stringified where text). */
export interface CartesianLayoutInput {
   hasTitle: boolean
   xCaption: string | undefined
   yCaption: string | undefined
   /** The formatted y-axis tick labels, to size the left margin from their widest. */
   yTickLabels: string[]
   /** How many legend rows to reserve at the bottom (0 = no legend). */
   legendRowCount: number
}

/**
 * Compute the margins + plot rect for a cartesian chart on the fixed canvas. The left margin
 * grows with the widest y-tick label and an optional rotated y-caption; the bottom margin
 * reserves the x-tick labels, an optional x-caption, and the legend rows; the top margin
 * reserves the title. Plot width/height are clamped non-negative so tiny canvases never
 * produce inverted rects.
 */
export function computeCartesianLayout(input: CartesianLayoutInput): CartesianLayout {
   const yTickWidth = widestTextWidth(input.yTickLabels, TICK_FONT_SIZE)

   const marginTop = OUTER_PADDING + (input.hasTitle ? TITLE_FONT_SIZE + 12 : 0)

   const yCaptionReserve = input.yCaption ? AXIS_CAPTION_FONT_SIZE + 6 : 0
   const marginLeft = OUTER_PADDING + yCaptionReserve + yTickWidth + 8

   const xTickReserve = TICK_FONT_SIZE + 8
   const xCaptionReserve = input.xCaption ? AXIS_CAPTION_FONT_SIZE + 6 : 0
   const marginBottom =
      OUTER_PADDING + xTickReserve + xCaptionReserve + legendHeight(input.legendRowCount)

   const marginRight = OUTER_PADDING + 8

   const plotWidth = Math.max(0, CANVAS_WIDTH - marginLeft - marginRight)
   const plotHeight = Math.max(0, CANVAS_HEIGHT - marginTop - marginBottom)

   return {
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      margin: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
      plot: { x: marginLeft, y: marginTop, width: plotWidth, height: plotHeight },
   }
}
