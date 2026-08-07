/**
 * ParagraphFocusContext, coordinates the "split at rest, whole when focused" paragraph behavior.
 *
 * Exports: ParagraphFocusProvider, useParagraphFocus
 *
 * In a paged document an overflowing paragraph renders as read-only fragments across sheets (WYSIWYG
 * at rest). Clicking a fragment reflows the paragraph to one whole editable field on its start sheet,
 * caret placed where the click landed, so typing / caret / backspace behave normally; on blur it
 * re-splits. The focused-id is the single lever driving that: it is held atomic during pagination so
 * only the focused paragraph stays whole. The state itself lives in App (so the editor and the Pages
 * panel paginate from the same value); this context only exposes it plus the request / blur signals to
 * the deep paragraph blocks, so nothing has to prop-drill through the section / block layers.
 *
 * Provided once at the WysiwygArea root (beside DocThemeProvider). Absent a provider the default is
 * inert, so a paragraph outside a paged editor never tries to reflow.
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
   /** A fragment was pressed: reflow this paragraph whole and place the caret at `caretOffset` (a
    *  model-absolute char offset). */
   requestFocus: (blockId: string, caretOffset: number) => void
   /** A paragraph editable gained focus (direct click, or the reflowed fragment once it mounts): hold it
    *  as the focused id so measurement freezes while it is edited. */
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
