/*
 * The export's own deterministic pagination pass. The paged export must lay out from the document
 * itself, not from whatever the live editor happened to have measured, so pagination becomes a pure
 * function of (model, format, theme) independent of Preview vs Edit, interaction order, and debounce
 * timing.
 *
 * The pass renders the document UNPAGINATED into an offscreen iframe, at the true A4 content-box width,
 * with the same export CSS and markup the real export emits, then measures every height with the same
 * primitive the editor uses (measureHeightsFromContainer) and feeds the pure paginator. The export HTML
 * carries no measurement anchors, so the rendered DOM is decorated in place (data-block-id / data-rich /
 * data-list-item-id / data-section-id) before measuring; the export string builders stay untouched.
 *
 * This is the only export-side code that touches the DOM. downloadHTML and printDocument live here (both
 * self-measure); generateExportHTML stays a pure synchronous string builder in export.ts, with its
 * partitionIntoPages fallback intact for DOM-less callers (binder mini-preview, tests).
 */

// -- Lib Imports --
import { generateExportHTML, renderBlocksToDocHtml, type ExportOptions } from './export'
import { measureHeightsFromContainer } from './domMeasure'
import { buildMetrics, paginate, paginationBudgetPx, contentBoxWidthPx } from './pageLayout'
import { slugify } from './text'
import {
   A4_PORTRAIT_WIDTH_PX, A4_LANDSCAPE_WIDTH_PX, millimetresToPx, type Page,
} from './pageModel'
import { DEFAULT_A4_MARGINS, type DocFormat } from './format'

// -- Type Imports --
import type { DocMeta, Section, Block } from '../types'

const DEFAULTS: ExportOptions = { theme: 'light', accent: '#f97316' }

// #############
// # GEOMETRY  #
// #############

/** The paged A4 sheet width in px for a format's orientation (the same source the export's own
 *  buildPagedStyles reads). Landscape swaps to the wide edge. */
function pagedSheetWidthPx(format: DocFormat | undefined): number {
   return format?.kind === 'a4-landscape' ? A4_LANDSCAPE_WIDTH_PX : A4_PORTRAIT_WIDTH_PX
}

// ###############
// # MEASUREMENT #
// ###############

/**
 * The offscreen measurement document: the plain (infinite) export of the model, so all blocks render
 * once in flat order inside a single continuous `.doc-render`, with an appended style override that
 * pins the render to the paged sheet's real content-box width (contentBoxWidthPx), with the top / bottom
 * margins as padding for matching vertical margin collapse. Measuring this yields the same heights the
 * paged export's own sheets would produce, because heights are width-stable and the width here is the
 * paged content-box width.
 */
function buildMeasurementHtml(meta: DocMeta, sections: Section[], opts: ExportOptions): string {
   // Render the flat, unpaginated body: the infinite branch emits one `.doc-render` with every section
   // and block in model order. The document's real page breaks are irrelevant here (this pass paginates
   // from scratch), so an infinite format is passed and pagedLayout is dropped.
   const flatOpts: ExportOptions = { ...opts, format: { kind: 'infinite' }, pagedLayout: undefined }
   const baseHtml = generateExportHTML(meta, sections, flatOpts)

   // The render width comes from the ONE shared helper contentBoxWidthPx, the same paged content box the
   // real export renders its sheets at (see pageLayout.ts). Text wraps here at exactly that width, so the
   // measured heights match the paged sheet's, since heights are width-stable. Only the top / bottom
   // margins are applied (as padding) to reproduce the real `.doc-render`'s vertical margin collapsing;
   // horizontal margins do not affect wrapping once the content box is pinned, so they are left off.
   const contentWidth = contentBoxWidthPx(opts.format)
   const margins      = opts.format?.margins ?? DEFAULT_A4_MARGINS
   const top          = millimetresToPx(margins.top)
   const bottom       = millimetresToPx(margins.bottom)

   // Force the sheet's exact content box so text wraps at the paged width. The sidebar / footer / card
   // chrome is neutralised so only the measured content occupies the flow.
   const override = `
            .sidebar { display: none !important; }
            .main { display: block !important; margin: 0 !important; padding: 0 !important; }
            .doc-card { max-width: none !important; width: ${contentWidth}px !important; border: 0 !important; box-shadow: none !important; }
            .doc-card > .doc-render { width: ${contentWidth}px !important; padding: ${top}px 0 ${bottom}px 0 !important; }
            .doc-footer { display: none !important; }
   `
   return baseHtml.replace('</head>', `<style>${override}</style></head>`)
}

