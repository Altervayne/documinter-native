/*
 * The document's single deterministic pagination pass, shared by every surface. Pagination lays out
 * from the document itself, not from whatever the live editor measured, so it is a pure function of
 * (model, format, theme), the same for Preview and Edit. It is the ONE paginator the editor canvas,
 * the Pages panel, Preview, and the PDF/HTML export all draw from, so they agree by construction.
 *
 * It renders the document UNPAGINATED into an offscreen iframe at the true A4 content-box width with
 * the export's own CSS, decorates the DOM in place with measurement anchors (data-block-id / data-rich
 * / data-list-item-id / data-section-id; the export string builders stay untouched), then measures and
 * feeds the pure paginator. One WARM hidden frame is reused across calls so fonts load once, and a
 * single measurement yields BOTH the pages and the too-tall page ids.
 *
 * This is the only pagination code that touches the DOM. downloadHTML and printDocument live here;
 * generateExportHTML stays a pure synchronous string builder in export.ts, with its partitionIntoPages
 * fallback intact for DOM-less callers.
 */

// -- Lib Imports --
import { generateExportHTML, renderBlocksToDocHtml, type ExportOptions } from './export'
import { measureHeightsFromContainer } from './domMeasure'
import { paginateDocument, contentBoxWidthPx, EMPTY_HEIGHTS } from './pageLayout'
import { slugify } from './text'
import { saveTextFile } from './platform/fileTransfer'
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

/** The offscreen measurement document: the plain (infinite) export of the model, all blocks rendered
 *  once in flat order inside one `.doc-render`, with a style override pinning the render to the paged
 *  sheet's real content-box width (contentBoxWidthPx) and the top / bottom margins as padding. Heights
 *  are width-stable, so measuring this yields the same heights the paged sheets would. */
function buildMeasurementHtml(meta: DocMeta, sections: Section[], opts: ExportOptions): string {
   // The infinite branch emits one `.doc-render` with every section and block in model order. Real page
   // breaks are irrelevant here (this pass paginates from scratch), so infinite format, no pagedLayout.
   const flatOpts: ExportOptions = { ...opts, format: { kind: 'infinite' }, pagedLayout: undefined }
   const baseHtml = generateExportHTML(meta, sections, flatOpts)

   // Text wraps at the shared contentBoxWidthPx (the paged content box), so the measured heights match
   // the paged sheet's. Only top / bottom margins apply (as padding), to reproduce the real
   // `.doc-render`'s vertical margin collapse; horizontal margins do not affect wrapping once the box is
   // pinned.
   const contentWidth = contentBoxWidthPx(opts.format)
   const margins      = opts.format?.margins ?? DEFAULT_A4_MARGINS
   const top          = millimetresToPx(margins.top)
   const bottom       = millimetresToPx(margins.bottom)

   // The sidebar / footer / card chrome is neutralised so only the measured content occupies the flow.
   const override = `
            .sidebar { display: none !important; }
            .main { display: block !important; margin: 0 !important; padding: 0 !important; }
            .doc-card { max-width: none !important; width: ${contentWidth}px !important; border: 0 !important; box-shadow: none !important; }
            .doc-card > .doc-render { width: ${contentWidth}px !important; padding: ${top}px 0 ${bottom}px 0 !important; }
            .doc-footer { display: none !important; }
   `
   return baseHtml.replace('</head>', `<style>${override}</style></head>`)
}

/**
 * Settle the frame's geometry after a content change, then wait for images. Deliberately NO rAF wait:
 * Chrome throttles requestAnimationFrame in a hidden iframe to ~1fps, so awaiting a frame would stall
 * close to a second per pass, which the editor's per-pause recompute cannot afford. It is also
 * redundant, since reading a layout property forces the synchronous layout the measurement primitive
 * does anyway. So flush layout once via offsetHeight, then keep only the async image decode. Fonts are
 * loaded on the warm frame, and MathML / inline SVG render synchronously, so neither needs a wait.
 */
async function settleFrameLayout(frameDocument: Document): Promise<void> {
   // Read a layout property to force a synchronous reflow now, so the heights read next are final.
   const docRender = frameDocument.querySelector<HTMLElement>('.doc-render')
   void (docRender ?? frameDocument.documentElement).offsetHeight
   const images = Array.from(frameDocument.querySelectorAll('img'))
   await Promise.all(images.map(image => (image.decode ? image.decode().catch(() => {}) : Promise.resolve())))
}

