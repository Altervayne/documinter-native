import { describe, it, expect } from 'vitest'

import { isEmptyDocument } from './document'
import type { DocMeta, Section } from '../types'

function doc(meta: Partial<DocMeta>, sections: Section[]) {
   return { meta: { title: '', fields: [], ...meta }, sections }
}
function section(blocks: Section['blocks'] = []): Section {
   return { id: 's', title: 'S', collapsed: false, blocks }
}

describe('isEmptyDocument', () => {
   it('true for a fresh blank doc (no title, no fields, one empty section)', () => {
      expect(isEmptyDocument(doc({}, [section()]))).toBe(true)
   })

   it('true for a template-created doc (meta scaffold with BLANK values, no blocks, no title)', () => {
      const meta = { title: '', fields: [
         { id: 'f1', label: 'Module', value: '', position: 'above' as const },
         { id: 'f2', label: 'Author', value: '', position: 'below' as const },
      ] }
      expect(isEmptyDocument(doc(meta, [section()]))).toBe(true)
   })

   it('false when any section has a block', () => {
      expect(isEmptyDocument(doc({}, [section([{ id: 'b', type: 'p' }])]))).toBe(false)
   })

   it('false when the title is set', () => {
      expect(isEmptyDocument(doc({ title: 'My spec' }, [section()]))).toBe(false)
   })

   it('false when a meta field has a filled-in value', () => {
      const meta = { title: '', fields: [{ id: 'f1', label: 'Author', value: 'Dana', position: 'below' as const }] }
      expect(isEmptyDocument(doc(meta, [section()]))).toBe(false)
   })

   it('treats whitespace-only title / field value as empty', () => {
      const meta = { title: '   ', fields: [{ id: 'f1', label: 'Author', value: '  ', position: 'below' as const }] }
      expect(isEmptyDocument(doc(meta, [section()]))).toBe(true)
   })
})
