import { useState } from 'react'
import { LayoutTemplate, MoreHorizontal, Copy, Pencil, Trash2, Wand2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { DocumentTemplate } from '../../lib/documentTemplate'
import { useLang } from '../../contexts/LangContext'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'

interface TemplateCardProps {
   template:    DocumentTemplate
   onUse:       () => void
   onDuplicate: () => void
   onRename:    () => void
   onDelete:    () => void
}

/**
 * A template card: name + built-in badge, a scaffold preview (the accent swatch, the meta field
 * labels it will seed, and the page-format badge), a prominent "Use template" action, and a ⋯ menu
 * (Duplicate always; Rename / Delete only for user templates, since built-ins are code-defined).
 * Templates carry no content, so there is no live document preview like DocumentCard has.
 */
export function TemplateCard({ template, onUse, onDuplicate, onRename, onDelete }: TemplateCardProps) {
   const { t } = useLang()
   const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

   // Built-in names are English in code; the picker localizes them by id.
   const displayName = template.builtIn && template.id === 'builtin-default' ? t.templateBuiltinDefault : template.name

   const formatLabel = !template.format || template.format.kind === 'infinite'
      ? t.formatKindInfinite
      : template.format.kind === 'a4-portrait'
         ? t.formatKindA4Portrait
         : t.formatKindA4Landscape

   const above = template.meta.fields.filter(field => field.position === 'above')
   const below = template.meta.fields.filter(field => field.position === 'below')

   function openMenu(event: React.MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      setMenuPosition({ x: event.clientX, y: event.clientY })
   }

   const entries: ContextMenuEntry[] = [
      { label: t.templateUse,       icon: <Wand2 size={13} />, onSelect: onUse },
      { label: t.binderDuplicate,   icon: <Copy size={13} />,  onSelect: onDuplicate },
      ...(template.builtIn ? [] : [
         { type: 'separator' } as ContextMenuEntry,
         { label: t.templateRename, icon: <Pencil size={13} />, onSelect: onRename },
         { label: t.templateDelete, icon: <Trash2 size={13} />, danger: true, onSelect: onDelete },
      ]),
   ]

   return (
      <>
         <div
            onDoubleClick={onUse}
            onContextMenu={openMenu}
            className="group relative flex flex-col gap-3 rounded-lg border border-border bg-raised p-4 transition-colors hover:border-accent/40 select-none"
         >
            {/* Header: accent swatch + name + built-in badge */}
            <div className="flex items-center gap-2">
               <span
                  className="shrink-0 h-4 w-4 rounded-sm ring-1 ring-black/10"
                  style={{ background: template.docAccent } as CSSProperties}
               />
               <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{displayName}</span>
               {template.builtIn && (
                  <span className="shrink-0 flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[0.6rem] font-mono font-semibold text-accent">
                     <LayoutTemplate size={10} />
                     {t.templateBuiltIn}
                  </span>
               )}
            </div>

            {/* Scaffold preview: the meta field labels this template will seed, above / below the title */}
            {(above.length > 0 || below.length > 0) ? (
               <div className="flex flex-wrap gap-1.5">
                  {[...above, ...below].map(field => (
                     <span
                        key={field.id}
                        className="rounded border border-border px-1.5 py-0.5 text-[0.65rem] text-muted"
                        style={field.color === 'accent' ? ({ color: template.docAccent, borderColor: template.docAccent } as CSSProperties) : undefined}
                     >
                        {field.label}
                     </span>
                  ))}
               </div>
            ) : (
               <div className="text-[0.65rem] text-muted/60 italic">{t.templateNoFields}</div>
            )}

            {/* Format badge + Use action */}
            <div className="flex items-center justify-between gap-2 pt-1">
               <span className="rounded-md bg-border/40 px-2 py-0.5 text-[0.6rem] font-mono font-medium text-muted">{formatLabel}</span>
               <button
                  type="button"
                  onClick={onUse}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent transition-[filter] hover:brightness-110 cursor-pointer"
               >
                  <Wand2 size={13} />
                  {t.templateUse}
               </button>
            </div>

            <button
               type="button"
               aria-label="More actions"
               onClick={openMenu}
               className="absolute top-2 right-2 p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-opacity cursor-pointer"
            >
               <MoreHorizontal size={16} />
            </button>
         </div>

         {menuPosition && (
            <ContextMenu position={menuPosition} entries={entries} onClose={() => setMenuPosition(null)} className="min-w-[180px]" />
         )}
      </>
   )
}
