import { Pencil, FolderPlus, Trash2 } from 'lucide-react'
import { useLang } from '../contexts/LangContext'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'

interface BinderFolderMenuProps {
   x:              number
   y:              number
   onClose:        () => void
   onRename:       () => void
   onNewSubfolder: () => void
   onDelete:       () => void
}

/**
 * Folder context menu, shared by the overflow button and right-click. A thin adapter over the
 * shared <ContextMenu>: it owns the portal, the viewport clamp, keyboard nav, and dismissal.
 */
export function BinderFolderMenu({ x, y, onClose, onRename, onNewSubfolder, onDelete }: BinderFolderMenuProps) {
   const { t } = useLang()

   const entries: ContextMenuEntry[] = [
      { label: t.binderRenameFolder, icon: <Pencil size={13} />,     onSelect: onRename },
      { label: t.binderNewSubfolder, icon: <FolderPlus size={13} />, onSelect: onNewSubfolder },
      { type: 'separator' },
      { label: t.binderDeleteFolder, icon: <Trash2 size={13} />, danger: true, onSelect: onDelete },
   ]

   return <ContextMenu position={{ x, y }} entries={entries} onClose={onClose} className="min-w-[180px]" />
}
