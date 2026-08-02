import type { BinderDocumentRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'
import { formatRelativeTime } from '../../lib/relativeTime'

interface DocumentCardMetaProps {
   record: BinderDocumentRecord
}

/**
 * Right-side metadata panel of a document card. Fed entirely from the light record and laid out
 * in stacked groups, title, a compact summary of the first freeform metadata fields, sections
 * (count + first three titles, with an ellipsis when there are more), and timestamps. Every value
 * is truncated so nothing overflows the narrow card width.
 */
export function DocumentCardMeta({ record }: DocumentCardMetaProps) {
   const { t, lang } = useLang()
   const { meta, sectionTitles, updatedAt, lastOpenedAt } = record

   // Summarise up to the first two non-empty fields (value, or "label: value" when labelled).
   const previewFields = (meta.fields ?? [])
      .filter(field => field.label.trim() !== '' || field.value.trim() !== '')
      .slice(0, 2)

   const sectionCount    = sectionTitles.length
   const sectionLabel    = sectionCount === 1 ? t.binderSectionOne : t.binderSectionMany
   const previewTitles   = sectionTitles.slice(0, 3).filter(Boolean)
   const hasMoreSections = sectionCount > 3

   return (
      <div className="flex flex-col gap-2.5 min-w-0 flex-1 p-3.5">
         <div className="text-sm font-semibold text-text truncate min-w-0">
            {meta.title || t.untitledDoc}
         </div>

         {/* Freeform metadata, first one or two fields */}
         {previewFields.length > 0 && (
            <div className="flex flex-col gap-0.5 text-[0.7rem] font-mono text-muted">
               {previewFields.map(field => {
                  const label = field.label.trim()
                  const value = field.value.trim()
                  return (
                     <div key={field.id} className="flex items-center gap-1.5 min-w-0">
                        {label && <span className="shrink-0 text-muted/70">{label}:</span>}
                        <span className="truncate min-w-0">{value}</span>
                     </div>
                  )
               })}
            </div>
         )}

         {/* Sections, count + first three titles, ellipsis if there are more */}
         <div className="flex flex-col gap-0.5 min-w-0">
            <div className="text-xs font-medium text-muted/90 truncate min-w-0">
               {sectionCount} {sectionLabel}
            </div>
            {(previewTitles.length > 0 || hasMoreSections) && (
               <ul className="flex flex-col gap-0.5 text-xs text-muted/70">
                  {previewTitles.map((title, index) => (
                     <li key={index} className="flex items-center gap-1.5 min-w-0">
                        <span className="text-muted/40 shrink-0">·</span>
                        <span className="truncate min-w-0">{title}</span>
                     </li>
                  ))}
                  {hasMoreSections && (
                     <li className="flex items-center gap-1.5 min-w-0 text-muted/50">
                        <span className="text-muted/40 shrink-0">·</span>
                        <span>…</span>
                     </li>
                  )}
               </ul>
            )}
         </div>

         <div className="mt-auto pt-1 flex flex-col gap-0.5 text-[0.7rem] text-muted/60">
            <span className="truncate min-w-0">
               {t.binderDateUpdated}: {formatRelativeTime(updatedAt, lang)}
            </span>
            <span className="truncate min-w-0 text-muted/50">
               {lastOpenedAt ? `${t.binderLastOpened}: ${formatRelativeTime(lastOpenedAt, lang)}` : t.binderNeverOpened}
            </span>
         </div>
      </div>
   )
}
