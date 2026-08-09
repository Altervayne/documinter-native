/*
 * The document's single deterministic pagination pass, shared by every surface. Pagination must lay out
 * from the document itself, not from whatever the live editor happened to have measured, so it becomes a
 * pure function of (model, format, theme) independent of Preview vs Edit, interaction order, and debounce
 * timing. This started as the export-only self-measure; it is now the ONE paginator every surface draws
 * from: the editor canvas, the Pages panel, Preview, and the PDF/HTML export (unified_pagination_study.md,
 * step 2). App owns the resulting page layout and feeds it to all four, so they agree by construction.
 *
 * The pass renders the document UNPAGINATED into an offscreen iframe, at the true A4 content-box width,
 * with the same export CSS and markup the real export emits, then measures every height with the same
 * primitive the editor uses (measureHeightsFromContainer) and feeds the pure paginator. The export HTML
 * carries no measurement anchors, so the rendered DOM is decorated in place (data-block-id / data-rich /
 * data-list-item-id / data-section-id) before measuring; the export string builders stay untouched.
 *
 * Because the editor will call this on every typing pause, the measurement iframe is WARM: one hidden
 * frame is created once and reused, fonts load once, and each pass swaps the render container's content
 * in place rather than rewriting the whole document (see WARM FRAME below). A single measurement yields
 * BOTH the paginated pages and the too-tall page ids, off the same heights, so the two can never disagree.
 *
 * This is the only pagination code that touches the DOM. downloadHTML and printDocument live here (both
 * self-measure); generateExportHTML stays a pure synchronous string builder in export.ts, with its
 * partitionIntoPages fallback intact for DOM-less callers (binder mini-preview, tests).
 */

// -- Lib Imports --
import { generateExportHTML, renderBlocksToDocHtml, type ExportOptions } from './export'
import { measureHeightsFromContainer } from './domMeasure'
import { paginateDocument, contentBoxWidthPx, EMPTY_HEIGHTS } from './pageLayout'
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

/**
 * Settle the frame's geometry after a content change, then wait for images. I do NOT wait animation
 * frames here: the measurement frame is hidden and off-screen, and Chrome throttles requestAnimationFrame
 * in a hidden iframe to roughly 1fps (or pauses it), so awaiting a frame stalls close to a second on every
 * pass, which the editor's per-pause recompute cannot afford. The rAF wait was also redundant: setting
 * innerHTML applies the DOM and styles synchronously, and reading a layout property forces a synchronous
 * layout, which is exactly what the measurement primitive does anyway (getBoundingClientRect). So I flush
 * layout once by reading an offsetHeight, then keep only the genuinely-async image decode (which resolves
 * immediately when there are no images). Fonts are already loaded on the warm frame, so text metrics are
 * final without a frame wait. MathML and inline SVG render synchronously, so they need no wait either.
 */
async function settleFrameLayout(frameDocument: Document): Promise<void> {
   // Read a layout property to force a synchronous reflow now, so the heights read next are final.
   const docRender = frameDocument.querySelector<HTMLElement>('.doc-render')
   void (docRender ?? frameDocument.documentElement).offsetHeight
   const images = Array.from(frameDocument.querySelectorAll('img'))
   await Promise.all(images.map(image => (image.decode ? image.decode().catch(() => {}) : Promise.resolve())))
}

/** Wait until a freshly written frame is final to measure: fonts loaded, then the layout settled. Only the
 *  first write into the warm frame (or a head-changing rewrite) pays the font load; later content swaps
 *  reuse the already-loaded fonts and settle through settleFrameLayout alone. */
