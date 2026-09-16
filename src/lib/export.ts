import type { DocMeta, InlineContent, ListItem, Section, Block } from '../types'
import { esc } from './text'
import { renderInlineContent } from './inline'
import { blockAnchor } from './document'
import { highlight } from './highlight'
import { renderLatexToMathML, TEMML_STYLES } from './math'
import { renderGraphToSvg, LIGHT_GRAPH_THEME, DARK_GRAPH_THEME } from './graph'
import { renderDiagramToSvg, LIGHT_DIAGRAM_THEME, DARK_DIAGRAM_THEME } from './diagram'
import { renderImageMarkupToSvg } from './imageMarkup'
import { imageBlockToMarkupSpec } from './imageMarkupBlock'
import { collectTableSources, resolveGraphSpec } from './graphTableData'
import type { GraphTableCatalog } from './graphTableData'
import { markerOrDefault, isOrderedMarker, markerListStyleType, markerMarkerClass } from './listMarkers'
import {
   resolveWatermarkLayout, effectiveWatermarkOpacity, renderWatermarkPatternSvg, watermarkTransform,
   headerJustifyContent, resolveHeaderBesideLayout, reconcileNav, reconcileNavEntries,
   collectAnchoredHandles,
   type DocPresentationExtras, type Watermark, type Header,
} from './presentation'
import { resolveDocumentSheetWidthPx, resolveHeader, resolveFooterBand, DEFAULT_A4_MARGINS, type DocFormat, type PageMargins } from './format'
import { renderPageBandHtml } from './pageBands'
import {
   partitionIntoPages, millimetresToPx,
   A4_PORTRAIT_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_WIDTH_PX, A4_LANDSCAPE_HEIGHT_PX,
   type Page,
} from './pageModel'

export interface ExportOptions {
   theme: 'light' | 'dark'
   accent: string
   lang?: 'en' | 'fr'
   /** Document-level presentation extras (watermark, header logo, and so on). Absent means the
    *  output matches the plain export exactly: every emission below is guarded on this field. */
   presentation?: DocPresentationExtras
   /** Document page format (infinite width or paged A4). Absent, or `{ kind: 'infinite' }` with no
    *  width or a 'normal' width, all resolve to the same 860px `.doc-card` max-width, so output stays
    *  byte-identical (see resolveDocumentSheetWidthPx). */
   format?: DocFormat
   /** The reflowed pages to render (splittable lists and paragraphs auto-flowed across sheets). The DOM
    *  entry points pass the export's own offscreen measurement. Absent (a DOM-less context) falls back
    *  to the plain forced-break partition, which never splits a block. */
   pagedLayout?: Page[]
}

const DEFAULTS: ExportOptions = { theme: 'light', accent: '#f97316' }

// Shared empty catalog for the no-tables fallback, so no fresh Map is allocated per graph block.
const EMPTY_TABLE_CATALOG: GraphTableCatalog = new Map()

function richToHtml(richText: InlineContent | undefined): string {
   if (!richText || richText.length === 0) return ''
   return renderInlineContent(richText)
}

function withHandle(block: Block, html: string): string {
   if (!block.handle) return html
   return `<div id="${blockAnchor(block)}" style="scroll-margin-top:1.5rem">${html}</div>`
}

