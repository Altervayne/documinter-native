import { ArrowLeft, FilePlus } from 'lucide-react'
import { LogoColor, LogoMono } from '../../atoms/Logo'
import { Button } from '../../atoms/Button'
import { useLang } from '../../contexts/LangContext'

interface BinderTopbarProps {
   theme:                'light' | 'dark'
   onClose:              () => void
   onNewDocument:        () => void
   newDocumentDisabled?: boolean
}

export function BinderTopbar({ theme, onClose, onNewDocument, newDocumentDisabled }: BinderTopbarProps) {
   const { t } = useLang()

   return (
      <div className="flex items-center justify-between h-11 gap-4 px-1 py-2.5 border-b border-border bg-raised">
         {/* Brand, left anchor */}
         <div className="flex items-center gap-2 ml-3 shrink-0 select-none">
            {theme === 'dark'
               ? <LogoColor className="h-7 w-auto" />
               : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
            }
            <span className="font-mono text-sm font-bold text-accent tracking-tight">documinter</span>
         </div>

         {/* Center: title */}
         <div className="flex-1 text-center text-sm font-semibold text-text">
            {t.binderTitle}
         </div>

         {/* Right: actions */}
         <div className="flex items-center justify-end gap-2 w-48">
            <Button
               onClick={onNewDocument}
               disabled={newDocumentDisabled}
            >
               <FilePlus size={13} />
               {t.newDocument}
            </Button>
            <Button
               variant="primary"
               onClick={onClose}
            >
               <ArrowLeft size={13} />
               {t.binderBackToEditor}
            </Button>
         </div>
      </div>
   )
}
