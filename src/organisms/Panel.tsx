import { useState } from 'react'
import type { BlockType, Section } from '../types'
import { Button } from '../atoms/Button'
import { ColorPicker } from '../molecules/ColorPicker'
import { SectionItem } from '../molecules/SectionItem'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, PanelLeftClose, PanelLeftOpen, Palette, ChevronDown } from 'lucide-react'
import { useLang } from '../contexts/LangContext'
import { ACCENT_PRESETS } from '../lib/constants'

interface PanelProps {
   open: boolean
   onToggle: () => void
   sections: Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   onDocThemeChange:  (t: 'light' | 'dark') => void
   onDocAccentChange: (hex: string) => void
   onAddSection:    () => void
   onToggleSec:     (secId: string) => void
   onMoveSecUp:     (secId: string) => void
   onMoveSecDown:   (secId: string) => void
   onDuplicateSec:  (secId: string) => void
   onRemoveSec:     (secId: string) => void
   onAddBlock:    (secId: string, type: BlockType) => void
   onMoveBlkUp:   (secId: string, blkId: string) => void
   onMoveBlkDown: (secId: string, blkId: string) => void
   onRemoveBlk:   (secId: string, blkId: string) => void
   onReorderSections: (oldIdx: number, newIdx: number) => void
   onReorderBlocks:   (secId: string, oldIdx: number, newIdx: number) => void
}