/** Resolve the frame's own animation-frame scheduler, falling back to the global one. */
function nextFrame(frameWindow: Window | null): Promise<void> {
   const raf = frameWindow?.requestAnimationFrame ?? window.requestAnimationFrame
   return new Promise(resolve => raf.call(frameWindow ?? window, () => resolve()))
}

/** Wait until the frame's geometry is final to measure: fonts loaded, first layout settled over two
 *  frames, then every image decoded. MathML and inline SVG render synchronously, so they need no wait. */
async function whenFrameReadyToMeasure(frameDocument: Document): Promise<void> {
   const frameWindow = frameDocument.defaultView
   const fonts = frameDocument.fonts
   if (fonts && fonts.ready) { try { await fonts.ready } catch { /* measure with fallback metrics */ } }
   await nextFrame(frameWindow)
   await nextFrame(frameWindow)
   const images = Array.from(frameDocument.querySelectorAll('img'))
   await Promise.all(images.map(image => (image.decode ? image.decode().catch(() => {}) : Promise.resolve())))
}

// ############
// # DECORATE #
// ############

/** Tag the paragraph's rich-text element so its rendered lines can be measured. The block element may
 *  BE the `<p>` (no handle) or wrap it (a handled block), and the measurement primitive looks up the
 *  rich element as a DESCENDANT of the block element, so the `<p>`'s inline content is moved into a
 *  transparent `data-rich` span. An inline span does not change line boxes, so the measured lines match
 *  the export's own rendering. */
function decorateParagraph(blockElement: Element): void {
   const paragraph = blockElement.tagName === 'P' ? blockElement : blockElement.querySelector('p')
   if (!paragraph || paragraph.querySelector('[data-rich]')) return
   const richSpan = paragraph.ownerDocument.createElement('span')
   richSpan.setAttribute('data-rich', 'true')
   while (paragraph.firstChild) richSpan.appendChild(paragraph.firstChild)
   paragraph.appendChild(richSpan)
}

/** Tag each ROOT list item of a `list`/`checklist` block so the paginator can split the list at an item
 *  boundary. Only the top-level `<li>` (the root ul's direct children) are tagged; nested items ride
 *  inside their root item's measured height. */
function decorateList(blockElement: Element, block: Block): void {
   const list = blockElement.tagName === 'UL' ? blockElement : blockElement.querySelector('ul')
   if (!list) return
   const rootItems  = Array.from(list.children).filter(child => child.tagName === 'LI')
   const modelItems = block.items ?? []
   for (let index = 0; index < rootItems.length && index < modelItems.length; index += 1)
      rootItems[index].setAttribute('data-list-item-id', modelItems[index].id)
}

/**
 * Add the measurement anchors the paginator's height oracle reads onto the rendered export DOM. Sections
 * get `data-section-id`; each top-level block that produced an element gets `data-block-id` (paragraphs
 * also get a `data-rich` span, lists a `data-list-item-id` per root item). A block whose export renders
 * to nothing (an empty math / graph / diagram / src-less image) produces no element and is skipped, so
 * the DOM elements are paired to model blocks by walking both in order and consulting the same per-block
 * renderer the export uses to know which blocks emitted markup.
 */