function exportBlock(block: Block, options?: { imagePlaceholder?: boolean; theme?: 'light' | 'dark'; tables?: GraphTableCatalog }): string {
   if (block.type === 'p')       return withHandle(block, `<p>${richToHtml(block.richText)}</p>`)
   if (block.type === 'h3')      return withHandle(block, `<h3>${richToHtml(block.richText)}</h3>`)
   if (block.type === 'h4')      return withHandle(block, `<h4>${richToHtml(block.richText)}</h4>`)
   if (block.type === 'callout') {
      // A custom hex takes an inline-style path; the preset styles keep the plain class path, so a
      // callout that never touched the custom color exports byte-identical.
      if (block.calloutColor) {
         const surface   = getColors(options?.theme ?? 'light').cardBg
         const styleAttr = ` style="border-color:${block.calloutColor};background:color-mix(in srgb, ${block.calloutColor} 12%, ${surface})"`
         return withHandle(block, `<div class="callout"${styleAttr}>${richToHtml(block.richText)}</div>`)
      }
      return withHandle(block, `<div class="callout ${block.style ?? 'info'}">${richToHtml(block.richText)}</div>`)
   }
   if (block.type === 'code') {
      const highlighted = highlight(block.code ?? '', block.lang ?? 'windev')
      return withHandle(block, `<pre><code>${highlighted}</code></pre>`)
   }
   if (block.type === 'math') {
      // Self-contained pure MathML, no runtime. An empty formula renders nothing; an invalid one
      // falls back to its escaped LaTeX source.
      const latex = (block.latex ?? '').trim()
      if (!latex) return ''
      const rendered = renderLatexToMathML(latex, true)
      const inner = rendered.ok
         ? rendered.mathml
         : `<code class="doc-math-error">${esc(latex)}</code>`
      // Emit the inline font-size only for a non-default scale, so a default scale emits no style.
      const scale     = block.mathScale
      const styleAttr = scale !== undefined && scale !== 1 ? ` style="font-size:${scale}em"` : ''
      return withHandle(block, `<div class="doc-math"${styleAttr}>${inner}</div>`)
   }
   if (block.type === 'graph') {
      // Self-contained inline SVG, colors baked as literal hex for the export's single theme, so the
      // graph theme is resolved from the export theme, not a live CSS variable.
      if (!block.graph) return ''
      const graphTheme = options?.theme === 'dark' ? DARK_GRAPH_THEME : LIGHT_GRAPH_THEME
      // A linked graph bakes concrete data from the table catalog; a dangling source falls back to the
      // materialized snapshot in `block.graph.data`. resolveGraphSpec handles both.
      const { renderSpec } = resolveGraphSpec(block.graph, options?.tables ?? EMPTY_TABLE_CATALOG)
      const svg = renderGraphToSvg(renderSpec, graphTheme)
      return withHandle(block, `<div class="doc-graph">${svg}</div>`)
   }
   if (block.type === 'diagram') {
      // Self-contained inline SVG, colors baked for the export's single theme, so the diagram theme
      // is resolved from the export theme, not a live CSS variable.
      if (!block.diagram) return ''
      const diagramTheme = options?.theme === 'dark' ? DARK_DIAGRAM_THEME : LIGHT_DIAGRAM_THEME
      const svg = renderDiagramToSvg(block.diagram, diagramTheme)
      return withHandle(block, `<div class="doc-diagram">${svg}</div>`)
   }
   if (block.type === 'list') {
      // Any non-`dot` marker anywhere in the tree switches to the per-sub-list `<ol>`/`<ul>` render
      // with its list-style-type / marker class. An all-`dot` list keeps the bare `<ul>`, so an
      // untouched document exports byte-identical HTML.
      function subListHasCustomMarker(items: ListItem[]): boolean {
         return items.some(item =>
            (item.childMarker !== undefined && item.childMarker !== 'dot') ||
            subListHasCustomMarker(item.children),
         )
      }
      const rootMarker       = markerOrDefault(block.listMarker)
      const hasCustomMarkers = rootMarker !== 'dot' || subListHasCustomMarker(block.items ?? [])
      if (!hasCustomMarkers) {
         function exportListItem(item: ListItem): string {
            const childHtml = item.children.length > 0
               ? `<ul>${item.children.map(exportListItem).join('')}</ul>`
               : ''
            return `<li>${richToHtml(item.richText)}${childHtml}</li>`
         }
         return withHandle(block, `<ul>${(block.items ?? []).map(exportListItem).join('')}</ul>`)
      }
      // Each sub-list renders its OWN marker: the root from block.listMarker, a nested one from the
      // parent item's childMarker. The marker travels down per item, not a depth index, so two
      // sibling sub-lists stay independent.
      function renderMarkedSubList(items: ListItem[], marker: ReturnType<typeof markerOrDefault>): string {
         const tag         = isOrderedMarker(marker) ? 'ol' : 'ul'
         const styleType   = markerListStyleType(marker)
         const markerClass = markerMarkerClass(marker)
         const classAttr   = markerClass ? ` class="${markerClass}"` : ''
         const styleAttr   = styleType ? ` style="list-style-type:${styleType}"` : ''
         const itemsHtml   = items.map(item => {
            const childHtml = item.children.length > 0
               ? renderMarkedSubList(item.children, markerOrDefault(item.childMarker))
               : ''
            return `<li>${richToHtml(item.richText)}${childHtml}</li>`
         }).join('')
         return `<${tag}${classAttr}${styleAttr}>${itemsHtml}</${tag}>`
      }
      return withHandle(block, renderMarkedSubList(block.items ?? [], rootMarker))
   }
   if (block.type === 'checklist') {
      // Real interactive checkboxes: a reader can tick items (local DOM toggle, no persistence).
      function exportChecklistItem(item: ListItem): string {
         const childHtml = item.children.length > 0
            ? `<ul class="doc-checklist">${item.children.map(exportChecklistItem).join('')}</ul>`
            : ''
         const checkedAttr = item.checked ? ' checked' : ''
         return `<li class="doc-check-item"><input type="checkbox"${checkedAttr}><span>${richToHtml(item.richText)}</span>${childHtml}</li>`
      }
      return withHandle(block, `<ul class="doc-checklist">${(block.items ?? []).map(exportChecklistItem).join('')}</ul>`)
   }
   if (block.type === 'table') {
      const headerCells = (block.richHeaders ?? [])
         .map(header => `<th>${richToHtml(header)}</th>`).join('')
      const bodyRows = (block.richRows ?? [])
         .map(row =>
            `<tr>${row.map(cell => `<td>${richToHtml(cell)}</td>`).join('')}</tr>`
         ).join('')
      return withHandle(block, `<div class="table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`)
   }
   if (block.type === 'image') {
      // A marked-up image is a self-contained inline SVG (base64 baked in, unlike the fence). Its
      // annotation colors are the author's explicit choices, so no theme argument. Handled BEFORE the
      // empty-src short-circuit so a src-less-but-annotated image still renders its ground + overlay.
      if (block.imageMarkup) {
         const svg = renderImageMarkupToSvg(imageBlockToMarkupSpec(block))
         return withHandle(block, `<div class="doc-image-markup">${svg}</div>`)
      }
      if (!block.src) {
         // Preview snapshots strip image src. imagePlaceholder renders a muted placeholder; a full
         // export emits nothing.
         if (!options?.imagePlaceholder) return ''
         return withHandle(block, `<div class="doc-image-placeholder" role="img" aria-label="${esc(block.alt) || 'Image'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>`)
      }
      const align = block.align ?? 'center'
      const figureMargin = align === 'left'
         ? 'margin-left:0;margin-right:auto'
         : align === 'right'
            ? 'margin-left:auto;margin-right:0'
            : 'margin-left:auto;margin-right:auto'
      const imgHeight = block.imageHeight
         ? `height:${block.imageHeight}px;object-fit:cover;`
         : 'height:auto;'
      return withHandle(block, `<figure class="doc-figure" style="width:fit-content;max-width:100%;margin-top:1.25rem;margin-bottom:1.25rem;${figureMargin}">
         <img src="${block.src}" alt="${esc(block.alt)}" style="max-width:100%;${imgHeight}border-radius:6px;border:1px solid rgba(0,0,0,0.08);box-shadow:0 1px 4px rgba(0,0,0,0.06),0 4px 16px rgba(0,0,0,0.05);display:block">
         ${block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''}
      </figure>`)
   }
   if (block.type === 'hr') return withHandle(block, '<hr>')
   if (block.type === 'container') {
      const ratio    = block.ratio ?? 0.5
      const leftHtml  = (block.left  ?? []).map(inner => exportBlock(inner, options)).join('\n')
      const rightHtml = (block.right ?? []).map(inner => exportBlock(inner, options)).join('\n')
      return `<div class="doc-container" style="display:flex;gap:1.5rem;align-items:flex-start">
         <div style="flex:${ratio}">${leftHtml}</div>
         <div style="flex:${1 - ratio}">${rightHtml}</div>
      </div>`
   }
   return ''
}

/** Render a block array with the same per-block logic as the full export. Pure, no DOM access. Used
 *  by the binder mini preview. `{ imagePlaceholder: true }` renders src-less images as a placeholder. */
export function renderBlocksToDocHtml(blocks: Block[], options?: { imagePlaceholder?: boolean; theme?: 'light' | 'dark' }): string {
   // Catalog from THIS slice so a linked graph resolves against a table in the same preview; a table
   // outside the slice falls back to its snapshot.
   const tables = collectTableSources(blocks)
   return blocks.map(block => exportBlock(block, { ...options, tables })).join('\n')
}

/** Render ONE page's HTML the way the paged export does: the document header on the first page, then
 *  each section slice with its `<h2>N. Title</h2>`, so the Pages-panel thumbnail reflects the real
 *  page. `sections` is the full flow, used only to number a slice's section. */
export function renderPagePreviewHtml(
   page: Page,
   opts: { isFirstPage: boolean; meta: DocMeta; sections: Section[]; accent: string; theme: 'light' | 'dark'; fallbackTitle: string; imagePlaceholder?: boolean },
): string {
   const { isFirstPage, meta, sections, accent, theme, fallbackTitle, imagePlaceholder } = opts
   const tables = collectTableSources(page.slices.flatMap(slice => slice.blocks))
   const headerHTML = isFirstPage
      ? `<div class="page-header">${renderMetaZone(meta, 'above', accent)}${renderPageTitle(meta, fallbackTitle, undefined)}${renderMetaZone(meta, 'below', accent)}</div>`
      : ''
   const slicesHTML = page.slices.map(slice => {
      const sectionIndex = sections.findIndex(section => section.id === slice.section.id)
      const heading    = slice.isSectionStart ? `<h2>${sectionIndex + 1}. ${esc(slice.section.title)}</h2>` : ''
      const blocksHTML = slice.blocks.map(block => exportBlock(block, { theme, imagePlaceholder, tables })).join('\n')
      return `<div class="doc-section">${heading}${blocksHTML}</div>`
   }).join('\n')
   return headerHTML + slicesHTML
}

