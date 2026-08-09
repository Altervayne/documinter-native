/*
 * The consistency guard for unified pagination: there is ONE budgeted, empty-atomic-set paginate call, at
 * ONE budget and ONE width, shared by every surface. MEASURING heights is async and offscreen; PAGINATING
 * from those heights is pure arithmetic. So the split is: the offscreen pass supplies heights, and every
 * on-screen surface (editor canvas, Pages panel, Preview) plus the export paginates SYNCHRONOUSLY from them
 * through the single pure `paginateDocument` in pageLayout.ts, which is the only place the low-level
 * `paginate` is called at the shared budget with an empty atomic set. This is a STRUCTURAL guard, checked
 * against the source text, because jsdom has no layout engine and cannot exercise real pagination. It exists
 * to catch the exact class of regression that shipped the 40px budget mismatch: a second paginate call site,
 * at a different budget, that no runtime test pinned. If pagination ever sprouts a second call site, or App
 * / the canvas starts paginating on its own, this fails. Sources are pulled in raw (Vite's `?raw`), so
 * nothing is executed.
 */

import { describe, it, expect } from 'vitest'

import appSource from '../App.tsx?raw'
import wysiwygSource from '../organisms/WysiwygArea/index.tsx?raw'
import exportLayoutSource from './exportLayout.ts?raw'
import pageLayoutSource from './pageLayout.ts?raw'

describe('pagination parity: one paginate call, one budget, one width', () => {
   // A bare paginate(...) CALL. The `function paginate(` definition is excluded by the lookbehind, and
   // paginateDocument( never matches /paginate\(/ at all (the char after "paginate" is "D", not "(").
   function barePaginateCalls(source: string): RegExpMatchArray | never[] {
      return source.match(/(?<!function )\bpaginate\(/g) ?? []
   }

   it('App paginates synchronously via paginateDocument and refreshes heights via computeDocumentPages', () => {
      // App owns the layout: it paginates on-screen through the pure paginateDocument on every render, while
      // the debounced offscreen pass (computeDocumentPages) only refreshes the measured heights.
      expect(appSource).toMatch(/\bpaginateDocument\b/)
      expect(appSource).toMatch(/\bcomputeDocumentPages\b/)
      // But App never runs the low-level paginator or assembles metrics itself.
      expect(barePaginateCalls(appSource)).toHaveLength(0)
      expect(appSource).not.toMatch(/\bbuildMetrics\b/)
      expect(appSource).not.toMatch(/usePagedLayout/)
   })

   it('the editor canvas renders the pages prop and never paginates on its own', () => {
      expect(barePaginateCalls(wysiwygSource)).toHaveLength(0)
      expect(wysiwygSource).not.toMatch(/usePagedLayout/)
   })

   it('exportLayout measures fresh heights and delegates pagination to paginateDocument', () => {
      // The offscreen pass builds heights, then hands them to the shared paginateDocument; it never calls the
      // low-level paginate() itself, so the export and the editor cannot diverge.
      expect(exportLayoutSource).toMatch(/\bpaginateDocument\b/)
      expect(barePaginateCalls(exportLayoutSource)).toHaveLength(0)
   })

   it('paginateDocument holds the SOLE budgeted, empty-atomic-set paginate call, at the shared budget and width', () => {
      // Exactly one call site fills the shared pagination budget with an empty atomic set: inside
      // paginateDocument in pageLayout.ts. This is the guard that would have caught the 40px editor-vs-export
      // budget divergence, and it fails the moment a second budgeted paginator sprouts anywhere.
      const budgetedCalls = pageLayoutSource.match(/paginate\(sections,[^\n]*paginationBudgetPx\([^\n]*new Set\(\)/g) ?? []
      expect(budgetedCalls).toHaveLength(1)
      // No other surface constructs a budgeted pagination: the four surfaces share this one call.
      for (const source of [appSource, wysiwygSource, exportLayoutSource])
         expect(source.match(/paginate\(sections,[^\n]*paginationBudgetPx\(/g) ?? []).toHaveLength(0)
      // The measurement renders at the shared paged content-box width, so heights are width-stable against
      // the real sheet (the companion width-parity test in pageLayout.test.ts pins the value).
      expect(exportLayoutSource).toMatch(/contentBoxWidthPx\(/)
   })
})
