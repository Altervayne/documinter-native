import { useEffect, useRef, useState } from 'react'
import {
   Bold, Italic, Underline, Strikethrough,
   Link, Link2Off, Baseline, Highlighter, CornerDownLeft,
} from 'lucide-react'
import type { FormatState, Section } from '../types'
import { blockAnchor } from '../lib/document'
import { deriveActiveColorsAt } from '../lib/inlineFormatting'
import { execFormatCommand } from '../lib/execCommand'
import { FONT_COLOR_PALETTE, HIGHLIGHT_COLOR_PALETTE } from '../lib/constants'
import { useLang } from '../contexts/LangContext'
import { useLinkMode, getAnchoredBlocks } from '../hooks/useLinkMode'
import { useInlineColorPicker } from '../hooks/useInlineColorPicker'
import { InlineColorPopover } from './InlineColorPopover'

// ######################
// # EXECCOMMAND HELPER #
// ######################

function applyBoldItalic() {
   const isBold   = document.queryCommandState('bold')
   const isItalic = document.queryCommandState('italic')
   if (isBold && isItalic) {
      execFormatCommand('bold')
      execFormatCommand('italic')
   } else {
      if (!isBold)   execFormatCommand('bold')
      if (!isItalic) execFormatCommand('italic')
   }
}

// #########
// # TYPES #
// #########

interface Pos { top: number; left: number }

interface FormatToolbarProps {
   sections: Section[]
}

// #############
// # COMPONENT #
// #############

