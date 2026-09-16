import { FolderOpen, Copy, Download, FileDown, Trash2, LayoutTemplate } from 'lucide-react'
import { useLang } from '../contexts/LangContext'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'

interface BinderContextMenuProps {
   x:                number
   y:                number
   onClose:          () => void
   onOpen:           () => void
   onDuplicate:      () => void
   onDelete:         () => void
   onExportHtml:     () => void
   onExportMarkdown: () => void
   onSaveAsTemplate: () => void
}

/** Card context menu, shared by the row's overflow button and right-click. Thin adapter over <ContextMenu>. */
export function BinderContextMenu({
   x, y, onClose, onOpen, onDuplicate, onDelete, onExportHtml, onExportMarkdown, onSaveAsTemplate,
}: BinderContextMenuProps) {
   const { t } = useLang()

   const entries: ContextMenuEntry[] = [
      { label: t.binderOpenAction, icon: <FolderOpen size={13} />, onSelect: onOpen },
      { label: t.binderDuplicate,  icon: <Copy size={13} />,       onSelect: onDuplicate },
      { label: t.saveAsTemplate,   icon: <LayoutTemplate size={13} />, onSelect: onSaveAsTemplate },
      { type: 'separator' },
      { label: t.exportHtml,     icon: <Download size={13} />, onSelect: onExportHtml },
      { label: t.exportMarkdown, icon: <FileDown size={13} />, onSelect: onExportMarkdown },
      { type: 'separator' },
      { label: t.binderDelete, icon: <Trash2 size={13} />, danger: true, onSelect: onDelete },
   ]

   return <ContextMenu position={{ x, y }} entries={entries} onClose={onClose} className="min-w-[200px]" />
}
