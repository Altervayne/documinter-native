import { describe, it, expect } from 'vitest'
import { generateExportHTML } from './export'
import { millimetresToPx } from './pageModel'
import type { Page } from './pageModel'
import type { DocMeta, Block, Section } from '../types'
import type { GraphSpec } from './graph'
import type { Watermark, Header } from './presentation'

// A marked-up image (an `image` block carrying an `imageMarkup` overlay) exports as the full-fidelity
// path (unlike its `.mint`/`.md` fence, which never carries the base64 pixels, see imageMarkupFence.ts):
// generateExportHTML must inline the base image verbatim inside the self-contained SVG, same as the
// graph block bakes a static chart. A PLAIN image (no overlay) stays on its own <figure> path.
describe('generateExportHTML, marked-up image block', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }

   it('inlines the base64 image inside a self-contained <svg> under .doc-image-markup', () => {
      const block: Block = {
         id: 'markup', type: 'image',
         src: 'data:image/webp;base64,ZZZZ1234', alt: 'Annotated screenshot',
         imageMarkup: {
            width: 800, height: 600,
            elements: [{ id: 'a', kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, stroke: '#e5484d' }],
         },
      }
      const sections: Section[] = [{ id: 's', title: 'Screens', collapsed: false, blocks: [block] }]
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })

      expect(html).toContain('<div class="doc-image-markup"><svg')
      expect(html).toContain('<image href="data:image/webp;base64,ZZZZ1234"')
      expect(html).toContain('<title>Annotated screenshot</title>')
      expect(html).toContain('stroke="#e5484d"')
      expect(html).toContain('.doc-image-markup')
      // The plain <figure>/<img> image path is NOT taken for a marked-up image.
      expect(html).not.toContain('<figure class="doc-figure"')
   })

   it('does not take the markup path for a plain image (no overlay)', () => {
      // Note: `.doc-image-markup` CSS is always present in the stylesheet (unconditional, same as
      // `.doc-graph`/`.doc-math`), the check is about the BLOCK markup, not the shared CSS rule.
      const block: Block = { id: 'plain', type: 'image', src: 'data:image/png;base64,PLAINPIX', alt: 'Plain' }
      const sections: Section[] = [{ id: 's', title: 'Screens', collapsed: false, blocks: [block] }]
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      expect(html).not.toContain('<div class="doc-image-markup">')
      expect(html).toContain('<figure class="doc-figure"')
   })

   it('renders a neutral placeholder ground (never blank/throws) when src is empty', () => {
      const block: Block = { id: 'markup', type: 'image', src: '', imageMarkup: { width: 400, height: 300, elements: [] } }
      const sections: Section[] = [{ id: 's', title: 'Screens', collapsed: false, blocks: [block] }]
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      expect(html).toContain('<div class="doc-image-markup"><svg')
      expect(html).not.toContain('<image')
   })
})

// A paged export renders the supplied `pagedLayout` (the editor's measured reflow) EXACTLY, so a list
// that was auto-split across sheets in the editor comes out split in the PDF/HTML too. Each fragment is
// a shallow list block whose `items` hold only that page's slice, so it renders as its own <ul>.
describe('generateExportHTML, paged reflow (pagedLayout)', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }
   const listBlock: Block = {
      id: 'L', type: 'list',
      items: [
         { id: 'i0', children: [], richText: [{ text: 'Alpha' }] },
         { id: 'i1', children: [], richText: [{ text: 'Bravo' }] },
         { id: 'i2', children: [], richText: [{ text: 'Charlie' }] },
      ],
   }
   const section: Section = { id: 's', title: 'Items', collapsed: false, blocks: [listBlock] }
   const sliced = (start: number, end: number): Block => ({ ...listBlock, items: listBlock.items!.slice(start, end) })

   it('renders a list split across two sheets as two <ul> fragments, one per sheet', () => {
      const pagedLayout: Page[] = [
         { id: 'page-first', slices: [{ section, blocks: [sliced(0, 2)], isSectionStart: true,  isSectionEnd: false }] },
         { id: 'auto:L:c0',  slices: [{ section, blocks: [sliced(2, 3)], isSectionStart: false, isSectionEnd: true  }] },
      ]
      const html = generateExportHTML(meta, [section], {
         theme: 'light', accent: '#f97316', format: { kind: 'a4-portrait' }, pagedLayout,
      })
      // Two physical sheets, and the list split across them (Alpha/Bravo on the first, Charlie on the second).
      expect((html.match(/class="doc-page"/g) ?? []).length).toBe(2)
      expect((html.match(/<ul>/g) ?? []).length).toBe(2)
      expect(html.indexOf('Bravo')).toBeLessThan(html.indexOf('Charlie'))
   })

   it('falls back to the forced-break partition (no split) when no pagedLayout is supplied', () => {
      const html = generateExportHTML(meta, [section], { theme: 'light', accent: '#f97316', format: { kind: 'a4-portrait' } })
      // The whole list stays on one sheet as a single <ul>.
      expect((html.match(/class="doc-page"/g) ?? []).length).toBe(1)
      expect((html.match(/<ul>/g) ?? []).length).toBe(1)
   })
})