export function Panel({
   open, onToggle,
   sections,
   docTheme, docAccent, onDocThemeChange, onDocAccentChange,
   onAddSection, onToggleSec, onMoveSecUp, onMoveSecDown, onDuplicateSec, onRemoveSec,
   onAddBlock, onMoveBlkUp, onMoveBlkDown, onRemoveBlk,
   onReorderSections, onReorderBlocks,
}: PanelProps) {
   const { t } = useLang()
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [pickerOpen, setPickerOpen] = useState(false)
   const [appearanceOpen, setAppearanceOpen] = useState(true)
   const isCustomAccent = !ACCENT_PRESETS.includes(docAccent)

   function handleDragEnd(event: DragEndEvent) {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = sections.findIndex(section => section.id === active.id)
      const newIdx = sections.findIndex(section => section.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) onReorderSections(oldIdx, newIdx)
   }

   if (!open) {
      return (
         <aside
            className="w-14 shrink-0 bg-raised border-r border-border border-t-2 border-t-accent/30 flex flex-col items-center p-2 h-full overflow-hidden"
            style={{ transition: 'width 0.2s ease' }}
         >
            <button
               onClick={onToggle}
               title={t.openPanel}
               className="text-muted hover:text-accent p-2.5 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
            >
               <PanelLeftOpen size={20} />
            </button>
         </aside>
      )
   }

   return (
      <aside
         className="w-80 shrink-0 bg-raised border-r border-border border-t-2 border-t-accent/30 flex flex-col h-full overflow-hidden"
         style={{ transition: 'width 0.2s ease' }}
      >
         {/* Menu header */}
         <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <span className="font-mono text-xs uppercase tracking-widest text-accent/70 font-semibold">{t.menu}</span>
            <button
               onClick={onToggle}
               title={t.collapsePanel}
               className="text-muted hover:text-accent p-2 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
            >
               <PanelLeftClose size={20} />
            </button>
         </div>

         {/* Appearance */}
         <div className="shrink-0 border-b border-border">
            <button
               onClick={() => { setAppearanceOpen(currentlyOpen => !currentlyOpen); if (appearanceOpen) setPickerOpen(false) }}
               className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/5 transition-colors cursor-pointer"
            >
               <span className="font-mono text-xs uppercase tracking-widest text-accent/70 font-semibold">{t.appearance}</span>
               <ChevronDown size={13} className={`text-muted transition-transform duration-200 ${appearanceOpen ? '' : '-rotate-90'}`} />
            </button>

            {appearanceOpen && <div className="px-4 pb-3 flex flex-col gap-3">
            {/* Doc theme toggle */}
            <div className="flex items-center justify-between mt-2">
               <span className="text-xs text-muted">{t.document}</span>
               <div className="flex gap-1">
                  {(['light', 'dark'] as const).map(themeOption => (
                     <button
                        key={themeOption}
                        onClick={() => onDocThemeChange(themeOption)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors border
                           ${docTheme === themeOption ? 'bg-accent/10 border-accent/50 text-accent' : 'border-border text-muted hover:text-text'}`}
                     >
                        {themeOption === 'light' ? t.light : t.dark}
                     </button>
                  ))}
               </div>
            </div>

            {/* Accent presets + custom swatch */}
            <div className="flex items-center justify-between">
               <span className="text-xs text-muted">{t.accent}</span>
               <div className="flex items-center gap-1.5">
                  {ACCENT_PRESETS.map(color => (
                     <button
                        key={color}
                        title={color}
                        onClick={() => { onDocAccentChange(color); setPickerOpen(false) }}
                        style={{ background: color }}
                        className={`w-4 h-4 rounded-full border-2 transition-all
                           ${docAccent === color ? 'border-text/70 scale-110' : 'border-transparent opacity-50 hover:opacity-90 hover:scale-105'}`}
                     />
                  ))}
                  <button
                     title={t.customColor}
                     onClick={() => setPickerOpen(currentlyOpen => !currentlyOpen)}
                     className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all
                        ${isCustomAccent ? 'border-text/70 scale-110' : 'border-border opacity-50 hover:opacity-90 hover:scale-105'}`}
                     style={isCustomAccent ? { background: docAccent } : {}}
                  >
                     {!isCustomAccent && <Palette size={9} className="text-muted pointer-events-none" />}
                  </button>
               </div>
            </div>

            {/* Full color picker (expanded on demand) */}
            {pickerOpen && (
               <ColorPicker value={docAccent} onChange={onDocAccentChange} />
            )}
            </div>}
         </div>

         {/* Structure header */}
         <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <span className="font-mono text-xs uppercase tracking-widest text-accent/70 font-semibold">{t.structure}</span>
            <Button variant="primary" size="sm" onClick={onAddSection}><Plus size={13} />{t.addSection}</Button>
         </div>

         {/* Scrollable list */}
         <div className="overflow-y-auto flex-1 min-h-0 p-3 flex flex-col gap-1.5 pb-0">
            {sections.length === 0 ? (
               <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
                  <div className="text-muted/15 text-5xl leading-none select-none">⊞</div>
                  <p className="text-muted text-xs font-mono leading-relaxed">
                     {t.noSections}<br />
                     <span className="text-accent/60">{t.noSectionsHint}</span>
                  </p>
               </div>
            ) : (
               <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={sections.map(section => section.id)} strategy={verticalListSortingStrategy}>
                     {sections.map((sec, index) => (
                        <SectionItem
                           key={sec.id}
                           section={sec}
                           index={index}
                           onToggle={()    => onToggleSec(sec.id)}
                           onMoveUp={()    => onMoveSecUp(sec.id)}
                           onMoveDown={()  => onMoveSecDown(sec.id)}
                           onDuplicate={() => onDuplicateSec(sec.id)}
                           onRemove={()    => onRemoveSec(sec.id)}
                           onAddBlock={type  => onAddBlock(sec.id, type)}
                           onMoveBlkUp={id   => onMoveBlkUp(sec.id, id)}
                           onMoveBlkDown={id => onMoveBlkDown(sec.id, id)}
                           onRemoveBlk={id   => onRemoveBlk(sec.id, id)}
                           onReorderBlocks={(oldIdx, newIdx) => onReorderBlocks(sec.id, oldIdx, newIdx)}
                        />
                     ))}
                  </SortableContext>
               </DndContext>
            )}
         </div>

         {/* Footer */}
         <div className="shrink-0 px-4 py-2.5 border-t border-border">
            <p className="font-mono text-xs text-muted/50 select-none">© 2026 Florian Douay</p>
         </div>
      </aside>
   )
}
