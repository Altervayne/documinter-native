// -- Library Imports --
import { Image as ImageIcon } from 'lucide-react'

// -- Component / Hook Imports --
import { BlockEditorWindow } from './BlockEditorWindow'
import { PresentationPanelBody } from '../organisms/PresentationPanelBody'
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import type { DocPresentationExtras } from '../lib/presentation'

// #########
// # TYPES #
// #########

interface PresentationWindowProps {
   /** The active document's presentation extras (undefined = none set yet). */
   presentation?: DocPresentationExtras
   /** The anchor rect the window opens offset from (a degenerate rect = viewport-centered). */
   anchorRect: DOMRect
   /** Commit a new extras object (or undefined to clear all extras) - a real document change. */
   onChange: (next: DocPresentationExtras | undefined) => void
   /** Close the window. */
   onClose: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * The document-level Presentation editor as a non-modal draggable window (reusing BlockEditorWindow /
 * useDraggableWindow). The entire form lives in the shared PresentationPanelBody, which the docked
 * Presentation side panel renders too; this window is just the chrome that hosts it when launched from
 * Document -> Presentation. Navigation lives in its own standalone NavWindow, so this window covers
 * Watermark + Header.
 */
export function PresentationWindow({ presentation, anchorRect, onChange, onClose }: PresentationWindowProps) {
   const { t } = useLang()
   return (
      <BlockEditorWindow
         title={t.presentationWindowTitle}
         icon={<ImageIcon size={15} />}
         anchorRect={anchorRect}
         onClose={onClose}
      >
         <PresentationPanelBody presentation={presentation} onChange={onChange} />
      </BlockEditorWindow>
   )
}
