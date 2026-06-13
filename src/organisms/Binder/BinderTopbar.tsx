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
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-border bg-raised">
         {/* Left: logo — matches the main workspace topbar exactly (theme-aware, h-7) */}
         <div className="flex items-center gap-2 w-48">
            {theme === 'dark'
               ? <LogoColor className="h-7 w-auto" />
               : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
            }
         </div>

         {/* Center: title */}
         <div className="flex-1 text-center text-sm font-semibold text-text">
            {t.binderTitle}
         </div>

         {/* Right: actions */}
         <div className="flex items-center justify-end gap-2 w-48">
            <Button size="sm" onClick={onNewDocument} disabled={newDocumentDisabled}>
               <FilePlus size={13} />
               {t.newDocument}
            </Button>
            <Button size="sm" variant="primary" onClick={onClose}>
               <ArrowLeft size={13} />
               {t.binderBackToEditor}
            </Button>
         </div>
      </div>
   )
}
