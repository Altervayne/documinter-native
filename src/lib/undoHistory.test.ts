import { describe, it, expect } from 'vitest'
import {
   emptyHistory,
   recordEdit,
   applyUndo,
   applyRedo,
   canUndo,
   canRedo,
   type DocSnapshot,
   type UndoHistory,
} from './undoHistory'

// A minimal snapshot tagged by a marker so tests can assert which slice was restored. The real slice
// fields are irrelevant to the reducer, which treats a snapshot as an opaque value.
function snap(marker: string): DocSnapshot {
   return {
      meta:      { title: marker, fields: [] },
      sections:  [],
      docTheme:  'light',
      docAccent: '#000000',
   }
}

const COALESCE = 500
const CAP = 50

describe('undoHistory reducer', () => {
   it('starts empty', () => {
      const history = emptyHistory()
      expect(canUndo(history)).toBe(false)
      expect(canRedo(history)).toBe(false)
   })

   it('records a distinct edit as one undo entry', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('a'), 'sections', 1000, COALESCE, CAP)
      expect(history.undo).toHaveLength(1)
      expect(canUndo(history)).toBe(true)
      expect(canRedo(history)).toBe(false)
   })

   it('undo restores the pre-edit slice and enables redo', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('before'), 'sections', 1000, COALESCE, CAP)
      const result = applyUndo(history, snap('after'))
      expect(result).not.toBeNull()
      expect(result!.snapshot.meta.title).toBe('before')
      expect(canUndo(result!.history)).toBe(false)
      expect(canRedo(result!.history)).toBe(true)
   })

   it('redo re-applies the undone slice', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('before'), 'sections', 1000, COALESCE, CAP)
      const undone = applyUndo(history, snap('after'))!
      const redone = applyRedo(undone.history, snap('before'), CAP)
      expect(redone).not.toBeNull()
      expect(redone!.snapshot.meta.title).toBe('after')
      expect(canRedo(redone!.history)).toBe(false)
      expect(canUndo(redone!.history)).toBe(true)
   })

   it('undo on an empty stack returns null', () => {
      expect(applyUndo(emptyHistory(), snap('x'))).toBeNull()
   })

   it('redo on an empty stack returns null', () => {
      expect(applyRedo(emptyHistory(), snap('x'), CAP)).toBeNull()
   })

   it('coalesces consecutive same-kind edits within the window into one entry', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('a0'), 'presentation', 1000, COALESCE, CAP)
      history = recordEdit(history, snap('a1'), 'presentation', 1100, COALESCE, CAP)
      history = recordEdit(history, snap('a2'), 'presentation', 1200, COALESCE, CAP)
      expect(history.undo).toHaveLength(1)
      // The kept restore point is the FIRST edit's pre-slice, so one undo reverts the whole burst.
      const undone = applyUndo(history, snap('after'))!
      expect(undone.snapshot.meta.title).toBe('a0')
   })

   it('slides the coalescing window on each merge so a long drag stays one entry', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('a0'), 'format', 1000, COALESCE, CAP)
      // Each step is 400ms after the previous: over the 500ms window individually, but the window
      // slides, so the whole gesture merges.
      history = recordEdit(history, snap('a1'), 'format', 1400, COALESCE, CAP)
      history = recordEdit(history, snap('a2'), 'format', 1800, COALESCE, CAP)
      expect(history.undo).toHaveLength(1)
   })

   it('does not coalesce a different kind', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('a'), 'sections', 1000, COALESCE, CAP)
      history = recordEdit(history, snap('b'), 'format', 1050, COALESCE, CAP)
      expect(history.undo).toHaveLength(2)
   })

   it('does not coalesce the same kind past the window', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('a'), 'sections', 1000, COALESCE, CAP)
      history = recordEdit(history, snap('b'), 'sections', 2000, COALESCE, CAP)
      expect(history.undo).toHaveLength(2)
   })

   it('clears the redo stack when a new edit lands', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('a'), 'sections', 1000, COALESCE, CAP)
      const undone = applyUndo(history, snap('after'))!
      expect(canRedo(undone.history)).toBe(true)
      const next = recordEdit(undone.history, snap('c'), 'sections', 3000, COALESCE, CAP)
      expect(canRedo(next)).toBe(false)
   })

   it('does not coalesce across an undo', () => {
      let history = emptyHistory()
      history = recordEdit(history, snap('a'), 'sections', 1000, COALESCE, CAP)
      const undone = applyUndo(history, snap('after'))!
      // A same-kind edit right after the undo must start a fresh entry, not merge into the pre-undo one.
      const next = recordEdit(undone.history, snap('c'), 'sections', 1050, COALESCE, CAP)
      expect(next.undo).toHaveLength(1)
      expect(next.undo[0].meta.title).toBe('c')
   })

   it('caps the undo depth, dropping the oldest entries', () => {
      let history: UndoHistory = emptyHistory()
      const cap = 3
      for (let index = 0; index < 6; index += 1) {
         // Distinct kinds so nothing coalesces; each is its own entry.
         history = recordEdit(history, snap(`s${index}`), `k${index}`, 1000 + index * 1000, COALESCE, cap)
      }
      expect(history.undo).toHaveLength(3)
      expect(history.undo.map(entry => entry.meta.title)).toEqual(['s3', 's4', 's5'])
   })

   it('caps the undo depth on redo too', () => {
      const cap = 2
      const history: UndoHistory = {
         undo:       [snap('u0'), snap('u1')],
         redo:       [snap('r0')],
         lastKind:   null,
         lastEditAt: 0,
      }
      const redone = applyRedo(history, snap('current'), cap)!
      expect(redone.history.undo).toHaveLength(2)
      expect(redone.history.undo.map(entry => entry.meta.title)).toEqual(['u1', 'current'])
   })
})