// A paragraph split across sheets in the paged layout is two shallow `p` blocks whose sliced richText
// holds only that page's char range; generateExportHTML renders each as its own <p>, in order across
// the two sheets (the transient paragraphFragment tag is render-only and never affects the markup).
describe('generateExportHTML, paged reflow (split paragraph)', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }
   const paragraph: Block = { id: 'P', type: 'p', richText: [{ text: 'Alpha bravo charlie delta echo foxtrot' }] }
   const section: Section = { id: 's', title: 'Prose', collapsed: false, blocks: [paragraph] }
   const fragment = (text: string, charStart: number, charEnd: number, isTail: boolean): Block =>
      ({ ...paragraph, richText: [{ text }], paragraphFragment: { charStart, charEnd, isTail } })

   it('renders a paragraph split across two sheets as two <p> fragments, one per sheet', () => {
      const pagedLayout: Page[] = [
         { id: 'page-first', slices: [{ section, blocks: [fragment('Alpha bravo charlie', 0, 19, false)], isSectionStart: true,  isSectionEnd: false }] },
         { id: 'auto:P:c0',  slices: [{ section, blocks: [fragment('delta echo foxtrot', 20, 38, true)],  isSectionStart: false, isSectionEnd: true  }] },
      ]
      const html = generateExportHTML(meta, [section], {
         theme: 'light', accent: '#f97316', format: { kind: 'a4-portrait' }, pagedLayout,
      })
      // Two physical sheets, and the paragraph split across them as two <p> fragments in order.
      expect((html.match(/class="doc-page"/g) ?? []).length).toBe(2)
      expect((html.match(/<p>/g) ?? []).length).toBe(2)
      expect(html).toContain('<p>Alpha bravo charlie</p>')
      expect(html).toContain('<p>delta echo foxtrot</p>')
      expect(html.indexOf('Alpha bravo charlie')).toBeLessThan(html.indexOf('delta echo foxtrot'))
   })
})

// The HTML export renders the freeform metadata fields around the title. These checks pin the
// per-field presentation rules that are not exercised by the serializer round-trips: color
// resolution and the showLabel value-only mode.

describe('generateExportHTML, metadata field presentation', () => {
   it('renders a hidden-label field as value-only (no label, no colon)', () => {
      const meta: DocMeta = {
         title: 'Doc',
         fields: [
            { id: 'a', label: 'Version', value: '1.2.0', position: 'below', showLabel: false },
            { id: 'b', label: 'Author',  value: 'Dana',  position: 'below' },
         ],
      }
      const html = generateExportHTML(meta, [], { theme: 'light', accent: '#f97316' })

      // The hidden-label field shows only its value, with no "Version:" label text.
      expect(html).toContain('<span class="page-meta-field">1.2.0</span>')
      expect(html).not.toContain('Version:')
      // A normal field still shows "label: value".
      expect(html).toContain('<span class="page-meta-field">Author: Dana</span>')
   })

   it('tints an accent-colored above field with the export accent value', () => {
      const meta: DocMeta = {
         title: 'Doc',
         fields: [{ id: 'a', label: 'Module', value: 'Billing', position: 'above', color: 'accent' }],
      }
      const html = generateExportHTML(meta, [], { theme: 'light', accent: '#123456' })
      expect(html).toContain('<span class="page-meta-field" style="color:#123456">Module: Billing</span>')
   })
})

