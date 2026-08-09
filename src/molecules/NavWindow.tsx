// -- Library Imports --
import { PanelLeft } from 'lucide-react'

// -- Component / Hook Imports --
import { BlockEditorWindow } from './BlockEditorWindow'
import { NavPanelBody } from '../organisms/NavPanelBody'
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import type { Section } from '../types'
import type { DocPresentationExtras } from '../lib/presentation'

// #########
// # TYPES #
// #########

interface NavWindowProps {
   /** The active document's presentation extras (undefined = none set yet). */
   presentation?: DocPresentationExtras
   /** The live section list, the nav editor reconciles + mirrors it (renames, new/deleted sections). */
   sections: Section[]
   /** The anchor rect the window opens offset from (a degenerate rect = viewport-centered). */
   anchorRect: DOMRect
   /** Commit a new extras object (or undefined to clear all extras), a real document change. */
   onChange: (next: DocPresentationExtras | undefined) => void
   /** Close the window. */
   onClose: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * The document-level Navigation editor as a non-modal draggable window (reusing BlockEditorWindow /
 * useDraggableWindow). The entire form lives in the shared NavPanelBody, which the docked Document nav
 * side panel renders too; this window is just the chrome that hosts it when launched from Document ->
 * Navigation. The editor bakes the exported sidebar nav only (no effect on the live editor sheet).
 */
export function NavWindow({ presentation, sections, anchorRect, onChange, onClose }: NavWindowProps) {
   const { t } = useLang()
   return (
      <BlockEditorWindow
         title={t.navigationWindowTitle}
         icon={<PanelLeft size={15} />}
         anchorRect={anchorRect}
         onClose={onClose}
      >
         <NavPanelBody presentation={presentation} sections={sections} onChange={onChange} />
      </BlockEditorWindow>
   )
}
