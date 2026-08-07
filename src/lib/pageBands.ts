/**
 * Shared rendering for the running header / footer bands of a paged document. Produces an HTML STRING
 * so the exact same output feeds the React editor (via dangerouslySetInnerHTML) and the HTML / PDF
 * export (string concatenation), which keeps the two from ever drifting. Pure: no React, no DOM.
 */

import { esc } from './text'
import { formatPageNumber } from './pageNumbering'
import type { PageBand, BandItem } from './format'

// The Documinter logo, inline SVG (currentColor), shared by the credit item across editor + export.
const DOCUMINTER_LOGO_SVG = '<svg class="doc-band-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 253.01 273.36"><path fill="currentColor" d="M194.49,186.08l35.56-24.07s-29.29,40.79-50.76,41.06c0,0-14.06.1-14.46-13.15v-81.98s.71-16.01-15.98-16.01c0,0-7.08-1.01-11.63,5.97l-32.16,60.12-33.07-60.02s-3.03-6.07-11.93-6.07c0,0-14.97-1.11-14.97,14.06v82.04s.07,13.96-14.7,13.96c0,0-14.38.07-14.38-13.03V14.97h122.06v55.05h55.01v81s4.87-10.62,17.01-13.48V59.01L151.09,0H.07s-.07,190.02-.07,190.02c0,0,1.31,28.01,30.34,28.01s29.83-28.31,29.83-28.31v-81.71l38.02,70.08,12.74-.1,37.99-69.98v82.11s-.81,27.91,30.07,27.91c0,0,19.82,1.82,34.18-18.1,0,0,37.01,8.39,39.84-58.75,0,0-63.1-5.26-58.52,44.9Z"/><polygon fill="currentColor" points="193.73 259.32 14 259.32 14 227.97 0 220.24 0 273.36 208.8 273.36 208.8 221.08 193.73 228.21 193.73 259.32"/></svg>'

export interface BandRenderContext {
   pageIndex: number
   pageCount: number
   /** Localized strings: the credit text and the page-number words. */
   madeWith:  string
   pageWord:  string
   ofWord:    string
}

function renderBandItemHtml(item: BandItem, ctx: BandRenderContext): string {
   if (item.kind === 'pageNumber') {
      return esc(formatPageNumber(item.style, ctx.pageIndex + 1, ctx.pageCount, { page: ctx.pageWord, of: ctx.ofWord }))
   }
   if (item.kind === 'credit') {
      return `<span class="doc-band-credit">${DOCUMINTER_LOGO_SVG}${esc(ctx.madeWith)}</span>`
   }
   // Custom content: a logo image and / or text, inline (image before text). Empty items were dropped
   // at normalize, so at least one side is present. The src is a base64 data URI (no quote to escape).
   const imageHtml = item.image ? `<img class="doc-band-img" src="${item.image.src}" alt="" />` : ''
   const textHtml  = item.text  ? `<span class="doc-band-text">${esc(item.text)}</span>` : ''
   return imageHtml + textHtml
}

/** Whether a band holds any item (an empty band renders nothing, not even the row). */
export function bandHasContent(band: PageBand): boolean {
   return !!(band.left || band.center || band.right)
}

/** One band as a three-cell (left / center / right) flex row. Empty cells still render so the present
 *  cells keep their alignment. Returns '' for an empty band so the caller can skip the wrapper. */
export function renderPageBandHtml(band: PageBand, ctx: BandRenderContext): string {
   if (!bandHasContent(band)) return ''
   const cell = (position: 'left' | 'center' | 'right', item: BandItem | undefined): string =>
      `<div class="doc-band-cell doc-band-${position}">${item ? renderBandItemHtml(item, ctx) : ''}</div>`
   return cell('left', band.left) + cell('center', band.center) + cell('right', band.right)
}
