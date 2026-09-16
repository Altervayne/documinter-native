/*
 * Coordinates the "split at rest, whole when focused" paragraph behavior. In a paged document an
 * overflowing paragraph renders as read-only fragments across sheets; clicking a fragment reflows it
 * to one whole editable field, and it re-splits on blur. The focused id is the lever: it is held
 * atomic during pagination so only that paragraph stays whole. The state lives in App; this context
 * exposes it plus the request / blur signals so the deep paragraph blocks need no prop-drilling.
 * Absent a provider the default is inert.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

// #########
// # TYPES #
// #########

interface ParagraphFocusContextValue {
   /** Id of the paragraph currently held whole for editing, or null when every paragraph is at rest. */
   focusedParagraphId: string | null
   /** A fragment was pressed: reflow this paragraph whole and place the caret at `caretOffset`, a
    *  model-absolute char offset. */
   requestFocus: (blockId: string, caretOffset: number) => void
   /** A paragraph editable gained focus: hold it as the focused id so measurement freezes while edited. */
   notifyFocus: (blockId: string) => void
   /** The focused whole paragraph lost focus: re-split it, unless focus was handed to another paragraph. */
   notifyBlur: (blockId: string) => void
}

// ###########
// # CONTEXT #
// ###########

const ParagraphFocusContext = createContext<ParagraphFocusContextValue>({
   focusedParagraphId: null,
   requestFocus:       () => {},
   notifyFocus:        () => {},
   notifyBlur:         () => {},
})

// ############
// # PROVIDER #
// ############

interface ParagraphFocusProviderProps {
   value:    ParagraphFocusContextValue
   children: ReactNode
}

export function ParagraphFocusProvider({ value, children }: ParagraphFocusProviderProps) {
   return <ParagraphFocusContext.Provider value={value}>{children}</ParagraphFocusContext.Provider>
}

// ########
// # HOOK #
// ########

export function useParagraphFocus(): ParagraphFocusContextValue {
   return useContext(ParagraphFocusContext)
}
