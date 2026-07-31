import { describe, it, expect } from 'vitest'
import { generateExportHTML } from './export'
import type { DocMeta } from '../types'

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