/** Wait until a freshly written frame is final: fonts loaded, then layout settled. Only the first write
 *  (or a head-changing rewrite) pays the font load; later swaps settle through settleFrameLayout alone. */
async function whenFrameReadyToMeasure(frameDocument: Document): Promise<void> {
   const fonts = frameDocument.fonts
   if (fonts && fonts.ready) { try { await fonts.ready } catch { /* measure with fallback metrics */ } }
   await settleFrameLayout(frameDocument)
}

// ############
// # DECORATE #
// ############

/** Move the `<p>`'s inline content into a transparent `data-rich` span so its lines can be measured as
 *  a DESCENDANT of the block element (which may BE the `<p>` or wrap it). An inline span does not change
 *  line boxes, so the measured lines match the export's rendering. */
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
 * Add the measurement anchors the paginator's height oracle reads. Sections get `data-section-id`; each
 * top-level block that produced an element gets `data-block-id` (paragraphs also a `data-rich` span,
 * lists a `data-list-item-id` per root item). A block whose export renders to nothing produces no
 * element and is skipped, so DOM elements pair to model blocks by walking both in order and consulting
 * the same per-block renderer the export uses.
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
 * layout entirely: a Save-as-PDF right after an HTML export of the same document is instant. The key is
 * a deterministic signature of every input that can change a measured height, so a hit can only ever be
 * a genuinely identical document. Held at module scope, so it needs no invalidation, only overwriting.
 */

// The layout result (pages + too-tall ids + heights) lives in pageLayout.ts; re-exported here so the
// existing importers keep resolving unchanged.
export type { DocumentPages } from './pageLayout'
import type { DocumentPages } from './pageLayout'

interface PagesMemoEntry { signature: string; result: DocumentPages }

let lastPagesMemo: PagesMemoEntry | null = null

/** A deterministic signature of the measurement inputs. pagedLayout is excluded: it is a
 *  caller-supplied override, not a measurement input (measurement always re-paginates from scratch). */
export function exportPagesSignature(meta: DocMeta, sections: Section[], opts: ExportOptions): string {
   return JSON.stringify([
      meta, sections, opts.format ?? null, opts.theme, opts.accent, opts.lang ?? 'en', opts.presentation ?? null,
   ])
}

/** The memoized result (pages + too-tall ids) for this signature, or null on a miss. */
function memoizedPages(signature: string): DocumentPages | null {
   return lastPagesMemo && lastPagesMemo.signature === signature ? lastPagesMemo.result : null
}