interface Colors {
   bodyBg: string; cardBg: string; cardShadow: string
   text: string; textMuted: string; textH: string; textP: string
   border: string
   sidebarBg: string; navLink: string; navHover: string
   preBg: string; preBorder: string; preText: string
   inlineCodeBg: string; inlineCodeText: string; inlineCodeBorder: string
   thBg: string; tdHover: string
   calloutInfoBg: string; calloutInfoBorder: string
   calloutValidBg: string; calloutValidBorder: string
   calloutWarnBg: string; calloutWarnBorder: string
   calloutDangerBg: string; calloutDangerBorder: string
   tokKw: string; tokStr: string; tokCmt: string; tokNum: string
   tokFn: string; tokOp: string; tokType: string
   btnBg: string; btnBorder: string; btnText: string
   scrollTrack: string; scrollThumb: string
}

function getColors(theme: 'light' | 'dark'): Colors {
   if (theme === 'dark') {
      return {
         bodyBg: '#0d1117', cardBg: '#161b22',
         cardShadow: '0 4px 24px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)',
         text: '#e6edf3', textMuted: '#8b949e', textH: '#e6edf3', textP: '#c9d1d9',
         border: '#30363d',
         sidebarBg: '#0d1117', navLink: '#8b949e', navHover: '#e6edf3',
         preBg: '#0d1117', preBorder: '#21262d', preText: '#c9d1d9',
         inlineCodeBg: 'rgba(56,139,253,0.1)', inlineCodeText: '#79c0ff', inlineCodeBorder: 'rgba(56,139,253,0.25)',
         thBg: '#0d1117', tdHover: '#1c2128',
         calloutInfoBg: '#051d40', calloutInfoBorder: '#388bfd',
         calloutValidBg: '#031a12', calloutValidBorder: '#3fb950',
         calloutWarnBg: '#2a1700', calloutWarnBorder: '#d29922',
         calloutDangerBg: '#1f0a0a', calloutDangerBorder: '#f85149',
         tokKw: '#ff7b72', tokStr: '#a5d6ff', tokCmt: '#8b949e', tokNum: '#f0883e',
         tokFn: '#d2a8ff', tokOp: '#8b949e', tokType: '#76e3ea',
         btnBg: '#21262d', btnBorder: '#30363d', btnText: '#8b949e',
         scrollTrack: '#0d1117', scrollThumb: '#30363d',
      }
   }
   return {
      bodyBg: '#eef1f5', cardBg: '#ffffff',
      cardShadow: '0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
      text: '#1a1a2e', textMuted: '#6b7280', textH: '#111827', textP: '#374151',
      border: '#e5e7eb',
      sidebarBg: '#ffffff', navLink: '#6b7280', navHover: '#111827',
      preBg: '#f8fafc', preBorder: '#e2e8f0', preText: '#334155',
      inlineCodeBg: '#eff6ff', inlineCodeText: '#2563eb', inlineCodeBorder: '#dbeafe',
      thBg: '#f9fafb', tdHover: '#f9fafb',
      calloutInfoBg: '#eff6ff', calloutInfoBorder: '#2563eb',
      calloutValidBg: '#f0fdf4', calloutValidBorder: '#16a34a',
      calloutWarnBg: '#fffbeb', calloutWarnBorder: '#d97706',
      calloutDangerBg: '#fff1f2', calloutDangerBorder: '#e11d48',
      tokKw: '#0550C0', tokStr: '#A31515', tokCmt: '#008000', tokNum: '#098658',
      tokFn: '#7c3aed', tokOp: '#6b7280', tokType: '#0891b2',
      btnBg: '#ffffff', btnBorder: '#e5e7eb', btnText: '#9ca3af',
      scrollTrack: '#eef1f5', scrollThumb: '#d1d5db',
   }
}

