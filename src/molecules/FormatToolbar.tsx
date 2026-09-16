import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
// # CONSTANTS #
// #############

/** Minimum gap kept between a clamped floating element and the viewport edge. */
const CLAMP_MARGIN = 8

/** Vertical gap between the toolbar/trigger button and the panel/popover beneath it. */
const FLOATING_PANEL_GAP = 6

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

   const toolbarRef              = useRef<HTMLDivElement>(null)
   const toolbarInnerRef         = useRef<HTMLDivElement>(null)
   const linkPanelRef            = useRef<HTMLDivElement>(null)
   const fontColorButtonRef      = useRef<HTMLDivElement>(null)
   const highlightColorButtonRef = useRef<HTMLDivElement>(null)
   const savedRangeRef    = useRef<Range | null>(null)
   const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

   // Clamped position of the link-creator panel, relative to the toolbar's own box (its positioned
   // ancestor); recomputed whenever the panel mounts, see the layout effect below.
   const [linkPanelPos, setLinkPanelPos] = useState<Pos>({ top: 0, left: 0 })

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

            // Derive active colors from the selection start; boundary-correct so a freshly-applied
            // color reads back instead of the preceding (uncolored) run.
            const richElement = currentRange.startContainer instanceof HTMLElement
               ? currentRange.startContainer.closest<HTMLElement>('[data-rich]')
               : currentRange.startContainer.parentElement?.closest<HTMLElement>('[data-rich]')
            const activeColors = richElement
               ? deriveActiveColorsAt(richElement, currentRange.startContainer, currentRange.startOffset)
               : { fontColor: undefined, highlightColor: undefined }

            // Center on the selection midpoint, 44px above it, then clamp both axes so the toolbar
            // never renders partly off-screen. It is always mounted (opacity toggled), so its
            // measured box is real.
            const toolbarBoundingRect = toolbarInnerRef.current?.getBoundingClientRect()
            const toolbarWidth  = toolbarBoundingRect?.width  ?? 0
            const toolbarHeight = toolbarBoundingRect?.height ?? 0

            const desiredLeft = rect.left + rect.width / 2 - toolbarWidth / 2
            const desiredTop  = rect.top - 44

            const clampedLeft = Math.max(CLAMP_MARGIN, Math.min(desiredLeft, window.innerWidth  - toolbarWidth  - CLAMP_MARGIN))
            const clampedTop  = Math.max(CLAMP_MARGIN, Math.min(desiredTop,  window.innerHeight - toolbarHeight - CLAMP_MARGIN))

            // Whole pixels: a fractional translate lands the toolbar off the pixel grid, which the
            // browser blurs into what reads like an unwanted scale.
            setPos({ top: Math.round(clampedTop), left: Math.round(clampedLeft) })
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

   // ##############################################################
   // # LINK PANEL POSITION, VIEWPORT CLAMP (measured, two-sided) #
   // ##############################################################

   // Recomputed each time the link panel mounts (it remounts with linkMode, so its size is fresh):
   // measure its box, then clamp the centered-below-toolbar position so it never renders off-screen.
   useLayoutEffect(() => {
      if (!linkMode) return
      const panelElement   = linkPanelRef.current
      const toolbarElement = toolbarInnerRef.current
      if (!panelElement || !toolbarElement) return

      const toolbarBoundingRect = toolbarElement.getBoundingClientRect()
      const panelBoundingRect   = panelElement.getBoundingClientRect()

      const desiredLeft = toolbarBoundingRect.left + toolbarBoundingRect.width / 2 - panelBoundingRect.width / 2
      const desiredTop  = toolbarBoundingRect.bottom + FLOATING_PANEL_GAP

      const clampedLeft = Math.max(CLAMP_MARGIN, Math.min(desiredLeft, window.innerWidth  - panelBoundingRect.width  - CLAMP_MARGIN))
      const clampedTop  = Math.max(CLAMP_MARGIN, Math.min(desiredTop,  window.innerHeight - panelBoundingRect.height - CLAMP_MARGIN))

      // The panel is absolute against the toolbar, so convert the clamped viewport coords back into
      // an offset from the toolbar's box. Whole pixels, else a fractional offset blurs its text.
      setLinkPanelPos({
         top:  Math.round(clampedTop  - toolbarBoundingRect.top),
         left: Math.round(clampedLeft - toolbarBoundingRect.left),
      })
   }, [linkMode])

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
      // Outer div positions (translate), inner div animates (scale): kept separate so the two
      // transforms never conflict.
      <div
         ref={toolbarRef}
         className={`fixed z-9999 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
         style={{ top: 0, left: 0, transform: `translate(${pos.left}px, ${pos.top}px)` }}
         onMouseDown={event => event.preventDefault()}
      >
         <div
            ref={toolbarInnerRef}
            className={`relative flex flex-col rounded-lg shadow-xl border border-border bg-raised transition-[opacity,transform] duration-[120ms] ease-out ${
               visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.97]'
            }`}
         >
            <div className="flex items-center gap-0.5 px-1.5 py-1">

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

               <div className="w-px h-4 bg-border mx-1" />
               <button className={formatButtonClass(linkMode)} title={t.formatLink} onClick={openLinkMode}>
                  <Link size={13} />
               </button>

               <div className="w-px h-4 bg-border mx-1" />

               <div ref={fontColorButtonRef} className="relative">
                  <button
                     className={formatButtonClass(fontColorOpen)}
                     title={t.formatFontColor}
                     onClick={fontColorOpen ? closeFontColorPicker : openFontColorPicker}
                  >
                     <div className="flex flex-col items-center gap-px">
                        <Baseline size={11} />
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
                        anchorRef={fontColorButtonRef}
                        palette={FONT_COLOR_PALETTE}
                        recent={recentColors.color}
                        paletteLabel={t.paletteColors}
                        recentLabel={t.recentColors}
                        removeLabel={t.removeFontColor}
                        onApply={colorValue => applyInlineColor('color', colorValue)}
                        onClose={closeFontColorPicker}
                     />
                  )}
               </div>

               <div ref={highlightColorButtonRef} className="relative">
                  <button
                     className={formatButtonClass(highlightColorOpen)}
                     title={t.formatHighlightColor}
                     onClick={highlightColorOpen ? closeHighlightColorPicker : openHighlightColorPicker}
                  >
                     <div className="flex flex-col items-center gap-px">
                        <Highlighter size={11} />
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
                        anchorRef={highlightColorButtonRef}
                        palette={HIGHLIGHT_COLOR_PALETTE}
                        recent={recentColors.highlight}
                        paletteLabel={t.paletteColors}
                        recentLabel={t.recentColors}
                        removeLabel={t.removeHighlightColor}
                        onApply={colorValue => applyInlineColor('highlight', colorValue)}
                        onClose={closeHighlightColorPicker}
                     />
                  )}
               </div>
            </div>

            {linkMode && (
               <div
                  ref={linkPanelRef}
                  className="absolute w-72 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
                  style={{
                     top:       linkPanelPos.top,
                     left:      linkPanelPos.left,
                     animation: 'link-panel-in 120ms ease-out both',
                  }}
                  onKeyDown={event => { if (event.key === 'Escape') closeLinkMode() }}
               >
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