// A LINKED graph bakes a STATIC svg at export: generateExportHTML builds the `handle -> table`
// catalog once from all sections and resolves each linked graph against it (falling back to the
// graph's materialized snapshot when the source is missing). The exported HTML carries no live link.
describe('generateExportHTML, linked graph resolution', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }

   /** A linked bar graph whose stored snapshot is deliberately stale (value 0) vs. the live table. */
   function linkedGraphBlock(handle: string): Block {
      const graph: GraphSpec = {
         type: 'bar',
         data: { labels: ['Stale'], series: [{ name: 'V', values: [0] }] },
         options: { title: 'Linked chart' },
         source: { handle },
      }
      return { id: 'graph', type: 'graph', graph }
   }

   function tableBlock(handle: string): Block {
      return {
         id: 'table', type: 'table', handle,
         richHeaders: [[], [{ text: 'V' }]],
         richRows: [
            [[{ text: 'A' }], [{ text: '11' }]],
            [[{ text: 'B' }], [{ text: '22' }]],
         ],
      }
   }

   it('resolves a linked graph to the referenced table data and bakes an SVG (no live link)', () => {
      const sections: Section[] = [{
         id: 's', title: 'Charts', collapsed: false,
         blocks: [tableBlock('src'), linkedGraphBlock('src')],
      }]
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      // The chart is baked as a self-contained SVG, and the accessible title is present.
      expect(html).toContain('<div class="doc-graph"><svg')
      expect(html).toContain('Linked chart')
      // The resolved (live table) category labels appear; the stale snapshot label does NOT.
      expect(html).toContain('<title>Linked chart</title>')
      expect(html).toContain('>A<')
      expect(html).toContain('>B<')
      expect(html).not.toContain('>Stale<')
      // No fence / source= token leaks into the exported HTML.
      expect(html).not.toContain('source=')
   })

   it('falls back to the materialized snapshot when the source table is missing (dangling)', () => {
      const sections: Section[] = [{
         id: 's', title: 'Charts', collapsed: false,
         blocks: [linkedGraphBlock('does-not-exist')],
      }]
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      // Still bakes a chart (never blank / throws), from the snapshot, so its label shows.
      expect(html).toContain('<div class="doc-graph"><svg')
      expect(html).toContain('>Stale<')
   })
})

