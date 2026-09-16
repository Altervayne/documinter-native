/*
 * The DOM-free plot-area layout engine for the cartesian core. An SVG string has no DOM, so text
 * cannot be measured: tick, caption, and legend widths are ESTIMATED from character count times an
 * average glyph advance, run deliberately wide so margins over-reserve rather than clip. The
 * renderer draws into a fixed CANVAS_WIDTH x CANVAS_HEIGHT space, made responsive by viewBox +
 * width:100% (see index.ts).
 */

// #############
// # CONSTANTS #
// #############

/** The fixed internal drawing size (the viewBox). */
export const CANVAS_WIDTH = 720
export const CANVAS_HEIGHT = 440

/** Font sizes for the chart's text roles (internal coordinate units). */
export const TITLE_FONT_SIZE = 16
export const AXIS_CAPTION_FONT_SIZE = 12
export const TICK_FONT_SIZE = 11
export const LEGEND_FONT_SIZE = 12

/** Average glyph advance as a fraction of the font-size, generous so estimated widths over-reserve. */
export const AVERAGE_CHAR_WIDTH_RATIO = 0.6

/** A uniform outer breathing margin around the whole canvas. */
const OUTER_PADDING = 14

const LEGEND_SWATCH_SIZE = 12
const LEGEND_SWATCH_TEXT_GAP = 6
const LEGEND_ITEM_GAP = 20
const LEGEND_ROW_HEIGHT = LEGEND_FONT_SIZE + 8

// ##########################
// # TEXT WIDTH ESTIMATION  #
// ##########################

/** Estimate the pixel width of `text` at `fontSize` with no DOM: characters x fontSize x
 *  AVERAGE_CHAR_WIDTH_RATIO, tuned to over-reserve. Empty text is zero width. */
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
   /** X offset of the swatch's left edge, relative to the row's left edge. */
   offsetX: number
   /** Total width this item occupies (swatch + gap + text). */
   width: number
}

/** A laid-out legend: rows of positioned items, plus the widest row's width (to center it). */
export interface LegendLayout {
   rows: LegendItem[][]
   rowCount: number
   widestRowWidth: number
}

/** Flow legend labels into rows fitting `availableWidth`. A single item wider than that still gets
 *  its own row rather than being dropped. */
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

/** Inputs the cartesian layout needs to size its margins. */
export interface CartesianLayoutInput {
   hasTitle: boolean
   xCaption: string | undefined
   yCaption: string | undefined
   /** Formatted y-axis tick labels, to size the left margin from their widest. */
   yTickLabels: string[]
   /** How many legend rows to reserve at the bottom (0 = no legend). */
   legendRowCount: number
}

/** Compute the margins + plot rect for a cartesian chart. The left margin grows with the widest
 *  y-tick label + optional y-caption; the bottom reserves x-ticks, x-caption, and legend; the top
 *  reserves the title. Plot width/height clamp non-negative. */
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