function buildStyles(accent: string, colors: Colors, hasWatermark: boolean, hasHeader: boolean, hasCustomNav: boolean, sheetWidthPx: number, pagedStyles: string): string {
   // Appended ONLY when a watermark is present, so an absent one leaves the style block unchanged.
   // .doc-card is the positioning context (overflow clips to its radius), the .doc-watermark layer
   // sits at z-index 0, and the content rides above.
   const watermarkStyles = hasWatermark ? `
            /* Background watermark (presentation) */
            .doc-card { position: relative; overflow: hidden; }
            .doc-watermark {
                  position: absolute; inset: 0; pointer-events: none; z-index: 0;
                  background-repeat: no-repeat;
            }
            .doc-watermark-clip {
                  position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0;
            }
            .doc-card > .doc-render { position: relative; z-index: 1; }
            .doc-card > .doc-footer { position: relative; z-index: 1; }
   ` : ''
   // Same guarded convention as the watermark. 'above' is its own row before <h1>; 'beside' wraps
   // logo + <h1> in one centered row, with the title's own margin-bottom suppressed.
   const headerStyles = hasHeader ? `
            /* Header logo (presentation) */
            .doc-render .page-logo-row              { display: flex; align-items: center; gap: 0.75rem; }
            .doc-render .page-logo-row:not(.page-logo-row-beside) { margin-bottom: 0.75rem; }
            .doc-render .page-logo-row-beside h1     { margin-bottom: 0; }
            .doc-render .page-logo                   { display: block; width: auto; max-width: 100%; height: auto; }
   ` : ''
   // Appended ONLY for a customized nav, same guarded convention. A section-only nav never emits
   // either element, so gating on the model's presence (not its entry kinds) is enough.
   const navStyles = hasCustomNav ? `
            /* Custom sidebar nav (presentation) */
            .nav-external::after { content: " \\2197"; opacity: 0.55; font-size: 0.9em; }
            .nav-divider {
                  margin: 0.7rem 1.25rem 0.35rem;
                  padding-top: 0.55rem;
                  border-top: 1px solid ${colors.border};
                  font-family: 'JetBrains Mono', monospace;
                  font-size: 0.6rem; font-weight: 700;
                  text-transform: uppercase; letter-spacing: 0.08em;
                  color: ${colors.textMuted};
            }
            .nav-divider:empty { padding-top: 0; margin-top: 0.5rem; margin-bottom: 0.5rem; }
   ` : ''
   return `
            /* Reset */
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            html { scroll-behavior: smooth; }
            body {
                  background: ${colors.bodyBg};
                  font-family: 'Inter', sans-serif;
                  font-size: 15px;
                  line-height: 1.75;
                  color: ${colors.text};
                  display: flex;
                  min-height: 100vh;
                  -webkit-font-smoothing: antialiased;
            }

            /* Sidebar */
            .sidebar {
                  position: fixed; top: 0; left: 0;
                  width: 260px; height: 100vh;
                  background: ${colors.sidebarBg};
                  border-right: 1px solid ${colors.border};
                  overflow-y: auto;
                  padding: 1.5rem 0 2rem;
                  z-index: 100;
            }
            .sidebar-brand {
                  font-family: 'JetBrains Mono', monospace;
                  font-size: 0.72rem; font-weight: 700;
                  text-transform: uppercase; letter-spacing: 0.08em;
                  color: ${accent};
                  padding: 0 1.25rem 1rem;
                  border-bottom: 1px solid ${colors.border};
                  margin-bottom: 0.75rem;
                  display: block;
            }
            .nav-link {
                  display: block;
                  padding: 0.4rem 1.25rem;
                  text-decoration: none;
                  color: ${colors.navLink};
                  font-size: 0.82rem;
                  border-left: 2px solid transparent;
                  transition: color .15s, border-color .15s;
            }
            .nav-link:hover { color: ${colors.navHover}; }
            .nav-link.active { color: ${accent}; border-left-color: ${accent}; }

            /* Main area */
            .main {
                  margin-left: 260px;
                  width: 100%;
                  padding: 2.5rem 2rem 6rem;
                  display: flex;
                  justify-content: center;
                  align-items: flex-start;
            }

            /* Document card */
            .doc-card {
                  width: 100%;
                  max-width: ${sheetWidthPx}px;
                  background: ${colors.cardBg};
                  border-radius: 2px;
                  border-top: 4px solid ${accent};
                  box-shadow: ${colors.cardShadow};
            }

            /* Document content */
            .doc-render {
                  padding: 3rem 3.5rem 6rem;
                  font-family: 'Inter', sans-serif;
                  font-size: 15px;
                  line-height: 1.75;
                  color: ${colors.text};
            }

            /* Page header */
            .doc-render .page-header   { margin-bottom: 3rem; padding-bottom: 1.5rem; border-bottom: 1px solid ${colors.border}; }
            .doc-render h1             { font-size: 1.9rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.6rem; color: ${colors.textH}; }
            .doc-render .page-meta     { font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: ${colors.textMuted}; display: flex; gap: 1.5rem; flex-wrap: wrap; }
            .doc-render .page-meta-above { margin-bottom: 0.5rem; }
            .doc-render .page-meta-below { margin-top: 0.6rem; }

            /* Sections */
            .doc-render .doc-section   { margin-bottom: 3.5rem; scroll-margin-top: 1.5rem; }
            .doc-render h2             { font-size: 1.2rem; font-weight: 600; color: ${colors.textH}; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid ${colors.border}; border-left: 3px solid ${accent}; padding-left: 0.75rem; }
            .doc-render h3             { font-size: 0.95rem; font-weight: 600; color: ${colors.textH}; margin: 1.75rem 0 0.6rem; }
            .doc-render h4             { font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: ${colors.textMuted}; margin: 1.25rem 0 0.4rem; }
            .doc-render p              { margin-bottom: 0.9rem; font-size: 0.92rem; color: ${colors.textP}; }
            .doc-render hr             { border: none; border-top: 1px solid ${colors.border}; margin: 3rem 0; }

            /* Images */
            .doc-render .doc-figure { margin: 1.25rem 0; }
            .doc-render .doc-figure-left   { margin-right: auto; }
            .doc-render .doc-figure-center { margin-left: auto; margin-right: auto; }
            .doc-render .doc-figure-right  { margin-left: auto; }
            .doc-render .doc-figure figcaption { font-size: 0.8rem; color: ${colors.textMuted}; font-style: italic; margin-top: 0.4rem; text-align: center; }

            /* Containers */
            .doc-render .doc-container { margin: 1.25rem 0; }
            @media (max-width: 600px) { .doc-render .doc-container { flex-direction: column !important; } }

            /* Inline formatting */
            .doc-render strong { font-weight: 700; }
            .doc-render em     { font-style: italic; }
            .doc-render u      { text-decoration: underline; }
            .doc-render s      { text-decoration: line-through; }
            .doc-render a      { color: ${accent}; text-decoration: underline; }
            .doc-render a:hover { opacity: 0.8; }

            /* Inline code */
            .doc-render code           { font-family: 'JetBrains Mono', monospace; font-size: 0.82em; background: ${colors.inlineCodeBg}; color: ${colors.inlineCodeText}; padding: 0.15em 0.4em; border-radius: 3px; border: 1px solid ${colors.inlineCodeBorder}; }

            /* Code block */
            .doc-render pre            { background: ${colors.preBg}; border: 1px solid ${colors.preBorder}; border-radius: 6px; overflow-x: auto; margin: 1.25rem 0; }
            .doc-render pre code       { display: block; padding: 1rem 1.25rem; background: none; border: none; color: ${colors.preText}; font-size: 0.82rem; line-height: 1.7; white-space: pre; }

            /* Math block, centered display equation. The inner override makes the display math
               inline-block so text-align:center can center it (Temml's own rule sets width:100%). */
            .doc-render .doc-math       { margin: 1.5rem 0; text-align: center; overflow-x: auto; }
            .doc-render .doc-math math  { display: inline-block; text-align: initial; }
            .doc-render .doc-math-error { color: ${colors.calloutDangerBorder}; }

            /* Graph block, self-contained inline SVG (colors baked for this export's theme). */
            .doc-render .doc-graph      { margin: 1.5rem 0; max-width: 100%; overflow-x: auto; }
            .doc-render .doc-graph svg  { display: block; max-width: 100%; height: auto; margin: 0 auto; }

            /* Diagram block, self-contained inline SVG (colors baked for this export's theme). */
            .doc-render .doc-diagram      { margin: 1.5rem 0; max-width: 100%; overflow-x: auto; }
            .doc-render .doc-diagram svg  { display: block; max-width: 100%; height: auto; margin: 0 auto; }

            /* Image-markup block, self-contained inline SVG (annotation colors are the author's
               explicit choice, not theme-baked, no light/dark variant needed here). */
            .doc-render .doc-image-markup     { margin: 1.5rem 0; max-width: 100%; overflow-x: auto; }
            .doc-render .doc-image-markup svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }

            /* Callouts */
            .doc-render .callout         { padding: 0.75rem 1rem; border-radius: 6px; border-left: 3px solid; font-size: 0.88rem; margin: 1.25rem 0; color: ${colors.textP}; }
            .doc-render .callout.info    { background: ${colors.calloutInfoBg}; border-color: ${colors.calloutInfoBorder}; }
            .doc-render .callout.valid   { background: ${colors.calloutValidBg}; border-color: ${colors.calloutValidBorder}; }
            .doc-render .callout.warning { background: ${colors.calloutWarnBg}; border-color: ${colors.calloutWarnBorder}; }
            .doc-render .callout.danger  { background: ${colors.calloutDangerBg}; border-color: ${colors.calloutDangerBorder}; }

            /* Table */
            .doc-render .table-wrap    { overflow-x: auto; margin: 1.25rem 0; border-radius: 6px; border: 1px solid ${colors.border}; }
            .doc-render table          { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
            .doc-render th             { background: ${colors.thBg}; padding: 0.6rem 1rem; text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em; color: ${colors.textMuted}; border-bottom: 1px solid ${colors.border}; }
            .doc-render td             { padding: 0.6rem 1rem; border-bottom: 1px solid ${colors.border}; vertical-align: top; color: ${colors.textP}; }
            .doc-render tbody tr:last-child td { border-bottom: none; }
            .doc-render tbody tr:hover td { background: ${colors.tdHover}; }

            /* Lists */
            .doc-render ul, .doc-render ol { padding-left: 1.5rem; margin-bottom: 0.9rem; font-size: 0.92rem; }
            .doc-render li             { margin-bottom: 0.3rem; color: ${colors.textP}; }
            .doc-render li::marker     { color: ${colors.inlineCodeText}; }
            /* Non-native list markers: the dash and arrow styles draw their glyph as ::marker content. */
            .doc-render .doc-list-marker-dash > li::marker  { content: "\\2013\\00a0"; }
            .doc-render .doc-list-marker-arrow > li::marker { content: "\\25B8\\00a0"; }
            .doc-render ul.doc-checklist { list-style: none; padding-left: 0.5rem; }
            .doc-render ul.doc-checklist ul.doc-checklist { padding-left: 1.5rem; margin-bottom: 0; }
            .doc-render .doc-check-item { display: flex; align-items: flex-start; gap: 0.5rem; }
            .doc-render .doc-check-item > input[type="checkbox"] { margin-top: 0.28rem; flex-shrink: 0; width: 0.95rem; height: 0.95rem; accent-color: ${accent}; cursor: pointer; }
            .doc-render .doc-check-item > span { flex: 1; }
            .doc-render .doc-check-item > ul.doc-checklist { flex-basis: 100%; }

            /* Syntax tokens */
            .tok-kw   { color: ${colors.tokKw}; font-weight: 600; }
            .tok-str  { color: ${colors.tokStr}; }
            .tok-cmt  { color: ${colors.tokCmt}; font-style: italic; }
            .tok-num  { color: ${colors.tokNum}; }
            .tok-fn   { color: ${colors.tokFn}; }
            .tok-op   { color: ${colors.tokOp}; }
            .tok-type { color: ${colors.tokType}; }

            /* Back to top */
            #toTopBtn {
                  position: fixed; bottom: 1.5rem; right: 1.5rem;
                  width: 34px; height: 34px;
                  background: ${colors.btnBg}; border: 1px solid ${colors.btnBorder};
                  border-radius: 8px; color: ${colors.btnText}; cursor: pointer;
                  font-size: 0.9rem; display: flex; align-items: center; justify-content: center;
                  opacity: 0; pointer-events: none;
                  transition: opacity .2s, color .2s, border-color .2s; z-index: 200;
                  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
            }
            #toTopBtn.visible { opacity: 1; pointer-events: auto; }
            #toTopBtn:hover { color: ${accent}; border-color: ${accent}; }

            /* Scrollbar */
            ::-webkit-scrollbar { width: 5px; }
            ::-webkit-scrollbar-track { background: ${colors.scrollTrack}; }
            ::-webkit-scrollbar-thumb { background: ${colors.scrollThumb}; border-radius: 3px; }

            /* Watermark footer */
            .doc-footer {
                  padding: 1rem 3.5rem 1.5rem;
                  display: flex;
                  align-items: center;
                  justify-content: flex-end;
                  gap: 0.4rem;
                  font-family: 'JetBrains Mono', monospace;
                  font-size: 0.65rem;
                  color: ${colors.textMuted};
                  opacity: 0.35;
                  border-top: 1px solid ${colors.border};
                  letter-spacing: 0.04em;
            }
            .doc-footer svg {
                  height: 1.2rem;
                  width: auto;
                  flex-shrink: 0;
            }

            @media (max-width: 768px) {
                  .sidebar { display: none; }
                  .main { margin-left: 0; padding: 1.5rem 1rem; }
            }

            /* Temml MathML rendering-correction rules (self-contained, no fonts) */
            ${TEMML_STYLES}
${watermarkStyles}${headerStyles}${navStyles}${pagedStyles}   `
}

