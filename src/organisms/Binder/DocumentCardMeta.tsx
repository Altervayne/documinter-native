import type { BinderDocumentRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'
import { formatRelativeTime } from '../../lib/relativeTime'

interface DocumentCardMetaProps {
   record: BinderDocumentRecord
}

/** Right-side metadata panel of a document card. Fed entirely from the light record. */
export function DocumentCardMeta({ record }: DocumentCardMetaProps) {
   const { t, lang } = useLang()
   const { meta, sectionTitles, updatedAt, lastOpenedAt } = record

   const metaParts     = [meta.module, meta.env, meta.author, meta.date].filter(Boolean)
   const sectionLabel  = sectionTitles.length === 1 ? t.binderSectionOne : t.binderSectionMany
   const previewTitles = sectionTitles.slice(0, 3).filter(Boolean)

   return (
      <div className="flex flex-col gap-1.5 min-w-0 flex-1 p-3.5">
         <div className="text-sm font-semibold text-text truncate">
            {meta.title || t.untitledDoc}
         </div>

         {metaParts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.7rem] font-mono text-muted">
               {metaParts.map((part, index) => (
                  <span key={index} className="flex items-center gap-1.5 max-w-full truncate">
                     {index > 0 && <span className="text-muted/40">·</span>}
                     <span className="truncate">{part}</span>
                  </span>
               ))}
            </div>
         )}

         <div className="text-xs font-medium text-muted/90">
            {sectionTitles.length} {sectionLabel}
         </div>
         {previewTitles.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted/70">
               {previewTitles.map((title, index) => (
                  <li key={index} className="flex items-center gap-1.5 min-w-0">
                     <span className="text-muted/40 shrink-0">·</span>
                     <span className="truncate">{title}</span>
                  </li>
               ))}
            </ul>
         )}

         <div className="mt-auto pt-1 flex flex-col gap-0.5 text-[0.7rem] text-muted/60">
            <span>{formatRelativeTime(updatedAt, lang)}</span>
            <span className="text-muted/50">
               {lastOpenedAt ? `${t.binderLastOpened}: ${formatRelativeTime(lastOpenedAt, lang)}` : t.binderNeverOpened}
            </span>
         </div>
      </div>
   )
}
