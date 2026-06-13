import { useMemo } from 'react'
import docCssText from '../WysiwygArea/doc.css?raw'
import { renderBlocksToDocHtml } from '../../lib/export'
import { esc } from '../../lib/text'
import type { DocMeta, PreviewSection } from '../../types'

interface DocumentCardPreviewProps {
   meta:            DocMeta
   previewSections: PreviewSection[]
   docTheme:        'light' | 'dark'
   docAccent:       string
}

// Box = the visible preview area. The paper is inset by MARGIN on the top/sides so it
// reads as a sheet on a canvas; it extends past the bottom (clipped) to show "a portion".
const BOX_WIDTH      = 180
const BOX_HEIGHT     = 240
const MARGIN         = 12
const PAPER_VISUAL_W = BOX_WIDTH - MARGIN * 2                     // 160
const VIRTUAL_WIDTH  = 560                                        // narrower than the editor → larger text
const SCALE          = PAPER_VISUAL_W / VIRTUAL_WIDTH             // ≈ 0.286
const VIRTUAL_HEIGHT = Math.ceil((BOX_HEIGHT - MARGIN) / SCALE)   // tall enough to reach the box bottom
const ROOT_FONT_SIZE = 18                                         // bumps all rem-based doc text (16 → 18)

const FONT_LINK =
   '<link rel="preconnect" href="https://fonts.googleapis.com">' +
   '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
   '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">'

/**
 * Miniature document preview in a sandboxed iframe. Replicates the editor's "paper":
 * doc.css (?raw) + the document fonts, a canvas-colored backdrop with the inset accent-bordered
 * page, the page header (module/title/meta) and section-grouped previewSections — all scaled
 * down. Faithful to each document's own theme + accent. Static HTML only — sandbox="".
 */
export function DocumentCardPreview({ meta, previewSections, docTheme, docAccent }: DocumentCardPreviewProps) {
   const srcDoc = useMemo(() => {
      const isDark    = docTheme === 'dark'
      const docDark   = isDark ? ' doc-dark' : ''
      const canvasBg  = isDark ? '#0d1117' : '#e9ebef'   // backdrop around the sheet

      const pageHeader = `<div class="page-header">
${meta.module ? `<div class="page-module">${esc(meta.module)}</div>` : ''}
<h1>${esc(meta.title) || '&nbsp;'}</h1>
<div class="page-meta">
${meta.env    ? `<span>${esc(meta.env)}</span>`    : ''}
${meta.date   ? `<span>${esc(meta.date)}</span>`   : ''}
${meta.author ? `<span>${esc(meta.author)}</span>` : ''}
</div>
</div>`

      const sectionsHtml = (previewSections ?? []).map((section, index) =>
         `<div class="doc-section"><h2>${index + 1}. ${esc(section.title)}</h2>${renderBlocksToDocHtml(section.blocks)}</div>`
      ).join('')

      return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONT_LINK}<style>
html{font-size:${ROOT_FONT_SIZE}px}
body{margin:0;padding:${MARGIN}px;overflow:hidden;background:${canvasBg}}
.preview-paper{background:var(--doc-canvas-bg);border-top:4px solid ${docAccent};border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.18);box-sizing:border-box;min-height:${VIRTUAL_HEIGHT}px}
${docCssText}
</style></head><body class="${isDark ? 'doc-dark' : ''}">
<div class="preview-paper doc-render${docDark}" style="--doc-accent:${docAccent};width:${VIRTUAL_WIDTH}px;transform:scale(${SCALE});transform-origin:top left">
${pageHeader}
${sectionsHtml}
</div>
</body></html>`
   }, [meta, previewSections, docTheme, docAccent])

   return (
      <iframe
         sandbox=""
         srcDoc={srcDoc}
         title=""
         aria-hidden="true"
         tabIndex={-1}
         scrolling="no"
         className="shrink-0 block pointer-events-none"
         style={{ width: BOX_WIDTH, height: BOX_HEIGHT, border: 'none', borderRight: '1px solid var(--color-border)' }}
      />
   )
}