// #############################################################
// # PAGED (A4) EXPORT STYLES                                  #
// #############################################################

/**
 * The paged-A4 stylesheet, emitted ONLY for a paged format (empty otherwise, so infinite export stays
 * byte-identical). Each derived page gets its own A4 `.doc-page` sheet: on screen the sheets stack like
 * the editor; an `@page` rule plus `@media print` overrides make print-to-PDF emit one true A4 page per
 * sheet, `page-break-inside: avoid` keeping self-contained figures off a page seam. `pageCount` pins the
 * stack's printed height to an exact page-count multiple (see the `.doc-pages` print rule).
 */
function buildPagedStyles(
   accent:        string,
   colors:        Colors,
   orientation:   'portrait' | 'landscape',
   margins:       PageMargins,
   sheetWidthPx:  number,
   sheetHeightPx: number,
   hasWatermark:  boolean,
   pageCount:     number,
): string {
   // Per-sheet watermark clipping, the paged analogue of the `.doc-card` rules; only when present.
   const watermarkPaged = hasWatermark
      ? `
            .doc-page { position: relative; overflow: hidden; }
            .doc-watermark-clip { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
            .doc-page > .doc-render { position: relative; z-index: 1; }`
      : ''

   // Print sheets are floored a hair UNDER the true physical A4 page. `sheetHeightPx` is the ROUNDED
   // constant (1123px); a real A4 page is 1122.52px at 96dpi, so a 1123 sheet is ~0.5px too tall and
   // the accumulated overshoot eventually tips a sliver onto a phantom extra page. Flooring to the real
   // page height keeps a sheet always <= one page, so the stack stays a whole number of physical pages.
   const printSheetHeightPx = Math.floor(millimetresToPx(orientation === 'landscape' ? 210 : 297) * 100) / 100

   return `
            /* Paged (A4) layout. @page carries only the physical A4 size; the margins are owned by the
               sheet's .doc-render padding (see @media print), because browsers honor @page margins
               inconsistently and drop the top band. */
            @page { size: A4 ${orientation}; margin: 0; }
            .doc-pages { display: flex; flex-direction: column; align-items: center; gap: 2rem; }
            .doc-page {
                  box-sizing: border-box;
                  position: relative;
                  width: ${sheetWidthPx}px;
                  min-height: ${sheetHeightPx}px;
                  background: ${colors.cardBg};
                  border-top: 4px solid ${accent};
                  border-radius: 2px;
                  box-shadow: ${colors.cardShadow};
            }
            .doc-page > .doc-render { padding: ${millimetresToPx(margins.top)}px ${millimetresToPx(margins.right)}px ${millimetresToPx(margins.bottom)}px ${millimetresToPx(margins.left)}px; }
            /* Running header / footer bands: one left/center/right row each, pinned in the top / bottom
               margin band of EVERY sheet (mirrors the editor's .doc-band rules). */
            .doc-band {
                  position: absolute;
                  left: ${millimetresToPx(margins.left)}px;
                  right: ${millimetresToPx(margins.right)}px;
                  display: flex;
                  align-items: center;
                  font-family: 'JetBrains Mono', monospace;
                  font-size: 0.7rem;
                  letter-spacing: 0.03em;
                  color: ${colors.textMuted};
            }
            .doc-band-header { top: ${millimetresToPx(margins.top) / 2}px; transform: translateY(-50%); }
            .doc-band-footer { bottom: ${millimetresToPx(margins.bottom) / 2}px; transform: translateY(50%); }
            .doc-band-cell { flex: 1 1 0; display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
            .doc-band-left   { justify-content: flex-start; }
            .doc-band-center { justify-content: center; }
            .doc-band-right  { justify-content: flex-end; }
            .doc-band-credit { display: inline-flex; align-items: center; gap: 0.35rem; opacity: 0.55; }
            .doc-band-logo { height: 1rem; width: auto; flex-shrink: 0; }
            .doc-band-img  { max-height: 1.6rem; width: auto; flex-shrink: 0; }
            .doc-band-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .doc-render .doc-figure, .doc-render .doc-image-markup, .doc-render .doc-graph,
            .doc-render .doc-diagram, .doc-render .table-wrap, .doc-render .doc-math,
            .doc-render .callout, .doc-render pre { page-break-inside: avoid; break-inside: avoid; }
            @media print {
                  /* Margins stay as .doc-render padding (reliable CSS px), so the top band never
                     collapses the way an @page margin does. Sheets become plain full-width blocks so
                     the left edge is not shaved. print-color-adjust: exact prints the accent, callout
                     fills, code, and watermark without the reader toggling "Background graphics". The
                     page background follows the sheet colour so a dark document does not print white
                     below a short page. The position:fixed sidebar and back-to-top would repeat on
                     every sheet, so both are hidden. */
                  html, body { margin: 0; background: ${colors.cardBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                  .sidebar, #toTopBtn { display: none !important; }
                  .main { margin: 0; padding: 0; }
                  /* The stack owns an EXACT page-count multiple of a sheet's height, so the whole canvas
                     paints in the sheet colour and no un-themed paper shows through. The multiplier is
                     max(100vh, sheetHeightPx), NOT plain 100vh: when the print engine's "100vh" resolves
                     SHORTER than a real A4 sheet (an interactive iframe print), a plain N*100vh stack
                     comes out shorter than its children and overflow: hidden then CLIPS the last sheet's
                     fill and footer band. Matching the stack to the sheets' real floored height prevents
                     that; overflow: hidden still clips content drifting a hair PAST the last page. */
                  .doc-pages {
                        display: block; gap: 0; margin: 0; padding: 0;
                        height: calc(${pageCount} * max(100vh, ${printSheetHeightPx}px)); overflow: hidden;
                        background: ${colors.cardBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;
                  }
                  /* Each sheet fills one physical page (height: 100vh) so the footer band pins to the
                     real page bottom; the full-height boxes paginate NATURALLY (one per page), so NO
                     page-break-after, which plus a full-height box would emit an empty page after every
                     sheet. The base rule's min-height (the A4 px floor) is KEPT, not reset: it pins a
                     sheet to a whole page when the print engine's "100vh" resolves a hair short. The
                     sheet colour is restated so a SHORT last page's blank tail prints in the document
                     background, not un-themed paper. */
                  .doc-page {
                        box-shadow: none; border-radius: 0; width: 100%; height: 100vh; min-height: ${printSheetHeightPx}px; margin: 0; overflow: hidden;
                        background: ${colors.cardBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;
                  }
            }${watermarkPaged}`
}