function decorateForMeasurement(docRender: Element, sections: Section[], theme: 'light' | 'dark'): void {
   const sectionElements = Array.from(docRender.querySelectorAll(':scope > .doc-section'))
   const count = Math.min(sectionElements.length, sections.length)
   for (let sectionIndex = 0; sectionIndex < count; sectionIndex += 1) {
      const sectionElement = sectionElements[sectionIndex]
      const section        = sections[sectionIndex]
      sectionElement.setAttribute('data-section-id', section.id)

      // The section's block elements are its children minus the title `<h2>` (no block renders an h2).
      const blockElements = Array.from(sectionElement.children).filter(child => child.tagName !== 'H2')
      let elementIndex = 0
      for (const block of section.blocks) {
         // A block that renders to empty markup contributes no element (and zero height); skip it so the
         // remaining blocks still line up with their elements.
         if (renderBlocksToDocHtml([block], { theme }).trim() === '') continue
         const blockElement = blockElements[elementIndex]
         elementIndex += 1
         if (!blockElement) break
         blockElement.setAttribute('data-block-id', block.id)
         if (block.type === 'p') decorateParagraph(blockElement)
         else if (block.type === 'list' || block.type === 'checklist') decorateList(blockElement, block)
      }
   }
}

// ########
// # MEMO #
// ########

/*
 * A single-entry (last write wins) memo so a repeat export of an UNCHANGED document skips the offscreen
 * layout entirely: a Save-as-PDF right after an HTML export of the same document is instant. The key is a
 * deterministic signature of every input that can change a measured height (the model, the format, and the
 * theme / accent / language / presentation that shift line boxes or the page-1 header). Any model, format,
 * or theme edit changes the signature, so a hit can only ever be a genuinely identical document; the memo
 * can never serve a layout that predates an edit the way a model-stored cache would. Held at module scope
 * and never on the model, so it needs no invalidation, only overwriting.
 */

interface PagesMemoEntry { signature: string; pages: Page[] }

let lastPagesMemo: PagesMemoEntry | null = null

/** A deterministic signature of the measurement inputs. pagedLayout is excluded on purpose: it is a
 *  caller-supplied override, not a measurement input (the measurement always re-paginates from scratch). */
function exportPagesSignature(meta: DocMeta, sections: Section[], opts: ExportOptions): string {
   return JSON.stringify([
      meta, sections, opts.format ?? null, opts.theme, opts.accent, opts.lang ?? 'en', opts.presentation ?? null,
   ])
}

/** The memoized pages for this signature, or null on a miss. */
function memoizedPages(signature: string): Page[] | null {
   return lastPagesMemo && lastPagesMemo.signature === signature ? lastPagesMemo.pages : null
}

/** Replace the single memo entry with this signature's pages. */
function storePages(signature: string, pages: Page[]): void {
   lastPagesMemo = { signature, pages }
}

// ########
// # CORE #
// ########

/** The offscreen frame's hidden style: kept in the layout (never display:none, which would suppress
 *  both measurement and printing) but off-screen, sized wide enough that the fixed-width sheet lays out
 *  without shrinking. */
function measurementFrameStyle(format: DocFormat | undefined): string {
   const width = pagedSheetWidthPx(format) + 80
   return `position:fixed;left:-10000px;top:0;width:${width}px;height:1200px;border:0;visibility:hidden;`
}

/**
 * Write the measurement document into `frameDocument`, wait for it to settle, decorate it, and return
 * the paginated pages for the paged export. Drives measurement on the passed frame so a caller holding
 * an iframe (the print path) can reuse it for the final render.
 */
async function measurePagesInFrame(
   frameDocument: Document, meta: DocMeta, sections: Section[], opts: ExportOptions,
): Promise<Page[]> {
   const html = buildMeasurementHtml(meta, sections, opts)
   frameDocument.open()
   frameDocument.write(html)
   frameDocument.close()

   await whenFrameReadyToMeasure(frameDocument)

   const docRender = frameDocument.querySelector<HTMLElement>('.doc-render')
   if (!docRender) return []
   decorateForMeasurement(docRender, sections, opts.theme)

   const heights = measureHeightsFromContainer(docRender, sections)
   const metrics = buildMetrics(heights, sections)
   return paginate(sections, opts.format?.pages ?? [], paginationBudgetPx(opts.format), metrics, new Set())
}

/**
 * The export's deterministic page layout for `(meta, sections, opts)`. Renders the document into a
 * throwaway offscreen iframe, measures it, and paginates. Returns `[]` for a non-paged (infinite)
 * document, so callers keep their own `partitionIntoPages` fallback. Never reads live editor state.
 */
