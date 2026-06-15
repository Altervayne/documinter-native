import type { CSSProperties } from 'react'
import { renderBlocksToDocHtml } from '../lib/export'
import { esc } from '../lib/text'
import type { DocMeta, PreviewSection } from '../types'
import './documentMiniPreview.css'

interface DocumentMiniPreviewProps {
   meta:            DocMeta
   previewSections: PreviewSection[]   // section-grouped snapshot (image src already stripped)
   docTheme:        'light' | 'dark'
   docAccent:       string
   className?:      string
}

/**
 * A read-only miniature of a document. Renders the real `.doc-render` markup with doc.css
 * verbatim, wrapped in the same accent-bordered "paper" the editor canvas uses, then uniformly
 * transform-scaled down to fit its container, identical stylization to the canvas, just smaller.
 * Reuses the export block renderer so it stays faithful. Purely visual: `pointer-events: none`,
 * `overflow: hidden`, fills its container (the parent sets the dimensions).
 */
export function DocumentMiniPreview({ meta, previewSections, docTheme, docAccent, className }: DocumentMiniPreviewProps) {
   const rootClass = ['rounded-sm doc-mini-preview', docTheme === 'dark' ? 'doc-dark' : '', className ?? ''].filter(Boolean).join(' ')

   const header = `<div class="page-header">${
      meta.module ? `<div class="page-module">${esc(meta.module)}</div>` : ''
   }<h1>${esc(meta.title) || '&nbsp;'}</h1><div class="page-meta">${
      meta.env    ? `<span>${esc(meta.env)}</span>`    : ''
   }${
      meta.date   ? `<span>${esc(meta.date)}</span>`   : ''
   }${
      meta.author ? `<span>${esc(meta.author)}</span>` : ''
   }</div></div>`

   const sections = previewSections.map((section, index) =>
      `<div class="doc-section"><h2>${index + 1}. ${esc(section.title)}</h2>${
         renderBlocksToDocHtml(section.blocks, { imagePlaceholder: true })
      }</div>`,
   ).join('')

   return (
      <div className={rootClass} style={{ '--doc-accent': docAccent } as CSSProperties} aria-hidden="true">
         <div className="doc-mini-page">
            <div className="doc-render" dangerouslySetInnerHTML={{ __html: header + sections }} />
         </div>
      </div>
   )
}
