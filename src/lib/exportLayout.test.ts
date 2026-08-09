/*
 * Unit coverage for the document paginator's PURE surface. What this file can honestly assert is limited
 * on purpose: jsdom has no layout engine, so every getBoundingClientRect / getClientRects returns zeros
 * and the measured heights that drive real pagination are meaningless here. The pagination itself (how a
 * measured document splits into sheets, which page trips the too-tall note) is therefore verified LIVE in
 * a real browser, not in vitest. What IS pure and worth pinning here: the signature that keys the memo
 * (identical inputs must share a key, height-affecting edits must not), and the early-return contract for
 * non-paged documents (an infinite or format-less document paginates to nothing without touching the DOM).
 */

import { describe, expect, it } from 'vitest'

import { computeDocumentPages, exportPagesSignature } from './exportLayout'
import type { ExportOptions } from './export'
import type { DocMeta, Section } from '../types'

// ###########
// # HELPERS #
// ###########

function meta(title = 'Doc'): DocMeta {
   return { title, fields: [] }
}

function section(id: string, title: string): Section {
   return { id, title, collapsed: false, blocks: [] }
}

const baseOpts: ExportOptions = { theme: 'light', accent: '#f97316' }

// #############
// # SIGNATURE #
// #############

describe('exportPagesSignature (memo key determinism)', () => {
   const sections = [section('s1', 'One'), section('s2', 'Two')]
   const opts: ExportOptions = { ...baseOpts, format: { kind: 'a4-portrait' } }

   it('is stable for identical inputs', () => {
      const first  = exportPagesSignature(meta(), sections, opts)
      const second = exportPagesSignature(meta(), sections, opts)
      expect(second).toBe(first)
   })

   it('changes when the model changes', () => {
      const original = exportPagesSignature(meta(), sections, opts)
      const edited   = exportPagesSignature(meta(), [section('s1', 'One edited'), section('s2', 'Two')], opts)
      expect(edited).not.toBe(original)
   })

   it('changes on any height-affecting option (format, theme, accent, lang, presentation)', () => {
      const original = exportPagesSignature(meta(), sections, opts)
      expect(exportPagesSignature(meta(), sections, { ...opts, format: { kind: 'a4-landscape' } })).not.toBe(original)
      expect(exportPagesSignature(meta(), sections, { ...opts, theme: 'dark' })).not.toBe(original)
      expect(exportPagesSignature(meta(), sections, { ...opts, accent: '#123456' })).not.toBe(original)
      expect(exportPagesSignature(meta(), sections, { ...opts, lang: 'fr' })).not.toBe(original)
   })

   it('ignores pagedLayout, which is a caller override rather than a measurement input', () => {
      const withoutLayout = exportPagesSignature(meta(), sections, opts)
      const withLayout    = exportPagesSignature(meta(), sections, { ...opts, pagedLayout: [{ id: 'p1', slices: [] }] })
      expect(withLayout).toBe(withoutLayout)
   })
})

// ###################
// # NON-PAGED PATH  #
// ###################

describe('computeDocumentPages non-paged contract', () => {
   const sections = [section('s1', 'One')]

   it('returns an empty result for an infinite format without touching the DOM', async () => {
      const result = await computeDocumentPages(meta(), sections, { ...baseOpts, format: { kind: 'infinite' } })
      expect(result.pages).toEqual([])
      expect(result.tooTallPageIds).toBeInstanceOf(Set)
      expect(result.tooTallPageIds.size).toBe(0)
   })

   it('returns an empty result when no format is supplied', async () => {
      const result = await computeDocumentPages(meta(), sections, baseOpts)
      expect(result.pages).toEqual([])
      expect(result.tooTallPageIds.size).toBe(0)
   })

   it('always returns the { pages, tooTallPageIds } shape', async () => {
      const result = await computeDocumentPages(meta(), sections, baseOpts)
      expect(result).toHaveProperty('pages')
      expect(result).toHaveProperty('tooTallPageIds')
   })
})
