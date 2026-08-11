import { useState } from 'react'
import { LayoutTemplate, MoreHorizontal, Copy, Pencil, Trash2, Wand2, Download } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { DocumentTemplate } from '../../lib/documentTemplate'
import type { PageBand } from '../../lib/format'
import { useLang } from '../../contexts/LangContext'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'

interface TemplateCardProps {
   template:    DocumentTemplate
   onUse:       () => void
   onDuplicate: () => void
   onExport:    () => void
   onRename:    () => void
   onDelete:    () => void
}

/** One running-header-band slot worth surfacing as chrome: an image and/or text. */
interface ChromeBandItem {
   key:      'left' | 'center' | 'right'
   imageSrc?: string
   text?:     string
}

/** The band's `content` slots worth surfacing as distinguishing chrome (an image and/or text); a
 *  `pageNumber` or `credit` slot is skipped, neither tells two templates apart. */
function collectChromeBandItems(band: PageBand | undefined): ChromeBandItem[] {
   if (!band) return []
   const items: ChromeBandItem[] = []
   for (const position of ['left', 'center', 'right'] as const) {
      const item = band[position]
      if (!item || item.kind !== 'content') continue
      if (!item.image?.src && !item.text) continue
      items.push({ key: position, imageSrc: item.image?.src, text: item.text })
   }
   return items
}

/**
 * A template card: name + built-in badge, a scaffold preview (the accent swatch, the meta field
 * labels it will seed, and the page-format badge), a prominent "Use template" action, and an
 * overflow menu (Duplicate always; Rename / Delete only for user templates, since built-ins are
 * code-defined). Templates carry no content, so there is no live document preview like
 * DocumentCard has.
 */
export function TemplateCard({ template, onUse, onDuplicate, onExport, onRename, onDelete }: TemplateCardProps) {
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

   // Chrome the template carries beyond accent + format: watermark, title logo, running-header band
   // content. Surfaced so two templates that only differ in look aren't indistinguishable cards.
   const watermarkSrc = template.presentation?.watermark?.src
   const watermarkTile = template.presentation?.watermark?.tile === true
   const titleLogoSrc = template.presentation?.header?.src
   const headerBandItems = collectChromeBandItems(template.format?.header)
   const headerLogoSrc = headerBandItems.find(item => item.imageSrc)?.imageSrc
   const hasChromeRow = Boolean(titleLogoSrc) || headerBandItems.some(item => item.text)

   // `format.pages` is stripped at capture time (see documentTemplate.ts captureFormat), so this is
   // normally absent; only render the badge on the rare stored template that still carries pages.
   const pageCount = template.format?.pages && template.format.pages.length > 0
      ? template.format.pages.length + 1
      : undefined

   function openMenu(event: React.MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      setMenuPosition({ x: event.clientX, y: event.clientY })
   }

   const entries: ContextMenuEntry[] = [
      { label: t.templateUse,       icon: <Wand2 size={13} />,     onSelect: onUse },
      { label: t.binderDuplicate,   icon: <Copy size={13} />,      onSelect: onDuplicate },
      { label: t.templateExport,    icon: <Download size={13} />,  onSelect: onExport },
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
            className="group relative overflow-hidden rounded-lg border border-border bg-raised p-4 transition-colors hover:border-accent/40 select-none"
         >
            {/* Watermark, faint and full-bleed behind the card content, clipped to the rounded corners */}
            {watermarkSrc && (
               <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 opacity-[0.04] dark:opacity-[0.03]"
                  style={{
                     backgroundImage:    `url(${watermarkSrc})`,
                     backgroundRepeat:   watermarkTile ? 'repeat' : 'no-repeat',
                     backgroundSize:     watermarkTile ? '100px' : 'cover',
                     backgroundPosition: 'center',
                  } as CSSProperties}
               />
            )}

            <div className="relative z-10 flex flex-col gap-3">
               {/* Header: accent swatch + name, then built-in badge + header-band logo opposite the name */}
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
                  {headerLogoSrc && (
                     <img
                        src={headerLogoSrc}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        title={t.templateChromeHeader}
                        className="shrink-0 h-6 w-6 rounded-md border border-border object-contain pointer-events-none"
                     />
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

               {/* Chrome preview: title logo / running-header band text, only when present. The watermark
                   renders as the card background above, and the header-band logo moved into the identity
                   row, so this row is left with just the title logo thumbnail and/or header text chip. */}
               {hasChromeRow && (
                  <div className="flex flex-wrap items-center gap-1.5">
                     {titleLogoSrc && (
                        <img
                           src={titleLogoSrc}
                           alt=""
                           aria-hidden="true"
                           draggable={false}
                           title={t.templateChromeLogo}
                           className="h-6 w-6 shrink-0 rounded-md border border-border object-contain pointer-events-none"
                        />
                     )}
                     {headerBandItems.map(item => (
                        item.text && (
                           <span
                              key={item.key}
                              title={t.templateChromeHeader}
                              className="max-w-[6rem] truncate rounded-md border border-border px-1.5 py-0.5 text-[0.6rem] text-muted"
                           >
                              {item.text}
                           </span>
                        )
                     ))}
                  </div>
               )}

               {/* Format badge + Use action */}
               <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5">
                     <span className="rounded-md bg-border/40 px-2 py-0.5 text-[0.6rem] font-mono font-medium text-muted">{formatLabel}</span>
                     {pageCount !== undefined && (
                        <span className="rounded-md bg-border/40 px-2 py-0.5 text-[0.6rem] font-mono font-medium text-muted">
                           {pageCount} {t.templatePagesLabel}
                        </span>
                     )}
                  </div>
                  <button
                     type="button"
                     onClick={onUse}
                     className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent transition-[filter] hover:brightness-110 cursor-pointer"
                  >
                     <Wand2 size={13} />
                     {t.templateUse}
                  </button>
               </div>
            </div>

            <button
               type="button"
               aria-label="More actions"
               onClick={openMenu}
               className="absolute top-2 right-2 z-10 p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-opacity cursor-pointer"
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