// The background watermark is an additive, guarded emission: an absent watermark must leave the
// export byte-identical to pre-feature output (no markup AND no extra CSS), while a present one bakes
// a self-contained inline layer with the base64 image.
describe('generateExportHTML, background watermark', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }
   const sections: Section[] = [{ id: 's', title: 'Intro', collapsed: false, blocks: [] }]
   const watermark: Watermark = {
      src: 'data:image/png;base64,ABC123',
      opacity: 0.1, fit: 'contain', tile: false, position: 'center',
      rotation: 0, tileSize: 160, spacingX: 40, spacingY: 40, aspectRatio: 1,
      offsetX: 0, offsetY: 0,
   }

   it('is byte-identical whether presentation is absent or an empty extras object', () => {
      const absent = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      const empty  = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', presentation: {} })
      expect(empty).toBe(absent)
      // And neither emits any watermark markup or CSS.
      expect(absent).not.toContain('doc-watermark')
   })

   it('is byte-identical when the watermark has an empty src (treated as none)', () => {
      const absent = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      const blank  = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { watermark: { ...watermark, src: '' } },
      })
      expect(blank).toBe(absent)
   })

   it('emits a self-contained watermark layer + its CSS when a watermark is present', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316', presentation: { watermark },
      })
      // The layer div with the inlined base64 image, correct fit/position, and the light opacity.
      expect(html).toContain('class="doc-watermark"')
      // Single-quoted url() so the base64 data URL sits cleanly inside the double-quoted style
      // attribute (a double-quoted url() would close the attribute early and break the embed).
      expect(html).toContain('background-image:url(\'data:image/png;base64,ABC123\')')
      expect(html).toContain('style="background-image:url(\'data:image/png;base64,ABC123\')')
      expect(html).toContain('background-size:contain')
      expect(html).toContain('background-position:center center')
      expect(html).toContain('opacity:0.1')
      // The gated CSS is present too.
      expect(html).toContain('.doc-watermark {')
      expect(html).toContain('.doc-card > .doc-render { position: relative; z-index: 1; }')
   })

   it('dims the watermark opacity in the dark theme', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'dark', accent: '#f97316', presentation: { watermark },
      })
      // 0.1 * 0.8 dark-dim factor = 0.08.
      expect(html).toContain('opacity:0.08')
   })

   it('applies a centered CSS rotation to a single (non-tiled) watermark', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { watermark: { ...watermark, rotation: 25 } },
      })
      expect(html).toContain('transform:rotate(25deg)')
   })

   it('offset 0,0 is byte-identical to the pre-offset transform (rotation alone, no translate)', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { watermark: { ...watermark, rotation: 25, offsetX: 0, offsetY: 0 } },
      })
      // Scoped to the watermark div's own style attribute, the document also embeds Temml's CSS,
      // which legitimately uses `translate(...)` elsewhere, so a page-wide "not contain" would false-fail.
      const watermarkDivStart = html.indexOf('class="doc-watermark"')
      const watermarkDivChunk = html.slice(watermarkDivStart, watermarkDivStart + 400)
      expect(watermarkDivChunk).toContain('transform:rotate(25deg)"')
      expect(watermarkDivChunk).not.toContain('translate')
   })

   it('composes a non-zero offset with rotation into one transform, translate first', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { watermark: { ...watermark, rotation: 25, offsetX: 40, offsetY: -15 } },
      })
      expect(html).toContain('transform:translate(40px, -15px) rotate(25deg)')
   })

   it('renders a tiled watermark as an inline SVG <pattern> instead of a CSS background', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { watermark: { ...watermark, tile: true } },
      })
      // No more CSS background-repeat/size markup for the tiled case, it is an SVG pattern now.
      expect(html).not.toContain('background-repeat:repeat')
      expect(html).toContain('<svg class="doc-watermark"')
      expect(html).toContain('<pattern id=')
      expect(html).toContain('patternUnits="userSpaceOnUse"')
   })

   it('a tiled watermark with rotation + spacing emits the expected patternTransform and cell dimensions', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: {
            watermark: { ...watermark, tile: true, rotation: 40, tileSize: 100, spacingX: 20, spacingY: 20, aspectRatio: 1 },
         },
      })
      expect(html).toContain('patternTransform="rotate(40)"')
      // cellWidth/Height = tileSize (100) + spacing (20) = 120.
      expect(html).toContain('width="120" height="120"')
      expect(html).toContain('<image href="data:image/png;base64,ABC123" width="100" height="100" x="10" y="10"')
   })

   it('offset 0,0 leaves a tiled watermark\'s patternTransform byte-identical (rotation alone)', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { watermark: { ...watermark, tile: true, rotation: 40, offsetX: 0, offsetY: 0 } },
      })
      expect(html).toContain('patternTransform="rotate(40)"')
   })

   it('shifts a tiled watermark\'s pattern phase by composing the offset into patternTransform', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { watermark: { ...watermark, tile: true, rotation: 40, offsetX: 12, offsetY: -8 } },
      })
      expect(html).toContain('patternTransform="translate(12,-8) rotate(40)"')
   })
})

