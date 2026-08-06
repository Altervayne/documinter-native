// -- React Imports --
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

// -- Library Imports --
import { createPortal } from 'react-dom'
import { FilePlus, LayoutTemplate, Sun, Moon, Infinity as InfinityIcon, RectangleVertical, RectangleHorizontal } from 'lucide-react'

// -- Type Imports --
import type { DocumentTemplate } from '../lib/documentTemplate'
import type { DocFormat, PageKind } from '../lib/format'

// -- Lib Imports --
import { DEFAULT_DOC_ACCENT } from '../lib/documentTemplate'

// -- Hook Imports --
import { useTemplates } from '../hooks/useTemplates'
import { useLang } from '../contexts/LangContext'

// -- Component Imports --
import { Button } from '../atoms/Button'
import { ColorSwatchField } from './ColorSwatchField'
import { SegmentedIconToggle } from '../atoms/SegmentedIconToggle'

// #########
// # TYPES #
// #########

/** The chrome choices the dialog returns; App layers these onto a blank or template-seeded doc. */
export interface NewDocumentChoice {
   accent: string
   theme:  'light' | 'dark'
   format: DocFormat | undefined
}

interface NewDocumentDialogProps {
   /** Create the document: `template` is null for a blank start, else the chosen template; the
    *  choice carries the (possibly overridden) accent / theme / format to apply on top. */
   onCreate: (template: DocumentTemplate | null, choice: NewDocumentChoice) => void
   onCancel: () => void
}

const BLANK_ID = 'blank'

// #############
// # HELPERS   #
// #############

/** The base chrome settings for a selectable entry: a template's own values, or the blank defaults. */
function baseChoiceFor(template: DocumentTemplate | null): NewDocumentChoice {
   if (!template) return { accent: DEFAULT_DOC_ACCENT, theme: 'light', format: undefined }
   return { accent: template.docAccent, theme: template.docTheme, format: template.format }
}

// #############
// # COMPONENT #
// #############

/**
 * The single "New document" entry point: pick a starting template (or Blank) on the left, then
 * speed through or tweak the accent / theme / page format on the right before creating.
 * Document-level, so it renders as a modal (document dialogs are modals; per-block editing uses
 * windows). Rendered inside App's LangProvider, so it can load the templates list itself via
 * useTemplates.
 */
