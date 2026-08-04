import { describe, it, expect } from 'vitest'

import { relocateBlock } from './document'
import type { BlockLoc } from './document'
import type { Block, Section } from '../types'

// Minimal block/section fixtures (only id/type matter for relocation).
function block(id: string, extra: Partial<Block> = {}): Block {
   return { id, type: 'p', ...extra }
}
function section(id: string, blocks: Block[]): Section {
   return { id, title: id, collapsed: false, blocks }
}

const SEC = (id: string): BlockLoc => ({ kind: 'section', sectionId: id })
const COL = (sectionId: string, blockId: string, side: 'left' | 'right'): BlockLoc =>
   ({ kind: 'column', sectionId, blockId, side })

function ids(blocks: Block[]): string[] { return blocks.map(b => b.id) }

describe('relocateBlock — within a section body', () => {
   const sections = [section('s1', [block('a'), block('b'), block('c')])]

   it('reorders before a later block', () => {
      const next = relocateBlock(sections, SEC('s1'), 'a', SEC('s1'), 'c')
      expect(ids(next[0].blocks)).toEqual(['b', 'a', 'c'])
   })

   it('appends when beforeBlockId is null', () => {
      const next = relocateBlock(sections, SEC('s1'), 'a', SEC('s1'), null)
      expect(ids(next[0].blocks)).toEqual(['b', 'c', 'a'])
   })
})

describe('relocateBlock — across sections', () => {
   const sections = [
      section('s1', [block('a'), block('b')]),
      section('s2', [block('x'), block('y')]),
   ]

   it('moves a block from one section before a block in another', () => {
      const next = relocateBlock(sections, SEC('s1'), 'a', SEC('s2'), 'y')
      expect(ids(next[0].blocks)).toEqual(['b'])
      expect(ids(next[1].blocks)).toEqual(['x', 'a', 'y'])
   })

   it('appends to the destination section when beforeBlockId is null', () => {
      const next = relocateBlock(sections, SEC('s1'), 'b', SEC('s2'), null)
      expect(ids(next[0].blocks)).toEqual(['a'])
      expect(ids(next[1].blocks)).toEqual(['x', 'y', 'b'])
   })

   it('leaves untouched sections referentially identical', () => {
      const three = [...sections, section('s3', [block('z')])]
      const next = relocateBlock(three, SEC('s1'), 'a', SEC('s2'), 'y')
      expect(next[2]).toBe(three[2])
   })
})

describe('relocateBlock — into / out of container columns', () => {
   const container = block('c1', { type: 'container', left: [block('l1')], right: [block('r1')] })

   it('moves a body block into a container left column', () => {
      const sections = [section('s1', [block('a'), container, block('b')])]
      const next = relocateBlock(sections, SEC('s1'), 'a', COL('s1', 'c1', 'left'), null)
      const c = next[0].blocks.find(bl => bl.id === 'c1')!
      expect(ids(next[0].blocks)).toEqual(['c1', 'b'])
      expect(ids(c.left!)).toEqual(['l1', 'a'])
   })

   it('moves a block out of a column into the section body', () => {
      const sections = [section('s1', [container, block('b')])]
      const next = relocateBlock(sections, COL('s1', 'c1', 'left'), 'l1', SEC('s1'), 'b')
      const c = next[0].blocks.find(bl => bl.id === 'c1')!
      expect(ids(c.left!)).toEqual([])
      expect(ids(next[0].blocks)).toEqual(['c1', 'l1', 'b'])
   })

   it('moves a block from the left column to the right column of the same container', () => {
      const sections = [section('s1', [container])]
      const next = relocateBlock(sections, COL('s1', 'c1', 'left'), 'l1', COL('s1', 'c1', 'right'), 'r1')
      const c = next[0].blocks.find(bl => bl.id === 'c1')!
      expect(ids(c.left!)).toEqual([])
      expect(ids(c.right!)).toEqual(['l1', 'r1'])
   })
})

describe('relocateBlock — no-ops', () => {
   const sections = [section('s1', [block('a'), block('b')])]

   it('returns sections unchanged for an unknown block', () => {
      expect(relocateBlock(sections, SEC('s1'), 'nope', SEC('s1'), 'a')).toBe(sections)
   })

   it('returns sections unchanged for an unknown source section', () => {
      expect(relocateBlock(sections, SEC('sX'), 'a', SEC('s1'), 'b')).toBe(sections)
   })
})
