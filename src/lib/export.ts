import type { DocMeta, InlineContent, ListItem, Section, Block } from '../types'
import { esc, slugify } from './text'
import { renderInlineContent } from './inline'
import { blockAnchor } from './document'
import { highlight } from './highlight'
import { renderLatexToMathML, TEMML_STYLES } from './math'

export interface ExportOptions {
   theme: 'light' | 'dark'
   accent: string
   lang?: 'en' | 'fr'
}

const DEFAULTS: ExportOptions = { theme: 'light', accent: '#f97316' }

/** Render an InlineContent array to export-safe HTML. */
function richToHtml(richText: InlineContent | undefined): string {
   if (!richText || richText.length === 0) return ''
   return renderInlineContent(richText)
}

function withHandle(block: Block, html: string): string {
   if (!block.handle) return html
   return `<div id="${blockAnchor(block)}" style="scroll-margin-top:1.5rem">${html}</div>`
}

function exportBlock(block: Block, options?: { imagePlaceholder?: boolean }): string {
   if (block.type === 'p')       return withHandle(block, `<p>${richToHtml(block.richText)}</p>`)
   if (block.type === 'h3')      return withHandle(block, `<h3>${richToHtml(block.richText)}</h3>`)
   if (block.type === 'h4')      return withHandle(block, `<h4>${richToHtml(block.richText)}</h4>`)
   if (block.type === 'callout') return withHandle(block, `<div class="callout ${block.style ?? 'info'}">${richToHtml(block.richText)}</div>`)
   if (block.type === 'code') {
      const highlighted = highlight(block.code ?? '', block.lang ?? 'windev')
      return withHandle(block, `<pre><code>${highlighted}</code></pre>`)
   }
   if (block.type === 'math') {
      // Self-contained: the block ships pure MathML markup, no runtime, no fonts. An empty
      // formula renders nothing; an invalid one falls back to its escaped LaTeX source.
      const latex = (block.latex ?? '').trim()
      if (!latex) return ''
      const rendered = renderLatexToMathML(latex, true)
      const inner = rendered.ok
         ? rendered.mathml
         : `<code class="doc-math-error">${esc(latex)}</code>`
      // The MathML scales with the wrapper's font-size. Emit the inline size only for a
      // non-default scale, so the default export stays byte-identical to before this feature.
      const scale     = block.mathScale
      const styleAttr = scale !== undefined && scale !== 1 ? ` style="font-size:${scale}em"` : ''
      return withHandle(block, `<div class="doc-math"${styleAttr}>${inner}</div>`)
   }
   if (block.type === 'list') {
      function exportListItem(item: ListItem): string {
         const childHtml = item.children.length > 0
            ? `<ul>${item.children.map(exportListItem).join('')}</ul>`
            : ''
         return `<li>${richToHtml(item.richText)}${childHtml}</li>`
      }
      return withHandle(block, `<ul>${(block.items ?? []).map(exportListItem).join('')}</ul>`)
   }
   if (block.type === 'checklist') {
      // Real, interactive checkboxes: a reader of the exported file can tick items (native
      // local DOM toggle, no persistence). `checked` reflects the saved state.
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
      if (!block.src) {
         // Preview snapshots strip image src. With imagePlaceholder on (binder mini preview),
         // render a muted placeholder; otherwise (full export) emit nothing, as before.
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

/**
 * Render a block array to an HTML string using the same per-block logic as the full
 * HTML export. Pure, no downloads, no DOM access. Used by the binder document mini
 * preview to render each preview section's blocks inside a `.doc-render` wrapper.
 * Pass `{ imagePlaceholder: true }` to render src-less images as a muted placeholder.
 */
export function renderBlocksToDocHtml(blocks: Block[], options?: { imagePlaceholder?: boolean }): string {
   return blocks.map(block => exportBlock(block, options)).join('\n')
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

function buildStyles(accent: string, colors: Colors): string {
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
                  max-width: 860px;
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
   `
}

const STRINGS = {
   en: { fallback: 'Documentation', madeWith: 'Made with Documinter' },
   fr: { fallback: 'Documentation', madeWith: 'Fait avec Documinter' },
}

/**
 * Resolve a field color to an export-safe literal, or null when it should fall back to the
 * default muted gray supplied by CSS. 'accent' tracks the document accent (export has no live
 * CSS var, so the accent value is substituted); any other string is a literal hex.
 */
function resolveExportColor(color: string | undefined, accent: string): string | null {
   if (color === undefined) return null
   if (color === 'accent')  return accent
   return color
}

/**
 * Render the freeform metadata fields for one placement zone (above or below the title) as a
 * horizontal `.page-meta` row, skipping any field that is fully empty. Each field shows its
 * label (when present) followed by its value, tinted with the field's resolved color.
 */
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

export function generateExportHTML(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): string {
   const { theme, accent, lang = 'en' } = opts
   const strings = STRINGS[lang]
   const colors  = getColors(theme)
   const styles  = buildStyles(accent, colors)

   const navLinks = sections.map((section, sectionIndex) =>
      `        <a href="#section-${section.id}" class="nav-link">${sectionIndex + 1}. ${esc(section.title)}</a>`
   ).join('\n')

   const sectionsHTML = sections.map((sec, sectionIndex) => {
      const blocksHTML = sec.blocks.map(block => '            ' + exportBlock(block)).join('\n')
      return `
            <div class="doc-section" id="section-${sec.id}">
                  <h2>${sectionIndex + 1}. ${esc(sec.title)}</h2>
${blocksHTML}
            </div>`
   }).join('\n')

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

<main class="main">
      <div class="doc-card">
            <div class="doc-render">
                  <div class="page-header">
                        ${renderMetaZone(meta, 'above', accent)}
                        <h1>${esc(meta.title) || strings.fallback}</h1>
                        ${renderMetaZone(meta, 'below', accent)}
                  </div>
                  ${sectionsHTML}
            </div>
            <div class="doc-footer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 253.01 273.36"><path fill="currentColor" d="M194.49,186.08l35.56-24.07s-29.29,40.79-50.76,41.06c0,0-14.06.1-14.46-13.15v-81.98s.71-16.01-15.98-16.01c0,0-7.08-1.01-11.63,5.97l-32.16,60.12-33.07-60.02s-3.03-6.07-11.93-6.07c0,0-14.97-1.11-14.97,14.06v82.04s.07,13.96-14.7,13.96c0,0-14.38.07-14.38-13.03V14.97h122.06v55.05h55.01v81s4.87-10.62,17.01-13.48V59.01L151.09,0H.07s-.07,190.02-.07,190.02c0,0,1.31,28.01,30.34,28.01s29.83-28.31,29.83-28.31v-81.71l38.02,70.08,12.74-.1,37.99-69.98v82.11s-.81,27.91,30.07,27.91c0,0,19.82,1.82,34.18-18.1,0,0,37.01,8.39,39.84-58.75,0,0-63.1-5.26-58.52,44.9Z"/><polygon fill="currentColor" points="193.73 259.32 14 259.32 14 227.97 0 220.24 0 273.36 208.8 273.36 208.8 221.08 193.73 228.21 193.73 259.32"/></svg>${strings.madeWith}</div>
      </div>
</main>

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
      secs.forEach(s => observer.observe(s));
      links.forEach(l => {
            l.addEventListener('click', e => {
                  e.preventDefault();
                  const t = document.querySelector(l.getAttribute('href'));
                  if (t) t.scrollIntoView({ behavior: 'smooth' });
            });
      });
</script>
</body>
</html>`
}

export function downloadHTML(meta: DocMeta, sections: Section[], opts: ExportOptions = DEFAULTS): void {
   const html = generateExportHTML(meta, sections, opts)
   const slug = slugify(meta.title)
   const anchor = document.createElement('a')
   anchor.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
   anchor.download = slug + '.html'
   anchor.click()
   URL.revokeObjectURL(anchor.href)
}