/** Replace the single memo entry, holding the too-tall set alongside the pages so a hit returns both. */
function storePages(signature: string, result: DocumentPages): void {
   lastPagesMemo = { signature, result }
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

// ##############
// # WARM FRAME #
// ##############

/*
 * A single hidden measurement iframe, created once and kept attached for the life of the page. The
 * editor calls the paginator on every typing pause, so tearing the frame down (and cold-loading fonts)
 * per call is not affordable. Instead the frame is warm: fonts load once, and each pass swaps only the
 * render container's contents, then re-decorates and re-pins the width, so the measured DOM is
 * byte-for-byte a throwaway frame's. The head (export CSS, font links, width override) is rewritten
 * only when a head-affecting input changes, keyed by headStyleSignature; a content-only edit never
 * rewrites the head, so it never reloads fonts.
 */

interface WarmMeasurementFrame { iframe: HTMLIFrameElement; headSignature: string }

let warmFrame: WarmMeasurementFrame | null = null

/** The signature of everything shaping the measurement document's HEAD (CSS, fonts, width override) but
 *  NOT its body. The model is deliberately absent: a content edit must take the fast swap path, not a
 *  head rewrite. */
function headStyleSignature(opts: ExportOptions): string {
   return JSON.stringify([
      opts.format ?? null, opts.theme, opts.accent, opts.lang ?? 'en', opts.presentation ?? null,
   ])
}

/** The `.doc-render` inner HTML parsed out of the freshly built measurement HTML. The swap path drops
 *  this into the warm frame's existing `.doc-render`, so the swapped DOM matches a full write's body. */
function buildRenderInnerHtml(meta: DocMeta, sections: Section[], opts: ExportOptions): string {
   const html = buildMeasurementHtml(meta, sections, opts)
   const parsed = new DOMParser().parseFromString(html, 'text/html')
   const docRender = parsed.querySelector('.doc-render')
   return docRender ? docRender.innerHTML : ''
}

/** Re-pin the render container to the paged content box after a content swap. The head override already
 *  targets `.doc-render`, but re-applying the width and vertical padding inline guarantees the wrap
 *  width even if the head drifts. Matches buildMeasurementHtml's values exactly. */
function reapplyMeasurementWidth(docRender: HTMLElement, opts: ExportOptions): void {
   const contentWidth = contentBoxWidthPx(opts.format)
   const margins      = opts.format?.margins ?? DEFAULT_A4_MARGINS
   docRender.style.width   = `${contentWidth}px`
   docRender.style.padding = `${millimetresToPx(margins.top)}px 0 ${millimetresToPx(margins.bottom)}px 0`
}

/** The warm frame's live document, creating and attaching the iframe on first use. Returns null only when
 *  the frame cannot host a document (no contentWindow), which the caller treats as "cannot measure". */
function ensureWarmFrameDocument(opts: ExportOptions): Document | null {
   if (!warmFrame || !warmFrame.iframe.isConnected) {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.style.cssText = measurementFrameStyle(opts.format)
      document.body.appendChild(iframe)
      // A fresh iframe has no head yet, so force the first pass down the full-write branch.
      warmFrame = { iframe, headSignature: '' }
   }
   // Keep the frame wide enough for the current format's sheet even if the format changed since creation.
   warmFrame.iframe.style.cssText = measurementFrameStyle(opts.format)
   return warmFrame.iframe.contentWindow?.document ?? null
}

/**
 * Render `(meta, sections, opts)` into the warm frame and return the pages plus too-tall ids.
 * Full-writes the whole document only when the head signature changed (or the frame is new), paying the
 * one font load; otherwise swaps just the render container's contents without reloading fonts. Either
 * way the DOM is decorated before measuring. Empty result when the frame cannot be measured.
 */
async function measureDocumentInWarmFrame(meta: DocMeta, sections: Section[], opts: ExportOptions): Promise<DocumentPages> {
   const empty: DocumentPages = { pages: [], tooTallPageIds: new Set(), heights: EMPTY_HEIGHTS }
   const frameDocument = ensureWarmFrameDocument(opts)
   if (!frameDocument || !warmFrame) return empty

   const headSignature = headStyleSignature(opts)
   const needsFullWrite = warmFrame.headSignature !== headSignature

   if (needsFullWrite) {
      // A head-affecting input changed (or the frame is new): rewrite the whole document and reload fonts.
      // The full write already carries this call's body, so no swap is needed on this pass.
      frameDocument.open()
      frameDocument.write(buildMeasurementHtml(meta, sections, opts))
      frameDocument.close()
      await whenFrameReadyToMeasure(frameDocument)
      warmFrame.headSignature = headSignature
   } else {
      // Content-only edit: swap the render container's contents, re-pin the width, and settle without
      // touching the already-loaded fonts. This is the hot path the editor's per-pause recompute takes.
      const docRender = frameDocument.querySelector<HTMLElement>('.doc-render')
      if (!docRender) return empty
      docRender.innerHTML = buildRenderInnerHtml(meta, sections, opts)
      reapplyMeasurementWidth(docRender, opts)
      await settleFrameLayout(frameDocument)
   }

   const docRender = frameDocument.querySelector<HTMLElement>('.doc-render')
   if (!docRender) return empty
   decorateForMeasurement(docRender, sections, opts.theme)

   // The offscreen pass supplies fresh heights; paginateDocument turns them into pages + too-tall ids
   // through the one pagination every surface shares, so all surfaces agree by construction.
   const heights = measureHeightsFromContainer(docRender, sections)
   return paginateDocument(sections, opts.format, heights)
}

// #############
// # SEQUENCE  #
// #############

/*
 * The warm frame is a single shared surface, so two overlapping measurements must not interleave their
 * innerHTML swaps and settle waits. Every measurement runs through this one-at-a-time chain: each waits
 * for the previous before touching the frame. Callers still each receive their own result; only the
 * frame's mutation is serialized.
 */

let measurementChain: Promise<unknown> = Promise.resolve()

function runExclusive<Result>(task: () => Promise<Result>): Promise<Result> {
   const result = measurementChain.then(task, task)
   // Keep the chain alive whether this task resolved or rejected, so one failure never wedges the queue.
   measurementChain = result.then(() => undefined, () => undefined)
   return result
}

// ########
// # CORE #
// ########

/**
 * The document's deterministic page layout for `(meta, sections, opts)`: render into the warm frame,
 * measure, paginate, returning BOTH the pages and the too-tall ids off the one measurement. Empty for a
 * non-paged (infinite) document, so callers keep their `partitionIntoPages` fallback. Never reads live
 * editor state. The single paginator every surface draws from.
 */
export async function computeDocumentPages(
   meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS,
): Promise<DocumentPages> {
   const paged = !!opts.format && opts.format.kind !== 'infinite'
   if (!paged) return { pages: [], tooTallPageIds: new Set(), heights: EMPTY_HEIGHTS }
   if (typeof document === 'undefined') return { pages: [], tooTallPageIds: new Set(), heights: EMPTY_HEIGHTS }

   // An unchanged document skips the offscreen layout. Checked once here for the repeat-call fast path,
   // and again inside the serialized section so identical concurrent calls collapse to one measurement.
   const signature = exportPagesSignature(meta, sections, opts)
   const cached = memoizedPages(signature)
   if (cached) return cached

   return runExclusive(async () => {
      const hit = memoizedPages(signature)
      if (hit) return hit
      const result = await measureDocumentInWarmFrame(meta, sections, opts)
      storePages(signature, result)
      return result
   })
}

// #############
// # DOWNLOAD  #
// #############

/** Download the document as a self-contained HTML file. Self-measures the paged layout first (paged
 *  only), so the exported pagination is independent of editor state. */
export async function downloadHTML(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): Promise<void> {
   const { pages } = await computeDocumentPages(meta, sections, opts)
   const finalOpts = pages.length > 0 ? { ...opts, pagedLayout: pages } : opts
   const html = generateExportHTML(meta, sections, finalOpts)

   await saveTextFile({
      suggestedName: slugify(meta.title) + '.html',
      contents:      html,
      filters:       [{ name: 'HTML document', extensions: ['html'] }],
   })
}

// ##########
// # PRINT  #
// ##########

/** The paged export HTML string for the document: self-measures the layout (paged only, falling back to
 *  generateExportHTML's forced-break partition for an infinite document), then bakes those pages into the
 *  export. The exact HTML printDocument renders, obtainable without opening the print dialog, so a native
 *  renderer can feed it to a real PDF writer. */
export async function buildPagedExportHtml(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): Promise<string> {
   let pages: Page[] = []
   try {
      pages = (await computeDocumentPages(meta, sections, opts)).pages
   } catch { pages = [] }
   const finalOpts = pages.length > 0 ? { ...opts, pagedLayout: pages } : opts
   return generateExportHTML(meta, sections, finalOpts)
}

/** Resolve `frameDocument.fonts.ready` (best effort), so the print engine lays out the final page with
 *  the real fonts rather than a fallback-font first pass. */
async function whenFontsReady(frameDocument: Document): Promise<void> {
   const fonts = frameDocument.fonts
   if (fonts && fonts.ready) { try { await fonts.ready } catch { /* print with fallback fonts */ } }
}

/**
 * Open the browser print dialog ("Save as PDF") over the paged export HTML. Measurement runs through the
 * shared warm frame (reusing the memo), then a SEPARATE short-lived iframe the dialog can hold renders
 * and prints the final export. A measurement failure (or an infinite document) falls back to
 * generateExportHTML's forced-break partition rather than aborting the print.
 */
export async function printDocument(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): Promise<void> {
   let pages: Page[] = []
   try {
      pages = (await computeDocumentPages(meta, sections, opts)).pages
   } catch { pages = [] }

   const iframe = document.createElement('iframe')
   iframe.setAttribute('aria-hidden', 'true')
   iframe.style.cssText = measurementFrameStyle(opts.format)
   document.body.appendChild(iframe)

   const frameWindow   = iframe.contentWindow
   const frameDocument = frameWindow?.document
   if (!frameWindow || !frameDocument) { iframe.remove(); return }

   const finalOpts = pages.length > 0 ? { ...opts, pagedLayout: pages } : opts
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