// The header logo is the same additive, guarded emission as the watermark: absent -> byte-identical
// (exactly the pre-feature `<h1>...</h1>`, no extra CSS); present -> a self-contained `<img>` inlined
// in .page-header, placed/aligned/capped per the model.
describe('generateExportHTML, header logo', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }
   const sections: Section[] = [{ id: 's', title: 'Intro', collapsed: false, blocks: [] }]
   const header: Header = {
      src: 'data:image/png;base64,LOGO123',
      placement: 'above', align: 'left', maxHeight: 64, logoSide: 'left',
   }

   it('is byte-identical whether presentation is absent or an empty extras object', () => {
      const absent = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      const empty  = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', presentation: {} })
      expect(empty).toBe(absent)
      expect(absent).toContain('<h1>Doc</h1>')
      expect(absent).not.toContain('page-logo')
   })

   it('is byte-identical when the header has an empty src (treated as none)', () => {
      const absent = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      const blank  = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { header: { ...header, src: '' } },
      })
      expect(blank).toBe(absent)
   })

   it('emits a self-contained logo <img> above the title, with the CSS gated on', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316', presentation: { header },
      })
      expect(html).toContain('<img class="page-logo" src="data:image/png;base64,LOGO123" alt="" style="max-height:64px">')
      // The row markup carries only the base class (not the "beside" modifier) for 'above' placement.
      expect(html).toContain('<div class="page-logo-row" style=')
      expect(html).not.toContain('<div class="page-logo-row page-logo-row-beside"')
      expect(html).toContain('justify-content:flex-start')
      // The logo row precedes the title, both inside .page-header.
      const rowIndex   = html.indexOf('page-logo-row')
      const titleIndex = html.indexOf('<h1>Doc</h1>')
      expect(rowIndex).toBeGreaterThan(-1)
      expect(rowIndex).toBeLessThan(titleIndex)
      // The gated CSS is present too.
      expect(html).toContain('.doc-render .page-logo-row')
      expect(html).toContain('.doc-render .page-logo ')
   })

   it('wraps the logo and title together for "beside" placement', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { header: { ...header, placement: 'beside', align: 'right' } },
      })
      expect(html).toContain('class="page-logo-row page-logo-row-beside"')
      expect(html).toContain('justify-content:flex-end')
      // Logo and <h1> ride inside the SAME wrapper div for "beside".
      const wrapperStart = html.indexOf('<div class="page-logo-row page-logo-row-beside"')
      const wrapperChunk = html.slice(wrapperStart, wrapperStart + 400)
      expect(wrapperChunk).toContain('<img class="page-logo"')
      expect(wrapperChunk).toContain('<h1>Doc</h1>')
   })

   it('centers via justify-content:center', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { header: { ...header, align: 'center' } },
      })
      expect(html).toContain('justify-content:center')
   })

   it('logoSide "right" pins the logo opposite the title (space-between), ignoring align', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { header: { ...header, placement: 'beside', align: 'right', logoSide: 'right' } },
      })
      expect(html).toContain('class="page-logo-row page-logo-row-beside"')
      expect(html).toContain('justify-content:space-between')
      // Title now comes BEFORE the logo in the DOM (title on the left, logo pinned to the right).
      const wrapperStart = html.indexOf('<div class="page-logo-row page-logo-row-beside"')
      const wrapperChunk = html.slice(wrapperStart, wrapperStart + 400)
      const titleIndexInWrapper = wrapperChunk.indexOf('<h1>Doc</h1>')
      const logoIndexInWrapper  = wrapperChunk.indexOf('<img class="page-logo"')
      expect(titleIndexInWrapper).toBeGreaterThan(-1)
      expect(logoIndexInWrapper).toBeGreaterThan(-1)
      expect(titleIndexInWrapper).toBeLessThan(logoIndexInWrapper)
   })

   it('logoSide "left" (default) is byte-identical to the pre-logoSide beside rendering', () => {
      // A round trip proving the new field is purely additive: default logoSide reproduces exactly
      // the same markup/order as before the feature (logo first, positioned via align).
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { header: { ...header, placement: 'beside', align: 'right', logoSide: 'left' } },
      })
      const wrapperStart = html.indexOf('<div class="page-logo-row page-logo-row-beside"')
      const wrapperChunk = html.slice(wrapperStart, wrapperStart + 400)
      expect(html).toContain('justify-content:flex-end')   // align:'right' still governs
      expect(wrapperChunk.indexOf('<img class="page-logo"')).toBeLessThan(wrapperChunk.indexOf('<h1>Doc</h1>'))
   })

   it('applies a custom maxHeight to the <img> style', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { header: { ...header, maxHeight: 120 } },
      })
      expect(html).toContain('style="max-height:120px"')
   })

   it('watermark and header coexist without interfering', () => {
      const watermark: Watermark = {
         src: 'data:image/png;base64,WM', opacity: 0.1, fit: 'contain', tile: false, position: 'center',
         rotation: 0, tileSize: 160, spacingX: 40, spacingY: 40, aspectRatio: 1,
         offsetX: 0, offsetY: 0,
      }
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316', presentation: { watermark, header },
      })
      expect(html).toContain('class="doc-watermark"')
      expect(html).toContain('class="page-logo-row"')
   })
})

