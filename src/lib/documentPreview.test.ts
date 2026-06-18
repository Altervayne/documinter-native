import { describe, it, expect } from 'vitest'
import { extractDocumentText, buildPreviewSections } from './documentPreview'
import type { Block, Section } from '../types'

describe('extractDocumentText', () => {
   it('flattens paragraph, list, table, and image-alt text, but never image src', () => {
      const sections: Section[] = [{
         id: 's', title: 'Title', collapsed: false,
         blocks: [
            { id: 'p', type: 'p', richText: [{ text: 'paragraph body' }] },
            {
               id: 'list', type: 'list',
               items: [{ id: 'i', richText: [{ text: 'list entry' }], children: [
                  { id: 'i2', richText: [{ text: 'nested entry' }], children: [] },
               ] }],
            },
            { id: 't', type: 'table', richHeaders: [[{ text: 'Header cell' }]], richRows: [[[{ text: 'Row cell' }]]] },
            { id: 'img', type: 'image', alt: 'alt label', caption: 'caption text', src: 'data:image/png;base64,AAAABBBB' },
         ],
      }]
      const text = extractDocumentText(sections)
      expect(text).toContain('paragraph body')
      expect(text).toContain('list entry')
      expect(text).toContain('nested entry')
      expect(text).toContain('Header cell')
      expect(text).toContain('Row cell')
      expect(text).toContain('alt label')
      expect(text).toContain('caption text')
      // The base64 image source must not leak into the searchable text.
      expect(text).not.toContain('AAAABBBB')
   })
})

describe('buildPreviewSections', () => {
   it('caps the snapshot at the first 8 blocks across sections', () => {
      const tenParagraphs: Block[] = Array.from({ length: 10 }, (_, index) => ({
         id: `p${index}`, type: 'p', richText: [{ text: `para ${index}` }],
      }))
      const sections: Section[] = [{ id: 's', title: 'Section', collapsed: false, blocks: tenParagraphs }]
      const preview = buildPreviewSections(sections)
      const totalBlocks = preview.reduce((sum, section) => sum + section.blocks.length, 0)
      expect(totalBlocks).toBe(8)
   })

   it('strips the image src so no base64 enters the preview', () => {
      const sections: Section[] = [{
         id: 's', title: 'Section', collapsed: false,
         blocks: [{ id: 'img', type: 'image', alt: 'a', src: 'data:image/png;base64,AAAABBBB' }],
      }]
      const preview = buildPreviewSections(sections)
      expect(preview[0].blocks[0].src).toBe('')
   })
})
