// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { migrateIds } from './documentMigration'
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
})