// The exported sidebar nav is built from reconcileNav(presentation.nav, sections). An ABSENT nav must
// stay byte-identical to the previous `sections.map(...)` derivation (same numbered links + the
// original, unguarded scroll-spy click handler + no extra nav CSS); a customized nav emits reordered /
// renamed / hidden section links, external links (target=_blank rel=noopener), and dividers, and swaps
// in the `#`-guarded click handler so external links navigate normally.

describe('generateExportHTML, sidebar nav', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }
   const sections: Section[] = [
      { id: 'a', title: 'Intro',   collapsed: false, blocks: [] },
      { id: 'b', title: 'Details', collapsed: false, blocks: [] },
   ]

   it('is byte-identical whether nav is absent, an empty extras object, or nav: undefined', () => {
      const absent   = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      const empty    = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', presentation: {} })
      const navUndef = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', presentation: { nav: undefined } })
      expect(empty).toBe(absent)
      expect(navUndef).toBe(absent)
      // The current numbered section links, in section order.
      expect(absent).toContain('<a href="#section-a" class="nav-link">1. Intro</a>')
      expect(absent).toContain('<a href="#section-b" class="nav-link">2. Details</a>')
      // The ORIGINAL (unguarded) scroll-spy click handler, and none of the nav-customization CSS.
      expect(absent).toContain("const t = document.querySelector(l.getAttribute('href'));")
      expect(absent).not.toContain("href.charAt(0)")
      expect(absent).not.toContain('.nav-divider')
      expect(absent).not.toContain('.nav-external')
   })

   it('reorders and renames section links from a custom nav model', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { nav: { entries: [
            { kind: 'auto', sectionId: 'b', label: 'The details' },
            { kind: 'auto', sectionId: 'a' },
         ] } },
      })
      // 'b' now comes first and is renumbered 1 with its override label; 'a' is 2.
      expect(html).toContain('<a href="#section-b" class="nav-link">1. The details</a>')
      expect(html).toContain('<a href="#section-a" class="nav-link">2. Intro</a>')
      const bIndex = html.indexOf('#section-b')
      const aIndex = html.indexOf('#section-a" class="nav-link')
      expect(bIndex).toBeLessThan(aIndex)
   })

   it('omits a hidden section from the sidebar but still renders its body section', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { nav: { entries: [
            { kind: 'auto', sectionId: 'a', hidden: true },
            { kind: 'auto', sectionId: 'b' },
         ] } },
      })
      // Sidebar: no link to 'a', and 'b' is renumbered 1 (only visible section link counted).
      expect(html).not.toContain('<a href="#section-a"')
      expect(html).toContain('<a href="#section-b" class="nav-link">1. Details</a>')
      // Body: the hidden section's own .doc-section still renders.
      expect(html).toContain('<div class="doc-section" id="section-a">')
   })

   it('emits an external link with target=_blank rel=noopener and the guarded click handler', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { nav: { entries: [
            { kind: 'auto', sectionId: 'a' },
            { kind: 'custom', id: 'x', label: 'Docs', target: { type: 'url', href: 'https://example.com/docs' } },
         ] } },
      })
      expect(html).toContain('<a href="https://example.com/docs" class="nav-link nav-external" target="_blank" rel="noopener">Docs</a>')
      // External links are unnumbered; the section link keeps number 1.
      expect(html).toContain('<a href="#section-a" class="nav-link">1. Intro</a>')
      // The guarded click handler is swapped in so the external link navigates normally.
      expect(html).toContain("href.charAt(0) !== '#'")
      // The gated nav CSS is present for a customized nav.
      expect(html).toContain('.nav-external')
   })

   it('renders a divider (with caption) as a static separator, unnumbered', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { nav: { entries: [
            { kind: 'auto', sectionId: 'a' },
            { kind: 'divider', id: 'd', label: 'More' },
            { kind: 'auto', sectionId: 'b' },
         ] } },
      })
      expect(html).toContain('<div class="nav-divider">More</div>')
      // Section links either side keep sequential numbering across the divider.
      expect(html).toContain('<a href="#section-a" class="nav-link">1. Intro</a>')
      expect(html).toContain('<a href="#section-b" class="nav-link">2. Details</a>')
      expect(html).toContain('.nav-divider')
   })

   it('appends a section absent from a stored nav (new section auto-appears)', () => {
      // The stored nav only knows about 'a'; 'b' is a section added later, it must appear at the tail.
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { nav: { entries: [{ kind: 'auto', sectionId: 'a' }] } },
      })
      expect(html).toContain('<a href="#section-a" class="nav-link">1. Intro</a>')
      expect(html).toContain('<a href="#section-b" class="nav-link">2. Details</a>')
   })

   it('drops an auto entry whose section was deleted', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         presentation: { nav: { entries: [
            { kind: 'auto', sectionId: 'gone' },
            { kind: 'auto', sectionId: 'a' },
            { kind: 'auto', sectionId: 'b' },
         ] } },
      })
      expect(html).not.toContain('#section-gone')
      expect(html).toContain('<a href="#section-a" class="nav-link">1. Intro</a>')
      expect(html).toContain('<a href="#section-b" class="nav-link">2. Details</a>')
   })
})

