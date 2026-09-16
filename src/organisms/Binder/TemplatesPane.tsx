import { LayoutTemplate, Upload } from 'lucide-react'
import type { DocumentTemplate } from '../../lib/documentTemplate'
import { useLang } from '../../contexts/LangContext'
import { TemplateCard } from './TemplateCard'

interface TemplatesPaneProps {
   templates:   DocumentTemplate[]
   isLoading:   boolean
   onUse:       (template: DocumentTemplate) => void
   onApply:     (template: DocumentTemplate) => void
   onDuplicate: (template: DocumentTemplate) => void
   onExport:    (template: DocumentTemplate) => void
   onRename:    (template: DocumentTemplate) => void
   onDelete:    (template: DocumentTemplate) => void
   onImport:    () => void
}

/**
 * The binder's Templates view: a header over a grid of TemplateCards (built-ins first, then user
 * templates). There is always at least one built-in, so no empty state is needed.
 */
export function TemplatesPane({ templates, isLoading, onUse, onApply, onDuplicate, onExport, onRename, onDelete, onImport }: TemplatesPaneProps) {
   const { t } = useLang()

   return (
      <div className="flex flex-1 flex-col min-h-0">
         <div className="px-6 pt-4 pb-3 border-b border-border flex items-start justify-between gap-3">
            <div>
               <div className="flex items-center gap-2 text-sm font-semibold text-text">
                  <LayoutTemplate size={15} className="text-accent" />
                  {t.binderTemplates}
               </div>
               <div className="mt-1 text-xs text-muted">{t.templatesHint}</div>
            </div>
            <button
               type="button"
               onClick={onImport}
               className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border text-muted hover:text-text hover:border-accent/50 transition-colors cursor-pointer"
            >
               <Upload size={13} />
               {t.templateImport}
            </button>
         </div>

         <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
               <div className="text-muted text-sm">…</div>
            ) : (
               <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                  {templates.map(template => (
                     <TemplateCard
                        key={template.id}
                        template={template}
                        onUse={() => onUse(template)}
                        onApply={() => onApply(template)}
                        onDuplicate={() => onDuplicate(template)}
                        onExport={() => onExport(template)}
                        onRename={() => onRename(template)}
                        onDelete={() => onDelete(template)}
                     />
                  ))}
               </div>
            )}
         </div>
      </div>
   )
}