export async function computeExportPages(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): Promise<Page[]> {
   const paged = !!opts.format && opts.format.kind !== 'infinite'
   if (!paged) return []
   if (typeof document === 'undefined') return []

   // An unchanged document skips the offscreen layout entirely (no iframe built). Infinite documents
   // returned above without a signature, so the memo only ever holds a paged layout.
   const signature = exportPagesSignature(meta, sections, opts)
   const cached = memoizedPages(signature)
   if (cached) return cached

   const iframe = document.createElement('iframe')
   iframe.setAttribute('aria-hidden', 'true')
   iframe.style.cssText = measurementFrameStyle(opts.format)
   document.body.appendChild(iframe)

   const frameDocument = iframe.contentWindow?.document
   if (!frameDocument) { iframe.remove(); return [] }
   try {
      const pages = await measurePagesInFrame(frameDocument, meta, sections, opts)
      storePages(signature, pages)
      return pages
   } finally {
      iframe.remove()
   }
}

// #############
// # DOWNLOAD  #
// #############

/**
 * Download the document as a self-contained HTML file. Self-measures the paged layout first (a paged
 * document only; infinite skips straight to generation), so the exported pagination is independent of
 * any editor state.
 */
export async function downloadHTML(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): Promise<void> {
   const pages = await computeExportPages(meta, sections, opts)
   const finalOpts = pages.length > 0 ? { ...opts, pagedLayout: pages } : opts
   const html = generateExportHTML(meta, sections, finalOpts)

   const slug = slugify(meta.title)
   const anchor = document.createElement('a')
   anchor.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
   anchor.download = slug + '.html'
   anchor.click()
   URL.revokeObjectURL(anchor.href)
}

// ##########
// # PRINT  #
// ##########

/** Resolve `frameDocument.fonts.ready` (best effort), so the print engine lays out the final page with
 *  the real fonts rather than a fallback-font first pass. */
async function whenFontsReady(frameDocument: Document): Promise<void> {
   const fonts = frameDocument.fonts
   if (fonts && fonts.ready) { try { await fonts.ready } catch { /* print with fallback fonts */ } }
}

/**
 * Open the browser print dialog ("Save as PDF") over the paged export HTML. Uses ONE hidden iframe in
 * two passes: pass 1 writes the unpaginated measurement document and measures it; pass 2 rewrites the
 * same frame with the final paginated export and prints it. One font load (cached after the first pass),
 * one iframe. Intended for paged documents (the caller gates on paged mode); an infinite document falls
 * through to the plain forced-break partition inside generateExportHTML.
 */
export async function printDocument(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): Promise<void> {
   const iframe = document.createElement('iframe')
   iframe.setAttribute('aria-hidden', 'true')
   iframe.style.cssText = measurementFrameStyle(opts.format)
   document.body.appendChild(iframe)

   const frameWindow   = iframe.contentWindow
   const frameDocument = frameWindow?.document
   if (!frameWindow || !frameDocument) { iframe.remove(); return }

   const paged = !!opts.format && opts.format.kind !== 'infinite'
   let pages: Page[] | undefined
   if (paged) {
      // Reuse the memo so a Save-as-PDF right after an HTML export of the same document skips pass 1 and
      // goes straight to writing the final print HTML. A measurement failure falls back to the forced-break
      // partition rather than aborting the print.
      const signature = exportPagesSignature(meta, sections, opts)
      const cached = memoizedPages(signature)
      if (cached) {
         pages = cached
      } else {
         try {
            pages = await measurePagesInFrame(frameDocument, meta, sections, opts)
            storePages(signature, pages)
         } catch { pages = undefined }
      }
   }

   const finalOpts = pages && pages.length > 0 ? { ...opts, pagedLayout: pages } : opts
   const html = generateExportHTML(meta, sections, finalOpts)
   frameDocument.open()
   frameDocument.write(html)
   frameDocument.close()

   await whenFontsReady(frameDocument)
   frameWindow.focus()
   frameWindow.print()
   // Leave the frame up briefly so the dialog can hold the document, then drop it.
   window.setTimeout(() => iframe.remove(), 1000)
}