// The infinite-width preset applied to `.doc-card`'s max-width. The central guarantee is that an
// absent format, a bare `{ kind: 'infinite' }`, and an explicit `width: 'normal'` all produce
// BYTE-IDENTICAL export output to before this feature existed.
describe('generateExportHTML, document format / infinite width', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }
   const sections: Section[] = []

   it('is byte-identical whether format is absent, bare infinite, or explicit normal width', () => {
      const absent      = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      const bareInfinite = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'infinite' } })
      const explicitNormal = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'infinite', width: 'normal' } })
      expect(bareInfinite).toBe(absent)
      expect(explicitNormal).toBe(absent)
      expect(absent).toContain('max-width: 860px;')
   })

   it('applies a narrow / wide infinite width to .doc-card', () => {
      const narrow = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'infinite', width: 'narrow' } })
      const wide   = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'infinite', width: 'wide' } })
      expect(narrow).toContain('max-width: 640px;')
      expect(wide).toContain('max-width: 1080px;')
   })

   it('applies a clamped custom infinite width', () => {
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'infinite', width: { custom: 950 } } })
      expect(html).toContain('max-width: 950px;')
      const clamped = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'infinite', width: { custom: 99999 } } })
      expect(clamped).toContain('max-width: 1600px;')
   })

   it('still emits the normal 860px .doc-card rule for a paged kind (unused; the paged branch renders .doc-page sheets)', () => {
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'a4-portrait', width: 'wide' } })
      expect(html).toContain('max-width: 860px;')
   })
})