async function whenFrameReadyToMeasure(frameDocument: Document): Promise<void> {
   const fonts = frameDocument.fonts
   if (fonts && fonts.ready) { try { await fonts.ready } catch { /* measure with fallback metrics */ } }
   await settleFrameLayout(frameDocument)
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

// The deterministic layout result (pages + too-tall ids + the heights they came from) lives in
// pageLayout.ts now, since the pure paginateDocument builds it and App paginates from it synchronously.
// Re-exported here so the existing exportLayout importers keep resolving unchanged.
export type { DocumentPages } from './pageLayout'
import type { DocumentPages } from './pageLayout'

interface PagesMemoEntry { signature: string; result: DocumentPages }

let lastPagesMemo: PagesMemoEntry | null = null

/** A deterministic signature of the measurement inputs. pagedLayout is excluded on purpose: it is a
 *  caller-supplied override, not a measurement input (the measurement always re-paginates from scratch).
 *  Exported so the determinism test can pin that identical inputs share a key (and height-affecting edits
 *  do not) without needing real layout, which jsdom cannot provide. */
export function exportPagesSignature(meta: DocMeta, sections: Section[], opts: ExportOptions): string {
   return JSON.stringify([
      meta, sections, opts.format ?? null, opts.theme, opts.accent, opts.lang ?? 'en', opts.presentation ?? null,
   ])
}

/** The memoized result (pages + too-tall ids) for this signature, or null on a miss. */
function memoizedPages(signature: string): DocumentPages | null {
   return lastPagesMemo && lastPagesMemo.signature === signature ? lastPagesMemo.result : null
}

/** Replace the single memo entry with this signature's result. Holds the too-tall set alongside the pages
 *  so a memo hit returns both, exactly as a fresh measurement would. */
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
 * A single hidden measurement iframe, created once and kept attached for the life of the page. The editor
 * will call the paginator on every typing pause, so tearing the frame down per call (and cold-loading
 * fonts each time) is not affordable. Instead the frame is warm: fonts load once, and each pass swaps only
 * the render container's contents in place, then re-decorates and re-pins the width, so the measured DOM
 * is byte-for-byte what a throwaway frame would have produced for the same inputs. The head (all the export
 * CSS, the font links, the width override) is rewritten only when a head-affecting input actually changes
 * (theme / accent / language / presentation / format), keyed by headStyleSignature; a content-only edit
 * never rewrites the head, so it never reloads fonts.
 */

interface WarmMeasurementFrame { iframe: HTMLIFrameElement; headSignature: string }

let warmFrame: WarmMeasurementFrame | null = null

/** The signature of everything that shapes the measurement document's HEAD (its CSS, fonts, and the
 *  width override) but NOT its body content. When this is unchanged, the already-loaded head is correct
 *  and only the render container's contents need swapping. The model (meta / sections) is deliberately
 *  absent: a content edit must take the fast swap path, not a head rewrite. */
function headStyleSignature(opts: ExportOptions): string {
   return JSON.stringify([
      opts.format ?? null, opts.theme, opts.accent, opts.lang ?? 'en', opts.presentation ?? null,
   ])
}

/** The inner HTML of the measurement document's `.doc-render` for `(meta, sections, opts)`, parsed out of
 *  the freshly built measurement HTML. This is exactly the content the swap path drops into the warm
 *  frame's existing `.doc-render`, so the swapped DOM matches a full write's body. */
function buildRenderInnerHtml(meta: DocMeta, sections: Section[], opts: ExportOptions): string {
   const html = buildMeasurementHtml(meta, sections, opts)
   const parsed = new DOMParser().parseFromString(html, 'text/html')
   const docRender = parsed.querySelector('.doc-render')
   return docRender ? docRender.innerHTML : ''
}

/** Re-pin the render container to the paged content box after a content swap. The head's width override
 *  already targets `.doc-render` (and the format, hence that override, is unchanged on the swap path), but
 *  re-applying the width and vertical padding inline guarantees the measured wrap width even if the head
 *  ever drifts. Matches buildMeasurementHtml's override values exactly. */
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
 * Render `(meta, sections, opts)` into the warm frame and return the paginated pages plus too-tall ids.
 * Full-writes the whole measurement document only when the head signature changed (or the frame is brand
 * new), paying the one font load; otherwise swaps just the render container's contents and settles without
 * reloading fonts. Either way the DOM is decorated in place before measuring, so both paths measure the
 * same geometry a throwaway frame would have. Returns an empty result when the frame cannot be measured.
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

   // The offscreen pass supplies fresh heights; the pure paginateDocument turns them into pages + too-tall
   // ids through the one budgeted, empty-atomic-set pagination every surface shares. Export paginates the
   // same way App does, so all surfaces agree by construction.
   const heights = measureHeightsFromContainer(docRender, sections)
   return paginateDocument(sections, opts.format, heights)
}

// #############
// # SEQUENCE  #
// #############

/*
 * The warm frame is a single shared surface, so two overlapping measurements (a recompute racing an
 * export, say) must not interleave their innerHTML swaps and settle waits. Every measurement runs through
 * this one-at-a-time chain: each waits for the previous to finish before touching the frame, so the last
 * caller's write is the one that measures. Callers still each receive their own result; only the frame's
 * mutation is serialized.
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
 * The document's deterministic page layout for `(meta, sections, opts)`: renders it into the warm
 * offscreen frame, measures it, and paginates, returning BOTH the pages and the too-tall page ids off the
 * one measurement. Returns an empty result for a non-paged (infinite) document, so callers keep their own
 * `partitionIntoPages` fallback. Never reads live editor state. This is the single paginator every surface
 * draws from: the export/print calls here, and App's documentPages that feeds the canvas, panel, + Preview.
 */
export async function computeDocumentPages(
   meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS,
): Promise<DocumentPages> {
   const paged = !!opts.format && opts.format.kind !== 'infinite'
   if (!paged) return { pages: [], tooTallPageIds: new Set(), heights: EMPTY_HEIGHTS }
   if (typeof document === 'undefined') return { pages: [], tooTallPageIds: new Set(), heights: EMPTY_HEIGHTS }

   // An unchanged document skips the offscreen layout entirely. Infinite documents returned above without
   // a signature, so the memo only ever holds a paged layout. The memo is checked once here for the common
   // repeat-call fast path and again inside the serialized section so identical concurrent calls collapse
   // to one measurement.
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

/**
 * Download the document as a self-contained HTML file. Self-measures the paged layout first (a paged
 * document only; infinite skips straight to generation), so the exported pagination is independent of
 * any editor state.
 */
export async function downloadHTML(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): Promise<void> {
   const { pages } = await computeDocumentPages(meta, sections, opts)
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
 * Open the browser print dialog ("Save as PDF") over the paged export HTML. Measurement runs through the
 * shared warm frame (computeDocumentPages, reusing the memo so a Save-as-PDF right after an HTML export of
 * the same document skips the offscreen pass), then a SEPARATE short-lived iframe renders and prints the
 * final paginated export. The print render needs its own frame the dialog can hold, so it stays here; only
 * the measurement moved to the warm frame. A measurement failure falls back to the forced-break partition
 * inside generateExportHTML rather than aborting the print. An infinite document measures to no pages and
 * falls through to that same forced-break partition.
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
