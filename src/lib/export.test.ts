import { describe, it, expect } from 'vitest'
import { generateExportHTML } from './export'
import type { DocMeta, Block, Section } from '../types'
import type { GraphSpec } from './graph'

// The HTML export renders the freeform metadata fields around the title. These checks pin the
// per-field presentation rules that are not exercised by the serializer round-trips: color
// resolution and the showLabel value-only mode.

describe('generateExportHTML — metadata field presentation', () => {
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
describe('generateExportHTML — linked graph resolution', () => {
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
      // Still bakes a chart (never blank / throws) — from the snapshot, so its label shows.
      expect(html).toContain('<div class="doc-graph"><svg')
      expect(html).toContain('>Stale<')
   })
})
