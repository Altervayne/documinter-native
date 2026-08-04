import { describe, it, expect } from 'vitest'

import { serializeTemplate, parseTemplateBackup } from './templateBackupFile'
import { captureTemplate } from './documentTemplate'
import type { DocumentTemplate } from './documentTemplate'
import type { DocFormat } from './format'

function template(extra: Partial<DocumentTemplate> = {}): DocumentTemplate {
   return {
      id:        'stored-1',
      name:      'Spec sheet',
      createdAt: 100,
      updatedAt: 200,
      docTheme:  'dark',
      docAccent: '#abc',
      meta: {
         title: '',
         fields: [
            { id: 'f1', label: 'Module', value: '', position: 'above', color: 'accent' },
            { id: 'f2', label: 'Author', value: '', position: 'below' },
         ],
      },
      ...extra,
   }
}

describe('serializeTemplate / parseTemplateBackup', () => {
   it('round-trips a template name + chrome (dropping id / timestamps / builtIn)', () => {
      const parsed = parseTemplateBackup(serializeTemplate(template()))
      expect(parsed).not.toBeNull()
      expect(parsed!.name).toBe('Spec sheet')
      expect(parsed!.chrome.docTheme).toBe('dark')
      expect(parsed!.chrome.docAccent).toBe('#abc')
      expect(parsed!.chrome.meta.fields.map(field => field.label)).toEqual(['Module', 'Author'])
   })

   it('does not write id / timestamps / builtIn into the file', () => {
      const serialized = serializeTemplate(template({ builtIn: true }))
      const raw = JSON.parse(serialized)
      expect(raw.documinterTemplate).toBe(true)
      expect(raw.id).toBeUndefined()
      expect(raw.createdAt).toBeUndefined()
      expect(raw.updatedAt).toBeUndefined()
      expect(raw.builtIn).toBeUndefined()
   })

   it('carries a paged format through the round-trip', () => {
      const format: DocFormat = { kind: 'a4-portrait', margins: { top: 10, right: 10, bottom: 10, left: 10 } }
      const parsed = parseTemplateBackup(serializeTemplate(template({ format })))
      expect(parsed!.chrome.format?.kind).toBe('a4-portrait')
      expect(parsed!.chrome.format?.margins).toEqual({ top: 10, right: 10, bottom: 10, left: 10 })
   })

   it('an imported chrome re-captures into a fresh stored template (new id + timestamps)', () => {
      const parsed = parseTemplateBackup(serializeTemplate(template()))!
      const imported = captureTemplate(parsed.name, parsed.chrome, 'fresh-id', 999)
      expect(imported.id).toBe('fresh-id')
      expect(imported.createdAt).toBe(999)
      expect(imported.builtIn).toBeUndefined()
      expect(imported.name).toBe('Spec sheet')
   })

   it('rejects non-template JSON (a document backup, or arbitrary object)', () => {
      expect(parseTemplateBackup(JSON.stringify({ meta: { title: 'x', fields: [] }, sections: [] }))).toBeNull()
      expect(parseTemplateBackup(JSON.stringify({ documinterTemplate: true }))).toBeNull()
      expect(parseTemplateBackup('not json')).toBeNull()
   })

   it('falls back to a default name when the file has none', () => {
      const serialized = serializeTemplate(template())
      const withoutName = JSON.stringify({ ...JSON.parse(serialized), name: '   ' })
      expect(parseTemplateBackup(withoutName)!.name).toBe('Imported template')
   })
})