export function NewDocumentDialog({ onCreate, onCancel }: NewDocumentDialogProps) {
   const { t } = useLang()
   // The dialog only reads the list; it never mutates templates, so onChanged is a no-op.
   const { templates, isLoading } = useTemplates(0, () => {})

   const [selectedId, setSelectedId] = useState<string>(BLANK_ID)
   const [choice, setChoice]         = useState<NewDocumentChoice>(baseChoiceFor(null))

   useEffect(() => {
      function handleKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onCancel()
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [onCancel])

   const selectedTemplate = selectedId === BLANK_ID ? null : templates.find(template => template.id === selectedId) ?? null

   // Selecting an entry resets the tweakable settings to that entry's own chrome; later edits layer
   // on top until the next selection.
   function selectEntry(template: DocumentTemplate | null) {
      setSelectedId(template?.id ?? BLANK_ID)
      setChoice(baseChoiceFor(template))
   }

   // The segmented format control works in page-kind terms; switching kind keeps the selected
   // template's margins when the kind still matches, else falls back to a bare kind (default margins).
   const formatKind: PageKind = choice.format?.kind ?? 'infinite'
   function setFormatKind(kind: PageKind) {
      if (kind === 'infinite') { setChoice(current => ({ ...current, format: undefined })); return }
      const templateFormat = selectedTemplate?.format
      const next = templateFormat?.kind === kind ? templateFormat : { kind }
      setChoice(current => ({ ...current, format: next }))
   }

   const displayName = (template: DocumentTemplate) =>
      template.builtIn && template.id === 'builtin-default' ? t.templateBuiltinDefault : template.name

   const scaffoldFields = selectedTemplate?.meta.fields ?? []

   return createPortal(
      <div
         className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-4"
         onMouseDown={onCancel}
      >
         <div
            className="w-full max-w-2xl rounded-lg border border-border bg-raised shadow-xl overflow-hidden flex flex-col"
            style={{ animation: 'menu-in 120ms ease-out both' }}
            onMouseDown={event => event.stopPropagation()}
         >
            <div className="px-4 pt-4 pb-3 border-b border-border text-sm font-semibold text-text">{t.newDocument}</div>

            <div className="flex min-h-0" style={{ height: '22rem' }}>
               {/* Left: template rail (Blank first, then built-ins + user templates) */}
               <div className="w-56 shrink-0 border-r border-border overflow-y-auto p-2 flex flex-col gap-1">
                  <TemplateRow
                     label={t.newDocumentBlank}
                     icon={<FilePlus size={14} className="shrink-0 text-muted" />}
                     selected={selectedId === BLANK_ID}
                     onSelect={() => selectEntry(null)}
                  />
                  {!isLoading && templates.length > 0 && <div className="my-1 h-px bg-border mx-1" />}
                  {templates.map(template => (
                     <TemplateRow
                        key={template.id}
                        label={displayName(template)}
                        icon={<span className="shrink-0 h-3 w-3 rounded-sm ring-1 ring-black/10" style={{ background: template.docAccent } as CSSProperties} />}
                        badge={template.builtIn ? <LayoutTemplate size={11} className="shrink-0 text-accent" /> : undefined}
                        selected={selectedId === template.id}
                        onSelect={() => selectEntry(template)}
                     />
                  ))}
               </div>

               {/* Right: scaffold preview + the tweakable settings */}
               <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  <div>
                     <div className="text-xs font-medium text-muted mb-1.5">{t.newDocumentFields}</div>
                     {scaffoldFields.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                           {scaffoldFields.map(field => (
                              <span
                                 key={field.id}
                                 className="rounded border border-border px-1.5 py-0.5 text-[0.65rem] text-muted"
                                 style={field.color === 'accent' ? ({ color: choice.accent, borderColor: choice.accent } as CSSProperties) : undefined}
                              >
                                 {field.label}
                              </span>
                           ))}
                        </div>
                     ) : (
                        <div className="text-[0.7rem] text-muted/60 italic">{t.templateNoFields}</div>
                     )}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                     <span className="text-xs font-medium text-text">{t.accent}</span>
                     <ColorSwatchField
                        value={choice.accent}
                        title={t.accent}
                        ariaLabel={t.accent}
                        onChange={hex => setChoice(current => ({ ...current, accent: hex }))}
                     />
                  </div>

                  <div className="flex flex-col gap-1.5">
                     <span className="text-xs font-medium text-text">{t.theme}</span>
                     <SegmentedIconToggle
                        ariaLabel={t.theme}
                        value={choice.theme}
                        onChange={theme => setChoice(current => ({ ...current, theme }))}
                        options={[
                           { value: 'light', label: t.light, icon: <Sun size={13} /> },
                           { value: 'dark',  label: t.dark,  icon: <Moon size={13} /> },
                        ]}
                     />
                  </div>

                  <div className="flex flex-col gap-1.5">
                     <span className="text-xs font-medium text-text">{t.formatKindLabel}</span>
                     <SegmentedIconToggle
                        ariaLabel={t.formatKindLabel}
                        value={formatKind}
                        onChange={setFormatKind}
                        options={[
                           { value: 'infinite',     label: t.formatKindInfinite,    icon: <InfinityIcon size={13} /> },
                           { value: 'a4-portrait',  label: t.formatKindA4Portrait,  icon: <RectangleVertical size={13} /> },
                           { value: 'a4-landscape', label: t.formatKindA4Landscape, icon: <RectangleHorizontal size={13} /> },
                        ]}
                     />
                  </div>
               </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
               <Button size="sm" variant="ghost" onClick={onCancel}>{t.binderUnsavedCancel}</Button>
               <Button size="sm" variant="primary" onClick={() => onCreate(selectedTemplate, choice)}>{t.newDocumentCreate}</Button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

// ##################################
// # SHARED PRIMITIVES (FILE-LOCAL) #
// ##################################

interface TemplateRowProps {
   label:    string
   icon:     React.ReactNode
   badge?:   React.ReactNode
   selected: boolean
   onSelect: () => void
}

function TemplateRow({ label, icon, badge, selected, onSelect }: TemplateRowProps) {
   return (
      <button
         type="button"
         onClick={onSelect}
         className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-left transition-colors cursor-pointer ${
            selected ? 'bg-accent/10 text-accent' : 'text-text/80 hover:text-text hover:bg-border/50'
         }`}
      >
         {icon}
         <span className="min-w-0 flex-1 truncate">{label}</span>
         {badge}
      </button>
   )
}