const STRINGS = {
   en: { fallback: 'Documentation', madeWith: 'Made with Documinter', pageWord: 'Page', ofWord: 'of' },
   fr: { fallback: 'Documentation', madeWith: 'Fait avec Documinter', pageWord: 'Page', ofWord: 'sur' },
}

/** An export-safe literal color, or null to fall back to the CSS default muted gray. 'accent'
 *  substitutes the document accent (export has no live CSS var); any other string is a literal hex. */
function resolveExportColor(color: string | undefined, accent: string): string | null {
   if (color === undefined) return null
   if (color === 'accent')  return accent
   return color
}

/** Render one placement zone's freeform fields as a horizontal `.page-meta` row, skipping fully-empty
 *  fields. Each shows its label (when present) then value, tinted with the field's resolved color. */
function renderMetaZone(meta: DocMeta, position: 'above' | 'below', accent: string): string {
   const rows = meta.fields
      .filter(field => field.position === position)
      .filter(field => field.label.trim() !== '' || field.value.trim() !== '')
      .map(field => {
         const label     = esc(field.label.trim())
         const value     = esc(field.value.trim())
         const resolved  = resolveExportColor(field.color, accent)
         const styleAttr = resolved ? ` style="color:${resolved}"` : ''
         // showLabel === false renders the value only (no label, no colon).
         const showLabel = field.showLabel !== false
         const inner = showLabel
            ? (label ? (value ? `${label}: ${value}` : label) : value)
            : value
         return `<span class="page-meta-field"${styleAttr}>${inner}</span>`
      })
   if (rows.length === 0) return ''
   const zoneClass = position === 'above' ? 'page-meta page-meta-above' : 'page-meta page-meta-below'
   return `<div class="${zoneClass}">${rows.join('')}</div>`
}

/** Render a SINGLE (non-tiled) watermark as a self-contained `<div class="doc-watermark">` with its
 *  base64 image inlined. Fit / position map to CSS background-* (resolveWatermarkLayout), offset +
 *  rotation to one transform (watermarkTransform), opacity dimmed for the dark theme exactly as the
 *  editor dims it. The TILED case is renderWatermarkPatternSvg, shared verbatim with the editor. */
function renderWatermarkLayer(watermark: Watermark, theme: 'light' | 'dark'): string {
   const layout  = resolveWatermarkLayout(watermark)
   const opacity = effectiveWatermarkOpacity(watermark.opacity, theme)
   const style = [
      // Single-quote the url() so the base64 data URL cannot collide with the double-quoted style="..."
      // attribute this drops into (a double-quoted url() would close it early). Data URLs are base64,
      // so they never contain a single quote of their own.
      `background-image:url('${watermark.src}')`,
      `background-repeat:${layout.repeat}`,
      `background-size:${layout.size}`,
      `background-position:${layout.position}`,
      `opacity:${opacity}`,
      `transform:${watermarkTransform(watermark)}`,
   ].join(';')
   return `<div class="doc-watermark" aria-hidden="true" style="${style}"></div>`
}