export function FormatToolbar({ sections }: FormatToolbarProps) {
   const { t } = useLang()

   const [pos, setPos]         = useState<Pos>({ top: 0, left: 0 })
   const [visible, setVisible] = useState(false)
   const [formatState, setFormatState] = useState<FormatState>({
      bold: false, italic: false, underline: false, strikethrough: false,
      fontColor: undefined, highlightColor: undefined,
   })

   const toolbarRef       = useRef<HTMLDivElement>(null)
   const savedRangeRef    = useRef<Range | null>(null)
   const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

   const {
      linkMode, linkUrl, setLinkUrl, isEditingExistingLink, inputRef,
      linkModeRef, openLinkMode, closeLinkMode, applyLink, removeLink,
   } = useLinkMode({ savedRangeRef, visible })

   const {
      fontColorOpen, highlightColorOpen, fontColorOpenRef, highlightColorOpenRef,
      recentColors, openFontColorPicker, openHighlightColorPicker,
      closeFontColorPicker, closeHighlightColorPicker, applyInlineColor,
   } = useInlineColorPicker({ savedRangeRef, setFormatState })

   // ##########################################################################
   // # ORCHESTRATOR EFFECT, TOOLBAR VISIBILITY, POSITION, ACTIVE-FORMAT READ #
   // ##########################################################################

   useEffect(() => {
      function onSelChange() {
         // While the URL input or a color picker is focused, the contenteditable
         // selection collapses. Bail out so the toolbar stays visible.
         if (linkModeRef.current) return
         if (fontColorOpenRef.current || highlightColorOpenRef.current) return

         if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

         const sel = window.getSelection()
         if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            setVisible(false)
            return
         }
         const inRich = sel.anchorNode?.parentElement?.closest('[data-rich]')
         if (!inRich) {
            setVisible(false)
            return
         }

         // Debounce position updates to prevent jitter during active selection
         debounceTimerRef.current = setTimeout(() => {
            const currentSel = window.getSelection()
            if (!currentSel || currentSel.isCollapsed || currentSel.rangeCount === 0) {
               setVisible(false)
               return
            }
            const currentRange = currentSel.getRangeAt(0)
            const rect = currentRange.getBoundingClientRect()
            if (!rect.width) { setVisible(false); return }

            // Derive active colors from the start of the selection. Boundary-correct
            // resolution ensures a freshly-applied color reads back instead of the
            // preceding (uncolored) run.
            const richElement = currentRange.startContainer instanceof HTMLElement
               ? currentRange.startContainer.closest<HTMLElement>('[data-rich]')
               : currentRange.startContainer.parentElement?.closest<HTMLElement>('[data-rich]')
            const activeColors = richElement
               ? deriveActiveColorsAt(richElement, currentRange.startContainer, currentRange.startOffset)
               : { fontColor: undefined, highlightColor: undefined }

            setPos({ top: rect.top - 44, left: rect.left + rect.width / 2 })
            setFormatState({
               bold:           document.queryCommandState('bold'),
               italic:         document.queryCommandState('italic'),
               underline:      document.queryCommandState('underline'),
               strikethrough:  document.queryCommandState('strikeThrough'),
               fontColor:      activeColors.fontColor,
               highlightColor: activeColors.highlightColor,
            })
            setVisible(true)
         }, 40)
      }

      // Dismiss link mode or color pickers when the user clicks outside the toolbar
      function onOutsideMouseDown(event: MouseEvent) {
         if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
            if (linkModeRef.current) closeLinkMode()
            if (fontColorOpenRef.current)      closeFontColorPicker()
            if (highlightColorOpenRef.current) closeHighlightColorPicker()
         }
      }

      document.addEventListener('selectionchange', onSelChange)
      document.addEventListener('mousedown', onOutsideMouseDown)
      return () => {
         document.removeEventListener('selectionchange', onSelChange)
         document.removeEventListener('mousedown', onOutsideMouseDown)
         if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      }
   }, [linkModeRef, fontColorOpenRef, highlightColorOpenRef, closeLinkMode, closeFontColorPicker, closeHighlightColorPicker])

   // ########################
   // # FORMAT STATE HELPERS #
   // ########################

   function refreshFormatState() {
      setFormatState(previous => ({
         bold:           document.queryCommandState('bold'),
         italic:         document.queryCommandState('italic'),
         underline:      document.queryCommandState('underline'),
         strikethrough:  document.queryCommandState('strikeThrough'),
         // Preserve color state, format button clicks don't change colors
         fontColor:      previous.fontColor,
         highlightColor: previous.highlightColor,
      }))
   }

   function formatButtonClass(active: boolean): string {
      return `w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
         active
            ? 'text-accent bg-accent/15'
            : 'text-muted hover:text-text hover:bg-accent/10'
      }`
   }

   // ##########
   // # RENDER #
   // ##########

   return (
      // Outer div: handles fixed positioning only.
      // Inner div: handles visual appearance + enter/exit animation.
      // Keeping them separate avoids a transform conflict between the
      // positioning translate and the animation scale.
      <div
         ref={toolbarRef}
         className={`fixed z-9999 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
         style={{ top: 0, left: 0, transform: `translate(calc(${pos.left}px - 50%), ${pos.top}px)` }}
         onMouseDown={event => event.preventDefault()}
      >
         <div
            className={`relative flex flex-col rounded-lg shadow-xl border border-border bg-raised transition-[opacity,transform] duration-[120ms] ease-out ${
               visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.97]'
            }`}
         >
            {/* ==================== */}
            {/*  Toolbar buttons row */}
            {/* ==================== */}
            <div className="flex items-center gap-0.5 px-1.5 py-1">

               {/* Formatting group */}
               <button className={formatButtonClass(formatState.bold)}   title={t.formatBold}         onClick={() => { execFormatCommand('bold');   refreshFormatState() }}>
                  <Bold size={13} />
               </button>
               <button className={formatButtonClass(formatState.italic)} title={t.formatItalic}       onClick={() => { execFormatCommand('italic'); refreshFormatState() }}>
                  <Italic size={13} />
               </button>
               <button
                  className={formatButtonClass(formatState.bold && formatState.italic)}
                  title={t.formatBoldItalic}
                  onClick={() => { applyBoldItalic(); refreshFormatState() }}
                  style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontStyle: 'italic', fontSize: '0.68rem' }}
               >
                  BI
               </button>

               <div className="w-px h-4 bg-border mx-1" />

               <button className={formatButtonClass(formatState.underline)}     title={t.formatUnderline}     onClick={() => { execFormatCommand('underline');    refreshFormatState() }}>
                  <Underline size={13} />
               </button>
               <button className={formatButtonClass(formatState.strikethrough)} title={t.formatStrikethrough} onClick={() => { execFormatCommand('strikeThrough'); refreshFormatState() }}>
                  <Strikethrough size={13} />
               </button>

               {/* Link group */}
               <div className="w-px h-4 bg-border mx-1" />
               <button className={formatButtonClass(linkMode)} title={t.formatLink} onClick={openLinkMode}>
                  <Link size={13} />
               </button>

               {/* Color buttons */}
               <div className="w-px h-4 bg-border mx-1" />

               {/* Font color button */}
               <div className="relative">
                  <button
                     className={formatButtonClass(fontColorOpen)}
                     title={t.formatFontColor}
                     onClick={fontColorOpen ? closeFontColorPicker : openFontColorPicker}
                  >
                     <div className="flex flex-col items-center gap-px">
                        <Baseline size={11} />
                        {/* Active color underline indicator */}
                        <div
                           className="w-3.5 rounded-sm"
                           style={{
                              height:          2,
                              backgroundColor: formatState.fontColor ?? 'transparent',
                              border:          formatState.fontColor ? 'none' : '1px solid var(--color-border)',
                           }}
                        />
                     </div>
                  </button>
                  {fontColorOpen && (
                     <InlineColorPopover
                        activeColor={formatState.fontColor}
                        palette={FONT_COLOR_PALETTE}
                        recent={recentColors.color}
                        recentLabel={t.recentColors}
                        removeLabel={t.removeFontColor}
                        onApply={colorValue => applyInlineColor('color', colorValue)}
                        onClose={closeFontColorPicker}
                     />
                  )}
               </div>

               {/* Highlight color button */}
               <div className="relative">
                  <button
                     className={formatButtonClass(highlightColorOpen)}
                     title={t.formatHighlightColor}
                     onClick={highlightColorOpen ? closeHighlightColorPicker : openHighlightColorPicker}
                  >
                     <div className="flex flex-col items-center gap-px">
                        <Highlighter size={11} />
                        {/* Active color underline indicator */}
                        <div
                           className="w-3.5 rounded-sm"
                           style={{
                              height:          2,
                              backgroundColor: formatState.highlightColor ?? 'transparent',
                              border:          formatState.highlightColor ? 'none' : '1px solid var(--color-border)',
                           }}
                        />
                     </div>
                  </button>
                  {highlightColorOpen && (
                     <InlineColorPopover
                        activeColor={formatState.highlightColor}
                        palette={HIGHLIGHT_COLOR_PALETTE}
                        recent={recentColors.highlight}
                        recentLabel={t.recentColors}
                        removeLabel={t.removeHighlightColor}
                        onApply={colorValue => applyInlineColor('highlight', colorValue)}
                        onClose={closeHighlightColorPicker}
                     />
                  )}
               </div>
            </div>

            {/* =================== */}
            {/*  Link creator panel */}
            {/* =================== */}
            {linkMode && (
               <div
                  className="absolute w-72 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
                  style={{
                     top: 'calc(100% + 6px)',
                     left: '50%',
                     transform: 'translateX(-50%)',
                     animation: 'link-panel-in 120ms ease-out both',
                  }}
                  onKeyDown={event => { if (event.key === 'Escape') closeLinkMode() }}
               >
                  {/* URL input */}
                  <div className="px-3 pt-3 pb-2.5">
                     <div className="text-muted/70 text-[0.6rem] font-mono uppercase tracking-wider mb-1.5">
                        {t.linkPanelUrl}
                     </div>
                     <input
                        ref={inputRef}
                        type="url"
                        placeholder="https://…"
                        value={linkUrl}
                        onChange={event => setLinkUrl(event.target.value)}
                        onKeyDown={event => {
                           if (event.key === 'Enter')  applyLink()
                           if (event.key === 'Escape') closeLinkMode()
                        }}
                        className="w-full bg-el border border-border rounded-md px-3 py-1.5 text-sm text-text outline-none focus:border-accent transition-colors placeholder:text-muted/50"
                     />
                  </div>

                  {/* Block anchor list */}
                  {getAnchoredBlocks(sections).length > 0 && (
                     <div className="border-t border-border">
                        <div className="text-muted/70 text-[0.6rem] font-mono uppercase tracking-wider px-3 pt-2 pb-1">
                           {t.linkPanelJumpToBlock}
                        </div>
                        <div className="max-h-28 overflow-y-auto px-1.5 pb-1.5">
                           {getAnchoredBlocks(sections).map(({ block, sectionIndex }) => {
                              const isActive = linkUrl === `#${blockAnchor(block)}`
                              return (
                                 <button
                                    key={block.id}
                                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left transition-colors cursor-pointer ${
                                       isActive
                                          ? 'bg-accent/10 text-text'
                                          : 'text-text/65 hover:text-text hover:bg-accent/10'
                                    }`}
                                    onClick={() => {
                                       const sel = window.getSelection()
                                       if (savedRangeRef.current) { sel?.removeAllRanges(); sel?.addRange(savedRangeRef.current) }
                                       execFormatCommand('createLink', `#${blockAnchor(block)}`)
                                       closeLinkMode()
                                    }}
                                 >
                                    <span className="font-mono text-[0.6rem] text-muted/50 w-5 shrink-0 text-right">
                                       {String(sectionIndex + 1).padStart(2, '0')}
                                    </span>
                                    <span className="truncate">#{block.handle}</span>
                                 </button>
                              )
                           })}
                        </div>
                     </div>
                  )}

                  {/* Section anchor list */}
                  {sections.length > 0 && (
                     <div className="border-t border-border">
                        <div className="text-muted/70 text-[0.6rem] font-mono uppercase tracking-wider px-3 pt-2 pb-1">
                           {t.linkPanelJumpToSection}
                        </div>
                        <div className="max-h-28 overflow-y-auto px-1.5 pb-1.5">
                           {sections.map((section, sectionIndex) => {
                              const isActive = linkUrl === `#section-${section.id}`
                              return (
                                 <button
                                    key={section.id}
                                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left transition-colors cursor-pointer ${
                                       isActive
                                          ? 'bg-accent/10 text-text'
                                          : 'text-text/65 hover:text-text hover:bg-accent/10'
                                    }`}
                                    onClick={() => {
                                       const sel = window.getSelection()
                                       if (savedRangeRef.current) { sel?.removeAllRanges(); sel?.addRange(savedRangeRef.current) }
                                       execFormatCommand('createLink', `#section-${section.id}`)
                                       closeLinkMode()
                                    }}
                                 >
                                    <span className="font-mono text-[0.6rem] text-muted/50 w-5 shrink-0 text-right">
                                       {String(sectionIndex + 1).padStart(2, '0')}
                                    </span>
                                    <span className="truncate">{section.title || `${t.linkPanelSectionFallback} ${sectionIndex + 1}`}</span>
                                 </button>
                              )
                           })}
                        </div>
                     </div>
                  )}

                  {/* Action row */}
                  <div className="border-t border-border px-3 py-2.5 flex items-center justify-between">
                     <button
                        className="text-sm text-muted hover:text-text transition-colors cursor-pointer"
                        onClick={closeLinkMode}
                     >
                        {t.linkPanelCancel}
                     </button>
                     <div className="flex items-center gap-2">
                        {isEditingExistingLink && (
                           <button
                              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-red/70 hover:text-red hover:bg-red/10 transition-colors cursor-pointer"
                              onClick={removeLink}
                           >
                              <Link2Off size={12} />
                              {t.linkPanelRemove}
                           </button>
                        )}
                        <button
                           className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium bg-accent hover:bg-accent/90 text-on-accent transition-colors cursor-pointer"
                           onClick={applyLink}
                        >
                           <CornerDownLeft size={12} />
                           {t.linkPanelApply}
                        </button>
                     </div>
                  </div>
               </div>
            )}
         </div>
      </div>
   )
}
