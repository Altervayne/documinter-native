/*
 * Per-tab undo/redo over a document's undoable slice: a pure reducer plus its snapshot type. No clock of
 * its own (the caller passes the time and tuning constants). A snapshot holds references to the
 * immutable model, never a deep clone, so successive snapshots share every untouched subtree. History is
 * session-only and lives outside OpenDocument, so it never reaches autosave or serialization.
 */

// -- Type Imports --
import type { DocMeta, Section } from '../types'
import type { DocPresentationExtras } from './presentation'
import type { DocFormat } from './format'

// #########
// # TYPES #
// #########

/** The undoable slice of one document: the fields the binder persists, nothing tab-local. */
export interface DocSnapshot {
   meta:          DocMeta
   sections:      Section[]
   docTheme:      'light' | 'dark'
   docAccent:     string
   presentation?: DocPresentationExtras
   format?:       DocFormat
}

/**
 * One tab's history. `undo` holds prior slices oldest-first (the last element is the state to
 * restore next); `redo` holds slices undone away, ready to re-apply. `lastKind` / `lastEditAt` drive
 * coalescing so a burst of same-kind edits collapses into one entry.
 */
export interface UndoHistory {
   undo:       DocSnapshot[]
   redo:       DocSnapshot[]
   lastKind:   string | null
   lastEditAt: number
}

// #############
// # CONSTANTS #
// #############

/** Consecutive same-kind edits closer than this merge into one history entry, so a slider drag or a
 *  rapid repeat does not spawn dozens of steps. */
export const COALESCE_MS = 500

/** Upper bound on undo entries per tab; oldest drop first, bounding memory (base64 images are the heavy
 *  payload, and dropping the oldest snapshot releases what it uniquely retained). */
export const HISTORY_DEPTH_CAP = 50

// #############
// # REDUCER   #
// #############

/** A fresh, empty history for a new or opened tab. */
export function emptyHistory(): UndoHistory {
   return { undo: [], redo: [], lastKind: null, lastEditAt: 0 }
}

export function canUndo(history: UndoHistory): boolean {
   return history.undo.length > 0
}

export function canRedo(history: UndoHistory): boolean {
   return history.redo.length > 0
}

/**
 * Fold a committed edit into the history: push the pre-edit slice onto the undo stack and drop any
 * redo (a new edit invalidates the redo branch). When the edit is the same kind as the last and lands
 * within the coalescing window, the existing top is kept as the single restore point and only the
 * window slides, so a burst of like edits stays one entry.
 */
export function recordEdit(
   history:    UndoHistory,
   before:     DocSnapshot,
   kind:       string,
   now:        number,
   coalesceMs: number,
   depthCap:   number,
): UndoHistory {
   const coalesce =
      history.undo.length > 0 &&
      kind === history.lastKind &&
      now - history.lastEditAt <= coalesceMs
   if (coalesce) {
      return { ...history, redo: [], lastEditAt: now }
   }
   const undo = [...history.undo, before]
   while (undo.length > depthCap) undo.shift()
   return { undo, redo: [], lastKind: kind, lastEditAt: now }
}

/**
 * Step back one entry: pop the last undo slice as the state to restore, and stash `current` on the
 * redo stack so it can be re-applied. Returns null when there is nothing to undo. Coalescing is reset
 * so the next edit starts a fresh entry rather than merging across the undo.
 */
export function applyUndo(history: UndoHistory, current: DocSnapshot): { history: UndoHistory; snapshot: DocSnapshot } | null {
   if (history.undo.length === 0) return null
   const undo = [...history.undo]
   const snapshot = undo.pop()!
   return {
      history: { undo, redo: [...history.redo, current], lastKind: null, lastEditAt: 0 },
      snapshot,
   }
}

/**
 * Step forward one entry: pop the last redo slice as the state to restore, and push `current` back
 * onto the undo stack (respecting the depth cap). Returns null when there is nothing to redo.
 */
export function applyRedo(history: UndoHistory, current: DocSnapshot, depthCap: number): { history: UndoHistory; snapshot: DocSnapshot } | null {
   if (history.redo.length === 0) return null
   const redo = [...history.redo]
   const snapshot = redo.pop()!
   const undo = [...history.undo, current]
   while (undo.length > depthCap) undo.shift()
   return {
      history: { undo, redo, lastKind: null, lastEditAt: 0 },
      snapshot,
   }
}
