import { describe, it, expect } from 'vitest'

import { captureTemplate, instantiateTemplate, BUILT_IN_TEMPLATES } from './documentTemplate'
import type { TemplateChrome } from './documentTemplate'
import type { DocMeta } from '../types'
import type { DocFormat } from './format'

// A deterministic field-id factory for tests: field-0, field-1, ...
function makeIdFactory() {
   let count = 0
   return () => `field-${count++}`
}

const sourceMeta: DocMeta = {
   title: 'My Doc',
   fields: [
      { id: 'f1', label: 'Module', value: 'Billing', position: 'above', color: 'accent' },
      { id: 'f2', label: 'Author', value: 'Dana',    position: 'below', showLabel: false },
   ],
}

function chrome(extra: Partial<TemplateChrome> = {}): TemplateChrome {
   return { meta: sourceMeta, docTheme: 'light', docAccent: '#abc', ...extra }
}

describe('captureTemplate', () => {
   it('blanks meta values but keeps each field label / position / color / showLabel, and blanks the title', () => {
      const template = captureTemplate('T', chrome(), 'id1', 1000)
      expect(template.meta.title).toBe('')
      expect(template.meta.fields).toEqual([
         { id: 'f1', label: 'Module', value: '', position: 'above', color: 'accent' },
         { id: 'f2', label: 'Author', value: '', position: 'below', showLabel: false },
      ])
      expect(template.docTheme).toBe('light')
      expect(template.docAccent).toBe('#abc')
      expect(template.createdAt).toBe(1000)
      expect(template.updatedAt).toBe(1000)
   })

   it('drops a default (infinite) format', () => {
      const template = captureTemplate('T', chrome({ format: { kind: 'infinite' } }), 'id', 0)
      expect(template.format).toBeUndefined()
   })

   it('keeps a paged format (kind + margins) but carries no page breaks', () => {
      const format: DocFormat = {
         kind: 'a4-portrait',
         margins: { top: 10, right: 10, bottom: 10, left: 10 },
         pages: [{ id: 'brk', after: { sectionId: 's', blockId: 'x' } }],
      }
      const template = captureTemplate('T', chrome({ format }), 'id', 0)
      expect(template.format?.kind).toBe('a4-portrait')
      expect(template.format?.margins).toEqual({ top: 10, right: 10, bottom: 10, left: 10 })
      expect(template.format?.pages?.length ?? 0).toBe(0)
   })

   it('drops an empty presentation (normalized away)', () => {
      const template = captureTemplate('T', chrome({ presentation: {} }), 'id', 0)
      expect(template.presentation).toBeUndefined()
   })

   it('keeps the header / footer bands configured on the format (including a header logo)', () => {
      const format: DocFormat = {
         kind: 'a4-portrait',
         header: { left: { kind: 'content', text: 'Acme', image: { src: 'data:image/png;base64,AAAA', width: 40, height: 20 } } },
         footer: { right: { kind: 'pageNumber', style: 'plain' } },
      }
      const template = captureTemplate('T', chrome({ format }), 'id', 0)
      expect(template.format?.header).toEqual({ left: { kind: 'content', text: 'Acme', image: { src: 'data:image/png;base64,AAAA', width: 40, height: 20 } } })
      expect(template.format?.footer).toEqual({ right: { kind: 'pageNumber', style: 'plain' } })
   })
})

describe('instantiateTemplate', () => {
   it('regenerates fresh field ids and keeps the blank values', () => {
      const template = captureTemplate('T', chrome({ docTheme: 'dark', docAccent: '#xyz' }), 'id', 0)
      const seed = instantiateTemplate(template, makeIdFactory())
      expect(seed.meta.fields.map(field => field.id)).toEqual(['field-0', 'field-1'])
      expect(seed.meta.fields.map(field => field.value)).toEqual(['', ''])
      expect(seed.meta.fields.map(field => field.label)).toEqual(['Module', 'Author'])
      expect(seed.docTheme).toBe('dark')
      expect(seed.docAccent).toBe('#xyz')
   })

   it('deep-clones the format so a later edit does not alias the template', () => {
      const format: DocFormat = { kind: 'a4-landscape', margins: { top: 5, right: 5, bottom: 5, left: 5 } }
      const template = captureTemplate('T', chrome({ format }), 'id', 0)
      const seed = instantiateTemplate(template, makeIdFactory())
      expect(seed.format).toEqual({ kind: 'a4-landscape', margins: { top: 5, right: 5, bottom: 5, left: 5 } })
      expect(seed.format).not.toBe(template.format)
      // Nested objects must be cloned too, else editing the new document mutates the stored template.
      expect(seed.format?.margins).not.toBe(template.format?.margins)
   })

   it('deep-clones the header / footer bands and the header logo (no shared references)', () => {
      const format: DocFormat = {
         kind: 'a4-portrait',
         header: { left: { kind: 'content', text: 'Acme', image: { src: 'data:image/png;base64,AAAA', width: 40, height: 20 } } },
         footer: { right: { kind: 'pageNumber', style: 'plain' } },
      }
      const template = captureTemplate('T', chrome({ format }), 'id', 0)
      const seed = instantiateTemplate(template, makeIdFactory())
      expect(seed.format?.header).toEqual(template.format?.header)
      expect(seed.format?.footer).toEqual(template.format?.footer)
      expect(seed.format?.header).not.toBe(template.format?.header)
      expect(seed.format?.footer).not.toBe(template.format?.footer)
      expect(seed.format?.header?.left).not.toBe(template.format?.header?.left)
      // The base64 logo is the heaviest shared payload a shallow copy would leak; it must be its own object.
      const seedImage     = seed.format?.header?.left
      const templateImage = template.format?.header?.left
      const seedLogo     = seedImage?.kind === 'content' ? seedImage.image : undefined
      const templateLogo = templateImage?.kind === 'content' ? templateImage.image : undefined
      expect(seedLogo).toBeDefined()
      expect(seedLogo).not.toBe(templateLogo)
   })
})

describe('BUILT_IN_TEMPLATES', () => {
   it('ships one built-in: the classic default layout (Module above, Environment/Date/Author below)', () => {
      expect(BUILT_IN_TEMPLATES).toHaveLength(1)
      const template = BUILT_IN_TEMPLATES[0]
      expect(template.builtIn).toBe(true)
      expect(template.format).toBeUndefined()   // infinite canvas, no pages
      const above = template.meta.fields.filter(field => field.position === 'above')
      const below = template.meta.fields.filter(field => field.position === 'below')
      expect(above.map(field => field.label)).toEqual(['Module'])
      expect(above[0].color).toBe('accent')
      expect(below.map(field => field.label)).toEqual(['Environment', 'Date', 'Author'])
      expect(template.meta.fields.every(field => field.value === '')).toBe(true)
   })

   it('instantiates to fresh field ids (the built-in ids are placeholders)', () => {
      const seed = instantiateTemplate(BUILT_IN_TEMPLATES[0], makeIdFactory())
      expect(seed.meta.fields.map(field => field.id)).toEqual(['field-0', 'field-1', 'field-2', 'field-3'])
   })
})
