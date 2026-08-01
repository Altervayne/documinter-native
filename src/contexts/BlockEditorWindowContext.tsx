/**
 * BlockEditorWindowContext — coordinates the single floating block-editor window.
 *
 * Exports: BlockEditorWindowProvider, useBlockEditorWindow
 *
 * Holds ONLY ephemeral UI state: the id of the block whose editor window is currently open.
 * This is deliberately NOT part of `OpenDocument` / `sections` — opening an editor must never
 * dirty the document or trigger autosave. Mounted at the WysiwygArea root (beside DocThemeProvider)
 * so every block reads `openBlockId === block.id` without prop-threading. Single-window rule:
 * opening one block's editor replaces any other. The window closes on tab switch (the provider
 * takes the active tab key as a reset signal) and clears itself when the open block unmounts.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

// #########
// # TYPES #
// #########

interface BlockEditorWindowContextValue {
   /** Id of the block whose editor window is open, or null when none is. */
   openBlockId: string | null
   /** Open the editor window for a block, replacing any currently-open one (single-window rule). */
   openEditor:  (blockId: string) => void
   /** Close the editor window. */
   closeEditor: () => void
   /** Convenience predicate a block uses to decide its inline-vs-window presentation. */
   isEditing:   (blockId: string) => boolean
   /**
    * Clear the open id only if it is this block's — the unmount safety a block calls on teardown
    * so a deleted / undone-away block never leaves a dangling open id in the context.
    */
   clearIfEditing: (blockId: string) => void
}

// ###########
// # CONTEXT #
// ###########

// A no-op default so a stray `useBlockEditorWindow()` outside the provider is inert, not a crash
// (mirrors DocThemeContext's safe default).
const BlockEditorWindowContext = createContext<BlockEditorWindowContextValue>({
   openBlockId:    null,
   openEditor:     () => {},
   closeEditor:    () => {},
   isEditing:      () => false,
   clearIfEditing: () => {},
})

// ############
// # PROVIDER #
// ############

interface BlockEditorWindowProviderProps {
   /**
    * A value that changes on tab switch (the active tab key). When it changes the open window is
    * closed — the open block belongs to the outgoing tab and may not exist in the incoming one.
    */
   resetKey: string | undefined
   children: ReactNode
}

export function BlockEditorWindowProvider({ resetKey, children }: BlockEditorWindowProviderProps) {
   const [openBlockId, setOpenBlockId] = useState<string | null>(null)

   // Close the window whenever the active tab changes — the documented "adjust state during render
   // when a prop changes" pattern (a previous-value state paired with a render-time set), which
   // resets in the same commit with no extra effect / cascading render.
   const [previousResetKey, setPreviousResetKey] = useState(resetKey)
   if (resetKey !== previousResetKey) {
      setPreviousResetKey(resetKey)
      setOpenBlockId(null)
   }

   const value: BlockEditorWindowContextValue = {
      openBlockId,
      openEditor:     blockId => setOpenBlockId(blockId),
      closeEditor:    () => setOpenBlockId(null),
      isEditing:      blockId => openBlockId === blockId,
      // Functional update so the compare reads the live value, never a stale closure — safe to
      // call from an unmount cleanup that captured an older render's context.
      clearIfEditing: blockId => setOpenBlockId(current => (current === blockId ? null : current)),
   }

   return (
      <BlockEditorWindowContext.Provider value={value}>
         {children}
      </BlockEditorWindowContext.Provider>
   )
}

// ########
// # HOOK #
// ########

export function useBlockEditorWindow(): BlockEditorWindowContextValue {
   return useContext(BlockEditorWindowContext)
}