/** Render the page title, optionally wrapped with a header logo. Absent header emits exactly
 *  `<h1>...</h1>`. A present header inlines its base64 image as `.page-logo`: 'above' on its own row
 *  before the title, 'beside' wraps logo + title in one flex row; both honor `align` and `maxHeight`. */
function renderPageTitle(meta: DocMeta, fallbackTitle: string, header: Header | undefined): string {
   const titleHtml = `<h1>${esc(meta.title) || fallbackTitle}</h1>`
   if (!header?.src) return titleHtml
   const logoHtml = `<img class="page-logo" src="${header.src}" alt="" style="max-height:${header.maxHeight}px">`
   if (header.placement === 'beside') {
      const besideLayout = resolveHeaderBesideLayout(header)
      const content = besideLayout.logoFirst ? `${logoHtml}${titleHtml}` : `${titleHtml}${logoHtml}`
      return `<div class="page-logo-row page-logo-row-beside" style="justify-content:${besideLayout.justifyContent}">${content}</div>`
   }
   const justify = headerJustifyContent(header.align)
   return `<div class="page-logo-row" style="justify-content:${justify}">${logoHtml}</div>\n                        ${titleHtml}`
}

export function generateExportHTML(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): string {
   const { theme, accent, lang = 'en' } = opts
   const strings = STRINGS[lang]
   const colors  = getColors(theme)
   // Watermark: guarded on the optional field so an absent one yields byte-identical output (no markup
   // AND no CSS). The base64 src is inlined, like image blocks.
   const watermark = opts.presentation?.watermark
   const hasWatermark = !!watermark?.src
   // Header logo: same guard, over both renderPageTitle's markup and the .page-logo* CSS.
   const header = opts.presentation?.header
   const hasHeader = !!header?.src
   // Custom nav: present builds the sidebar from the reconciled model and emits the nav CSS; absent
   // falls back to the default per-section derivation.
   const hasCustomNav = !!opts.presentation?.nav
   // Absent format or infinite+normal resolve to the same 860px as the plain export; only a non-normal
   // infinite width (or a paged A4 sheet) changes it.
   const sheetWidthPx = resolveDocumentSheetWidthPx(opts.format)

   // Paged (A4) export: guarded on a paged format, so infinite or absent leaves both the CSS and the
   // <main> markup unchanged.
   const paged = !!opts.format && opts.format.kind !== 'infinite'
   const pagedIsLandscape   = opts.format?.kind === 'a4-landscape'
   const pagedMargins       = opts.format?.margins ?? DEFAULT_A4_MARGINS
   const pagedSheetWidthPx  = pagedIsLandscape ? A4_LANDSCAPE_WIDTH_PX  : A4_PORTRAIT_WIDTH_PX
   const pagedSheetHeightPx = pagedIsLandscape ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX
   // Derived here already (not just where the sheet markup is built) so the print stylesheet can pin
   // the stack height to an exact page-count multiple; see buildPagedStyles.
   const exportPages = opts.pagedLayout ?? partitionIntoPages(sections, opts.format?.pages ?? [])
   const pagedStyles = paged
      ? buildPagedStyles(accent, colors, pagedIsLandscape ? 'landscape' : 'portrait', pagedMargins, pagedSheetWidthPx, pagedSheetHeightPx, hasWatermark, exportPages.length)
      : ''

   const styles  = buildStyles(accent, colors, hasWatermark, hasHeader, hasCustomNav, sheetWidthPx, pagedStyles)
   // Tiled uses the shared SVG <pattern> builder; single uses the positioned/fit CSS layer. The pattern
   // id only needs to be unique within this document, so a short random suffix is enough. The clip
   // wrapper is NOT transformed, so it clips a rotated/offset watermark to the sheet box without
   // touching .doc-card/.doc-page's own overflow rule.
   const watermarkHTML = hasWatermark
      ? `<div class="doc-watermark-clip">${watermark!.tile
         ? renderWatermarkPatternSvg(watermark!, theme, `doc-watermark-pattern-${Math.random().toString(36).slice(2, 10)}`)
         : renderWatermarkLayer(watermark!, theme)}</div>`
      : ''

   // Build the `handle -> table cells` catalog ONCE (all sections, container columns included), then
   // thread it into every block export so a linked graph bakes a static SVG; the exported HTML carries
   // no live link, dangling falls back to the graph's snapshot.
   const tables = collectTableSources(sections.flatMap(section => section.blocks))

   // Sidebar nav from the reconciled model: absent yields one numbered link per section. A
   // section-target link keeps its `#anchor` href for the scroll-spy; an external link opens in a new
   // tab; a divider is a static separator. Numbering prefixes only section-target links.
   const navLinks = reconcileNav(opts.presentation?.nav, sections).map(entry => {
      if (entry.kind === 'divider') {
         return `        <div class="nav-divider">${esc(entry.label)}</div>`
      }
      if (entry.external) {
         return `        <a href="${esc(entry.href)}" class="nav-link nav-external" target="_blank" rel="noopener">${esc(entry.label)}</a>`
      }
      const numberPrefix = entry.number !== undefined ? `${entry.number}. ` : ''
      return `        <a href="${entry.href}" class="nav-link">${numberPrefix}${esc(entry.label)}</a>`
   }).join('\n')

   const sectionsHTML = sections.map((sec, sectionIndex) => {
      const blocksHTML = sec.blocks.map(block => '            ' + exportBlock(block, { theme, tables })).join('\n')
      return `
            <div class="doc-section" id="section-${sec.id}">
                  <h2>${sectionIndex + 1}. ${esc(sec.title)}</h2>
${blocksHTML}
            </div>`
   }).join('\n')

   // The nav-link click handler smooth-scrolls to a section anchor. A customized nav can hold external
   // links (non-`#` hrefs), so guard on `href.charAt(0) === '#'` and let the browser navigate offsite
   // normally. Absent nav uses the plain unguarded handler.
   const navClickBody = hasCustomNav
      ? `const href = l.getAttribute('href');
                  if (!href || href.charAt(0) !== '#') return;
                  e.preventDefault();
                  const t = document.querySelector(href);
                  if (t) t.scrollIntoView({ behavior: 'smooth' });`
      : `e.preventDefault();
                  const t = document.querySelector(l.getAttribute('href'));
                  if (t) t.scrollIntoView({ behavior: 'smooth' });`

   // The scroll-spy observer highlights a section link as its `.doc-section` scrolls into the band. A
   // custom nav can also link to an anchored block (`#handle`), which is not a `.doc-section`, so
   // collect the handles the nav references (live anchors only) and observe them too. No anchor links
   // leaves navAnchorIds empty, so no extra script. The observer's `en.target.id` matcher is already
   // generic (a block div's id IS its handle).
   const anchoredHandles = collectAnchoredHandles(sections)
   const navAnchorIds: string[] = []
   for (const entry of reconcileNavEntries(opts.presentation?.nav, sections)) {
      if (entry.kind === 'custom' && entry.target.type === 'anchor' && anchoredHandles.has(entry.target.handle)) {
         if (!navAnchorIds.includes(entry.target.handle)) navAnchorIds.push(entry.target.handle)
      }
   }
   const anchorObserveScript = navAnchorIds.length > 0
      ? `\n      ${JSON.stringify(navAnchorIds)}.forEach(id => { const anchorEl = document.getElementById(id); if (anchorEl) observer.observe(anchorEl); });`
      : ''

   // The "made with" footer, extracted once so the infinite doc-card and the last paged sheet reuse
   // the exact same markup.
   const docFooterHTML = `<div class="doc-footer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 253.01 273.36"><path fill="currentColor" d="M194.49,186.08l35.56-24.07s-29.29,40.79-50.76,41.06c0,0-14.06.1-14.46-13.15v-81.98s.71-16.01-15.98-16.01c0,0-7.08-1.01-11.63,5.97l-32.16,60.12-33.07-60.02s-3.03-6.07-11.93-6.07c0,0-14.97-1.11-14.97,14.06v82.04s.07,13.96-14.7,13.96c0,0-14.38.07-14.38-13.03V14.97h122.06v55.05h55.01v81s4.87-10.62,17.01-13.48V59.01L151.09,0H.07s-.07,190.02-.07,190.02c0,0,1.31,28.01,30.34,28.01s29.83-28.31,29.83-28.31v-81.71l38.02,70.08,12.74-.1,37.99-69.98v82.11s-.81,27.91,30.07,27.91c0,0,19.82,1.82,34.18-18.1,0,0,37.01,8.39,39.84-58.75,0,0-63.1-5.26-58.52,44.9Z"/><polygon fill="currentColor" points="193.73 259.32 14 259.32 14 227.97 0 220.24 0 273.36 208.8 273.36 208.8 221.08 193.73 228.21 193.73 259.32"/></svg>${strings.madeWith}</div>`

   // Paged pages: each derived page is one A4 `.doc-page` sheet. A slice renders its section heading
   // only when it STARTS the section (continuation slices flow headingless); the title block rides page
   // 1. The running header / footer bands ride EVERY sheet. Empty for an infinite export.
   const headerBand = resolveHeader(opts.format)
   const footerBand = resolveFooterBand(opts.format)
   const pagesHTML = paged
      ? exportPages.map((page, pageIndex, allPages) => {
           const pageWatermarkHTML = !hasWatermark
              ? ''
              : `<div class="doc-watermark-clip">${watermark!.tile
                 ? renderWatermarkPatternSvg(watermark!, theme, `doc-watermark-pattern-p${pageIndex}`)
                 : renderWatermarkLayer(watermark!, theme)}</div>`
           const slicesHTML = page.slices.map(slice => {
              const sectionIndex = sections.findIndex(section => section.id === slice.section.id)
              const headingHTML  = slice.isSectionStart ? `<h2>${sectionIndex + 1}. ${esc(slice.section.title)}</h2>` : ''
              const idAttr       = slice.isSectionStart ? ` id="section-${slice.section.id}"` : ''
              const blocksHTML   = slice.blocks.map(block => exportBlock(block, { theme, tables })).join('\n')
              return `<div class="doc-section"${idAttr}>${headingHTML}${blocksHTML}</div>`
           }).join('\n')
           const bandCtx = { pageIndex, pageCount: allPages.length, madeWith: strings.madeWith, pageWord: strings.pageWord, ofWord: strings.ofWord }
           const headerHtml = renderPageBandHtml(headerBand, bandCtx)
           const footerHtml = renderPageBandHtml(footerBand, bandCtx)
           const headerBandHTML = headerHtml ? `<div class="doc-band doc-band-header">${headerHtml}</div>` : ''
           const footerBandHTML = footerHtml ? `<div class="doc-band doc-band-footer">${footerHtml}</div>` : ''
           const titleBlockHTML = pageIndex === 0
              ? `<div class="page-header">${renderMetaZone(meta, 'above', accent)}${renderPageTitle(meta, strings.fallback, header)}${renderMetaZone(meta, 'below', accent)}</div>`
              : ''
           return `<div class="doc-page" data-page-id="${esc(page.id)}">${pageWatermarkHTML}${headerBandHTML}${footerBandHTML}<div class="doc-render">${titleBlockHTML}${slicesHTML}</div></div>`
        }).join('\n')
      : ''

   // The <main> body: infinite = the single .doc-card; paged = the stacked A4 sheets.
   const mainHTML = paged
      ? `<main class="main">
      <div class="doc-pages">
${pagesHTML}
      </div>
</main>`
      : `<main class="main">
      <div class="doc-card">${watermarkHTML}
            <div class="doc-render">
                  <div class="page-header">
                        ${renderMetaZone(meta, 'above', accent)}
                        ${renderPageTitle(meta, strings.fallback, header)}
                        ${renderMetaZone(meta, 'below', accent)}
                  </div>
                  ${sectionsHTML}
            </div>
            ${docFooterHTML}
      </div>
</main>`

   return `<!DOCTYPE html>
<html lang="${lang}">
<head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${esc(meta.title) || strings.fallback}</title>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>${styles}    </style>
</head>
<body>

<aside class="sidebar">
      <span class="sidebar-brand">${esc(meta.title) || strings.fallback}</span>
      <nav>
${navLinks}
      </nav>
</aside>

${mainHTML}

<button onclick="scrollToTop()" id="toTopBtn" title="Back to top"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg></button>
<script>
      const btn = document.getElementById('toTopBtn');
      window.addEventListener('scroll', () => { btn.classList.toggle('visible', window.scrollY > 100); });
      function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
      const secs  = document.querySelectorAll('.doc-section');
      const links = document.querySelectorAll('.nav-link');
      const observer = new IntersectionObserver(entries => {
            entries.forEach(en => {
                  if (en.isIntersecting) {
                        links.forEach(l => l.classList.remove('active'));
                        const a = document.querySelector('.nav-link[href="#' + en.target.id + '"]');
                        if (a) a.classList.add('active');
                  }
            });
      }, { rootMargin: '-30% 0px -60% 0px' });
      secs.forEach(s => observer.observe(s));${anchorObserveScript}
      links.forEach(l => {
            l.addEventListener('click', e => {
                  ${navClickBody}
            });
      });
</script>
</body>
</html>`
}

// The DOM entry points `downloadHTML` and `printDocument` live in exportLayout.ts: they self-measure
// the paged layout before generating HTML. generateExportHTML above stays pure and synchronous.
