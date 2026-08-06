import { ChevronRight } from 'lucide-react'
import type { BinderFolderRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'

interface BinderBreadcrumbProps {
   ancestors:     BinderFolderRecord[]        // [root-most ... immediate parent]
   currentFolder: BinderFolderRecord | null   // null = root
   onNavigate:    (folder: BinderFolderRecord | null) => void
}

/** Folder path: All Documents -> ... -> current. Each crumb navigates to that level. */
export function BinderBreadcrumb({ ancestors, currentFolder, onNavigate }: BinderBreadcrumbProps) {
   const { t } = useLang()
   const trail = currentFolder ? [...ancestors, currentFolder] : ancestors

   return (
      <nav className="flex items-center gap-1 flex-wrap text-sm">
         <button
            type="button"
            onClick={() => onNavigate(null)}
            className={`transition-colors cursor-pointer ${currentFolder === null ? 'text-text font-medium' : 'text-muted hover:text-text'}`}
         >
            {t.binderAllDocuments}
         </button>
         {trail.map((folder, index) => {
            const isLast = index === trail.length - 1
            return (
               <span key={folder.id} className="flex items-center gap-1 min-w-0">
                  <ChevronRight size={13} className="text-muted/40 shrink-0" />
                  <button
                     type="button"
                     onClick={() => onNavigate(folder)}
                     className={`truncate transition-colors cursor-pointer ${isLast ? 'text-text font-medium' : 'text-muted hover:text-text'}`}
                  >
                     {folder.name}
                  </button>
               </span>
            )
         })}
      </nav>
   )
}
