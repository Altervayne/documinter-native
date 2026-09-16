/*
 * The consistency guard for unified pagination: one budgeted, empty-atomic-set paginate call at one budget
 * and one width, shared by every surface. The offscreen pass supplies heights; every on-screen surface plus
 * the export paginates synchronously from them through the single `paginateDocument` in pageLayout.ts. A
 * STRUCTURAL guard checked against the source text (jsdom has no layout engine), it catches the class of
 * regression that shipped the 40px budget mismatch: a second paginate call site at a different budget.
 * Sources are pulled in raw (Vite's `?raw`), so nothing is executed.
 */

import { describe, it, expect } from 'vitest'

import appSource from '../App.tsx?raw'
import wysiwygSource from '../organisms/WysiwygArea/index.tsx?raw'
import exportLayoutSource from './exportLayout.ts?raw'
import pageLayoutSource from './pageLayout.ts?raw'

describe('pagination parity: one paginate call, one budget, one width', () => {
   // A bare paginate(...) CALL: the lookbehind excludes the `function paginate(` definition, and
   // paginateDocument( never matches (the char after "paginate" is "D", not "(").
   function barePaginateCalls(source: string): RegExpMatchArray | never[] {
      return source.match(/(?<!function )\bpaginate\(/g) ?? []
   }

   it('App paginates synchronously via paginateDocument and refreshes heights via computeDocumentPages', () => {
      // App paginates on-screen through paginateDocument every render; the debounced offscreen pass
      // (computeDocumentPages) only refreshes the measured heights.
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
      // The offscreen pass builds heights then hands them to paginateDocument; it never calls the low-level
      // paginate() itself, so export and editor cannot diverge.
      expect(exportLayoutSource).toMatch(/\bpaginateDocument\b/)
      expect(barePaginateCalls(exportLayoutSource)).toHaveLength(0)
   })

   it('paginateDocument holds the SOLE budgeted, empty-atomic-set paginate call, at the shared budget and width', () => {
      // Exactly one call site fills the shared budget with an empty atomic set: inside paginateDocument.
      // This would have caught the 40px editor-vs-export divergence, and fails if a second one appears.
      const budgetedCalls = pageLayoutSource.match(/paginate\(sections,[^\n]*paginationBudgetPx\([^\n]*new Set\(\)/g) ?? []
      expect(budgetedCalls).toHaveLength(1)
      // No other surface constructs a budgeted pagination: the four surfaces share this one call.
      for (const source of [appSource, wysiwygSource, exportLayoutSource])
         expect(source.match(/paginate\(sections,[^\n]*paginationBudgetPx\(/g) ?? []).toHaveLength(0)
      // The measurement renders at the shared paged content-box width, so heights stay width-stable against
      // the real sheet (the width-parity test in pageLayout.test.ts pins the value).
      expect(exportLayoutSource).toMatch(/contentBoxWidthPx\(/)
   })
})
