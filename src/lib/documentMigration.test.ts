// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { migrateIds, migrateMeta } from './documentMigration'
import { normalizeIds } from '../test/normalizeIds'
import type { DocState } from '../types'

// migrateIds upgrades historical document shapes: numeric ids → strings, legacy string fields →
// richText (via parseInlineContent, hence jsdom), and legacy list-item formats → ListItem trees.

describe('migrateIds', () => {
   // A legacy-shaped document: numeric ids, an HTML-string paragraph, and a list whose items are a
   // bare string plus an id-less object with string children. Cast through unknown since these
   // shapes predate the current types.
   const legacyState = {
      meta: { module: 'M', title: 'T', author: 'A', date: '2026-01-01', env: 'E' },
      sections: [{
         id: 1,
         title: 'Legacy Section',
         collapsed: false,
         blocks: [
            { id: 10, type: 'p', text: '<strong>Bold</strong> plain' },
            {
               id: 11, type: 'list',
               items: [
                  'first',
                  { text: 'second', children: ['child a', 'child b'] },
               ],
            },
         ],
      }],
   }

   it('coerces numeric section and block ids to strings', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      expect(migrated.sections[0].id).toBe('1')
      expect(migrated.sections[0].blocks[0].id).toBe('10')
      expect(migrated.sections[0].blocks[1].id).toBe('11')
   })

   it('populates richText from a legacy HTML-string block and drops the legacy field', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      const paragraph = migrated.sections[0].blocks[0]
      expect(paragraph.richText).toEqual([{ text: 'Bold', bold: true }, { text: ' plain' }])
      expect('text' in paragraph).toBe(false)
   })

   it('normalizes legacy string items and recursive string children into a ListItem tree', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      // Structure (ids blanked): the bare string and the id-less object both become full items.
      expect(normalizeIds(migrated).sections[0].blocks[1].items).toEqual([
         { id: '', richText: [{ text: 'first' }], children: [] },
         {
            id: '', richText: [{ text: 'second' }], children: [
               { id: '', richText: [{ text: 'child a' }], children: [] },
               { id: '', richText: [{ text: 'child b' }], children: [] },
            ],
         },
      ])
   })

   it('assigns non-empty ids to list items that lacked them', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      const items = migrated.sections[0].blocks[1].items!
      expect(items[0].id.length).toBeGreaterThan(0)               // from the bare string 'first'
      expect(items[1].id.length).toBeGreaterThan(0)               // from the id-less object
      expect(items[1].children[0].id.length).toBeGreaterThan(0)   // from the string child
   })

   it('migrates the legacy flat meta to the freeform { title, fields } shape', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      expect(migrated.meta.title).toBe('T')
      expect(migrated.meta.fields.map(field => [field.label, field.value])).toEqual([
         ['Module', 'M'],
         ['Environment', 'E'],
         ['Date', '2026-01-01'],
         ['Author', 'A'],
      ])
   })

   it('reproduces the old layout: module goes above the title in the accent color', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      const moduleField = migrated.meta.fields.find(field => field.label === 'Module')
      expect(moduleField).toMatchObject({ position: 'above', color: 'accent' })
      // The remaining fixed fields sit below the title in the default (undefined) color.
      for (const label of ['Environment', 'Date', 'Author']) {
         const field = migrated.meta.fields.find(entry => entry.label === label)
         expect(field?.position).toBe('below')
         expect(field?.color).toBeUndefined()
      }
   })
})

describe('migrateMeta', () => {
   it('maps legacy flat metadata to ordered fields, dropping empty values', () => {
      const meta = migrateMeta({ title: 'Doc', module: 'Billing', env: '', date: '2026-01-01', author: 'Dana' })
      expect(meta.title).toBe('Doc')
      expect(meta.fields.map(field => [field.label, field.value])).toEqual([
         ['Module', 'Billing'],
         ['Date', '2026-01-01'],
         ['Author', 'Dana'],
      ])
      // Every migrated field carries a fresh non-empty id.
      expect(meta.fields.every(field => field.id.length > 0)).toBe(true)
   })

   it('places the legacy module above in accent, the rest below with no color', () => {
      const meta = migrateMeta({ title: 'Doc', module: 'Billing', env: 'Prod', date: '2026-01-01', author: 'Dana' })
      expect(meta.fields.find(field => field.label === 'Module')).toMatchObject({ position: 'above', color: 'accent' })
      expect(meta.fields.find(field => field.label === 'Environment')).toMatchObject({ position: 'below' })
      expect(meta.fields.find(field => field.label === 'Date')?.color).toBeUndefined()
   })

   it('is idempotent: an already-freeform meta is returned normalized', () => {
      const already = { title: 'Doc', fields: [{ id: 'x', label: 'Ref', value: '42', position: 'below' as const }] }
      expect(migrateMeta(already)).toEqual(already)
   })

   it('backfills position (below) and passes through color for pre-zone freeform fields', () => {
      const meta = migrateMeta({ title: 'Doc', fields: [
         { id: 'a', label: 'Ref', value: '42' },                          // pre-zone: no position
         { id: 'b', label: 'Tag', value: 'x', position: 'above', color: 'accent' },
      ] })
      expect(meta.fields[0]).toEqual({ id: 'a', label: 'Ref', value: '42', position: 'below' })
      expect(meta.fields[1]).toEqual({ id: 'b', label: 'Tag', value: 'x', position: 'above', color: 'accent' })
   })

   it('mints an id for a freeform field that lacks one', () => {
      const meta = migrateMeta({ title: 'Doc', fields: [{ label: 'Ref', value: '42' }] })
      expect(meta.fields[0].id.length).toBeGreaterThan(0)
      expect(meta.fields[0].label).toBe('Ref')
   })

   it('tolerates a missing / malformed meta', () => {
      expect(migrateMeta(undefined)).toEqual({ title: '', fields: [] })
   })
})

// The standalone `image-markup` block type was removed: any persisted such block must load as an
// `image` block carrying a markup overlay, with the base64 src / alt / caption re-homed onto the
// block and only the viewBox dims + element stack left on the overlay.
describe('migrateIds, legacy image-markup block → image block with overlay', () => {
   const legacyState = {
      meta: { title: 'T', fields: [] },
      sections: [{
         id: 's', title: 'Screens', collapsed: false,
         blocks: [{
            id: 'm1', type: 'image-markup', handle: 'shot',
            imageMarkup: {
               src: 'data:image/webp;base64,PIXELS', width: 800, height: 600,
               alt: 'Login', caption: 'Fig 1',
               elements: [{ id: 'a', kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
            },
         }],
      }],
   }

   it('converts the block type to image and re-homes src/alt/caption onto the block', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      const block = migrated.sections[0].blocks[0]
      expect(block.type).toBe('image')
      expect(block.src).toBe('data:image/webp;base64,PIXELS')
      expect(block.alt).toBe('Login')
      expect(block.caption).toBe('Fig 1')
      expect(block.handle).toBe('shot')
   })

   it('keeps only the viewBox dims + element stack on the overlay', () => {
      const migrated = migrateIds(legacyState as unknown as DocState)
      const overlay = migrated.sections[0].blocks[0].imageMarkup
      expect(overlay).toEqual({
         width: 800, height: 600,
         elements: [{ id: 'a', kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      })
      // No src/alt/caption linger on the overlay sub-object.
      expect(overlay && 'src' in overlay).toBe(false)
   })
})
