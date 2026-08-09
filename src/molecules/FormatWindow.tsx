// -- Library Imports --
import { Ruler } from 'lucide-react'

// -- Component / Hook Imports --
import { BlockEditorWindow } from './BlockEditorWindow'
import { FormatPanelBody } from '../organisms/FormatPanelBody'
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import type { DocFormat } from '../lib/format'

// #########
// # TYPES #
// #########

interface FormatWindowProps {
   /** The active document's format (undefined = today's infinite/normal-width default). */
   format?: DocFormat
   /** The anchor rect the window opens offset from (a degenerate rect = viewport-centered). */
   anchorRect: DOMRect
   /** Commit a new format object (or undefined to clear it back to the default), a real document
    *  change, mirrors PresentationWindow's onChange. */
   onChange: (next: DocFormat | undefined) => void
   /** Close the window. */
   onClose: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * The document-level Page setup editor as a NON-MODAL draggable window (reusing BlockEditorWindow /
 * useDraggableWindow), mirroring PresentationWindow / NavWindow. The entire form lives in the shared
 * FormatPanelBody, which the docked Page setup side panel renders too; this window is just the chrome
 * that hosts it when launched from Document -> Page setup.
 */
export function FormatWindow({ format, anchorRect, onChange, onClose }: FormatWindowProps) {
   const { t } = useLang()
   return (
      <BlockEditorWindow
         title={t.formatWindowTitle}
         icon={<Ruler size={15} />}
         anchorRect={anchorRect}
         onClose={onClose}
      >
         <FormatPanelBody format={format} onChange={onChange} />
      </BlockEditorWindow>
   )
}