// The paged-A4 export branch. A paged format emits an `@page` rule plus a stack of A4 `.doc-page`
// sheets with page-break rules for correct browser print-to-PDF; an infinite / absent format takes
// NONE of this and stays byte-identical to the single-.doc-card output.
describe('generateExportHTML, paged (A4) export', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }
   const sections: Section[] = [{
      id: 's', title: 'Intro', collapsed: false,
      blocks: [{ id: 'b1', type: 'hr' }, { id: 'b2', type: 'hr' }],
   }]

   it('emits an @page rule (portrait, zero page margin), .doc-page sheets, padding margins, and print break rules', () => {
      const html = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316', format: { kind: 'a4-portrait' } })
      expect(html).toContain('@page { size: A4 portrait; margin: 0; }')
      // Default 20mm margins live as sheet padding now, not on @page.
      expect(html).toContain(`padding: ${millimetresToPx(20)}px ${millimetresToPx(20)}px ${millimetresToPx(20)}px ${millimetresToPx(20)}px`)
      expect(html).toContain('print-color-adjust: exact')
      expect(html).toContain('<div class="doc-pages">')
      expect(html).toContain('class="doc-page"')
      // Full-height sheets paginate naturally; a forced page-break-after would emit a blank page after
      // every sheet, so it must be absent.
      expect(html).toContain('height: 100vh')
      expect(html).not.toContain('page-break-after: always')
      expect(html).toContain('page-break-inside: avoid')
      // The infinite single-card path is NOT used.
      expect(html).not.toContain('<div class="doc-card">')
   })

   it('uses landscape orientation, with margins owned by the sheet padding (not @page)', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         format: { kind: 'a4-landscape', margins: { top: 10, right: 15, bottom: 12, left: 15 } },
      })
      // @page carries only the physical size; browsers honor @page margins poorly, so the margin band
      // is real .doc-render padding (CSS px at 96dpi) instead.
      expect(html).toContain('@page { size: A4 landscape; margin: 0; }')
      expect(html).toContain(`padding: ${millimetresToPx(10)}px ${millimetresToPx(15)}px ${millimetresToPx(12)}px ${millimetresToPx(15)}px`)
   })

   it('splits at a break marker into discrete pages, section heading only on the section-start slice', () => {
      const html = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         format: { kind: 'a4-portrait', pages: [{ id: 'brk', after: { sectionId: 's', blockId: 'b1' } }] },
      })
      // Two sheets; the break puts b2 on page 2.
      expect((html.match(/class="doc-page"/g) || []).length).toBe(2)
      // The section title renders once (on the starting slice), not again on the continuation page.
      expect((html.match(/1\. Intro<\/h2>/g) || []).length).toBe(1)
   })

   it('leaves an infinite / absent format byte-identical (no @page, no .doc-page)', () => {
      const infinite = generateExportHTML(meta, sections, { theme: 'light', accent: '#f97316' })
      expect(infinite).not.toContain('@page')
      expect(infinite).not.toContain('class="doc-page"')
      expect(infinite).toContain('<div class="doc-card">')
   })

   // Regression: the sheet stack's printed height used to be left to the browser's summed-child
   // layout, which could drift a hair short of a whole page count and leave an un-themed sliver of
   // paper canvas below the last sheet. The stack now declares its own height as an exact page-count
   // multiple of a floored sheet height, themed with the sheet background. The multiplier is
   // max(100vh, sheetHeightPx), not plain 100vh: an iframe print can resolve 100vh shorter than a real
   // A4 sheet, and an N*100vh stack would then clip its min-height-floored children.
   it('pins the sheet stack print height to an exact page-count multiple of the sheet height, themed with the sheet background', () => {
      const singlePage = generateExportHTML(meta, sections, { theme: 'dark', accent: '#f97316', format: { kind: 'a4-portrait' } })
      // The stack's own print rule carries both the exact height (one sheet) and the dark theme's
      // sheet colour together, so nothing un-themed can show through below the last sheet.
      expect(singlePage).toContain('height: calc(1 * max(100vh, 1122.51px)); overflow: hidden;')
      expect(singlePage).toContain('background: #161b22; -webkit-print-color-adjust: exact; print-color-adjust: exact;\n                  }')

      const twoPages = generateExportHTML(meta, sections, {
         theme: 'light', accent: '#f97316',
         format: { kind: 'a4-portrait', pages: [{ id: 'brk', after: { sectionId: 's', blockId: 'b1' } }] },
      })
      expect(twoPages).toContain('height: calc(2 * max(100vh, 1122.51px)); overflow: hidden;')
   })

   // Each printed SHEET must own the document sheet colour outright: the last page can be short (its
   // content ends well above the fold), and its blank tail has to print in the document background, not
   // the un-themed paper canvas. The print `.doc-page` rule sets `background` explicitly. It KEEPS the
   // base A4 px `min-height` floor (does NOT reset it), because that floor is what pins each sheet to a
   // whole physical page when the print engine's "100vh" resolves a hair short; dropping it let sheets
   // shrink below a page and flow continuously into one another.
   it('themes the print sheet and keeps the A4 min-height floor so sheets stay page-aligned', () => {
      const html = generateExportHTML(meta, sections, { theme: 'dark', accent: '#f97316', format: { kind: 'a4-portrait' } })
      // The print .doc-page override: full-page height, the sheet colour, and NO min-height reset. The
      // `box-shadow: none` opener is unique to the print override, so it never matches the base rule.
      expect(html).toContain('height: 100vh; min-height: 1122.51px; margin: 0; overflow: hidden;')
      expect(html).not.toMatch(/\.doc-page \{[^}]*min-height: 0;/)
      expect(html).toMatch(/\.doc-page \{\s*box-shadow: none; border-radius: 0; width: 100%; height: 100vh; min-height: 1122.51px; margin: 0; overflow: hidden;\s*background: #161b22; -webkit-print-color-adjust: exact; print-color-adjust: exact;/)
   })
})
