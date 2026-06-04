import { useEffect, useRef, useState } from 'react'
import {
   Bold, Italic, Underline, Strikethrough,
   Link, Link2Off, Baseline, Highlighter, CornerDownLeft,
} from 'lucide-react'
import type { Block, Section } from '../types'
import { blockAnchor } from '../lib/document'

// ============================================================
// Helpers
// ============================================================

interface AnchoredBlock {
   block:        Block
   sectionIndex: number
}

function getAnchoredBlocks(sections: Section[]): AnchoredBlock[] {
   const result: AnchoredBlock[] = []
   for (const [sectionIndex, section] of sections.entries()) {
      for (const block of section.blocks) {
         if (block.handle) result.push({ block, sectionIndex })
         for (const inner of [...(block.left ?? []), ...(block.right ?? [])]) {
            if (inner.handle) result.push({ block: inner, sectionIndex })
         }
      }
   }
   return result
}

// execCommand is deprecated but remains the practical cross-browser solution
// for formatting in contenteditable. All major browsers still support it.
function cmd(command: string, value?: string) {
   document.execCommand(command, false, value ?? undefined)
}

function applyBoldItalic() {
   const isBold   = document.queryCommandState('bold')
   const isItalic = document.queryCommandState('italic')
   if (isBold && isItalic) {
      cmd('bold')
      cmd('italic')
   } else {
      if (!isBold)   cmd('bold')
      if (!isItalic) cmd('italic')
   }
}

// ============================================================
// Types
// ============================================================

interface Pos { top: number; left: number }

interface FormatState {
   bold:          boolean
   italic:        boolean
   underline:     boolean
   strikethrough: boolean
}

interface FormatToolbarProps {
   sections: Section[]
}

// ============================================================
// Component
// ============================================================

export function FormatToolbar({ sections }: FormatToolbarProps) {
   const [pos, setPos]             = useState<Pos>({ top: 0, left: 0 })
   const [visible, setVisible]     = useState(false)
   const [linkMode, setLinkMode]   = useState(false)
   const [linkUrl, setLinkUrl]     = useState('')
   const [formatState, setFormatState] = useState<FormatState>({
      bold: false, italic: false, underline: false, strikethrough: false,
   })
   const [isEditingExistingLink, setIsEditingExistingLink] = useState(false)

   const toolbarRef        = useRef<HTMLDivElement>(null)
   const inputRef          = useRef<HTMLInputElement>(null)
   const savedRange        = useRef<Range | null>(null)
   const linkModeRef       = useRef(false)
   const pendingLinkOpen   = useRef(false)
   const pendingLinkAnchor = useRef<HTMLAnchorElement | null>(null)
   const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

   // ============================================================
   // Link mode helpers
   // ============================================================

   function openLinkMode() {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
      const existingLink = pendingLinkAnchor.current
         ?? sel?.anchorNode?.parentElement?.closest('a')
      pendingLinkAnchor.current = null
      setIsEditingExistingLink(!!existingLink)
      setLinkUrl(existingLink?.getAttribute('href') ?? '')
      linkModeRef.current = true
      setLinkMode(true)
   }

   function closeLinkMode() {
      linkModeRef.current = false
      setLinkMode(false)
      setLinkUrl('')
      setIsEditingExistingLink(false)
   }

   function applyLink() {
      const sel = window.getSelection()
      if (savedRange.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRange.current)
      }
      if (linkUrl.trim()) cmd('createLink', linkUrl.trim())
      closeLinkMode()
   }

   function removeLink() {
      const sel = window.getSelection()
      if (savedRange.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRange.current)
      }
      cmd('unlink')
      closeLinkMode()
   }

   // ============================================================
   // Effects
   // ============================================================

   useEffect(() => {
      function onSelChange() {
         // While the URL input is focused, the contenteditable selection collapses.
         // Bail out so the toolbar stays visible until the user confirms or cancels.
         if (linkModeRef.current) return

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
            const rect = currentSel.getRangeAt(0).getBoundingClientRect()
            if (!rect.width) { setVisible(false); return }

            setPos({ top: rect.top - 44, left: rect.left + rect.width / 2 })
            setFormatState({
               bold:          document.queryCommandState('bold'),
               italic:        document.queryCommandState('italic'),
               underline:     document.queryCommandState('underline'),
               strikethrough: document.queryCommandState('strikeThrough'),
            })
            setVisible(true)
         }, 40)
      }

      // Clicking on an <a> inside a rich contenteditable auto-selects the link
      // and opens the link panel, so the user doesn't have to precisely drag-select.
      function onDocClick(event: MouseEvent) {
         const anchor = (event.target as Element).closest('a')
         if (!anchor?.closest('[data-rich]')) return
         event.preventDefault()
         const range = document.createRange()
         range.selectNodeContents(anchor)
         const sel = window.getSelection()
         sel?.removeAllRanges()
         sel?.addRange(range)
         pendingLinkAnchor.current = anchor as HTMLAnchorElement
         pendingLinkOpen.current = true
         // selectionchange fires next, sets pos, then useEffect([visible]) opens link mode
      }

      // Dismiss link mode when the user clicks outside the toolbar
      function onOutsideMouseDown(event: MouseEvent) {
         if (!linkModeRef.current) return
         if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
            closeLinkMode()
         }
      }

      document.addEventListener('selectionchange', onSelChange)
      document.addEventListener('click', onDocClick)
      document.addEventListener('mousedown', onOutsideMouseDown)
      return () => {
         document.removeEventListener('selectionchange', onSelChange)
         document.removeEventListener('click', onDocClick)
         document.removeEventListener('mousedown', onOutsideMouseDown)
         if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      }
   }, [])

   // After a link-click sets pendingLinkOpen, wait for the toolbar to become visible,
   // then open link mode so the panel appears with the href pre-filled.
   useEffect(() => {
      if (visible && pendingLinkOpen.current) {
         pendingLinkOpen.current = false
         // eslint-disable-next-line react-hooks/set-state-in-effect
         openLinkMode()
      }
   }, [visible])

   // Focus the URL input whenever link mode opens
   useEffect(() => {
      if (linkMode) inputRef.current?.focus()
   }, [linkMode])

   // ============================================================
   // Button class helper
   // ============================================================

   function formatButtonClass(active: boolean): string {
      return `w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
         active
            ? 'text-accent bg-accent/15'
            : 'text-muted hover:text-text hover:bg-accent/10'
      }`
   }

   // ============================================================
   // Render
   // ============================================================

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
            {/* ── Toolbar buttons row ─────────────────────────── */}
            <div className="flex items-center gap-0.5 px-1.5 py-1">

               {/* Formatting group */}
               <button className={formatButtonClass(formatState.bold)}   title="Bold"         onClick={() => cmd('bold')}>
                  <Bold size={13} />
               </button>
               <button className={formatButtonClass(formatState.italic)} title="Italic"       onClick={() => cmd('italic')}>
                  <Italic size={13} />
               </button>
               <button
                  className={formatButtonClass(formatState.bold && formatState.italic)}
                  title="Bold + Italic"
                  onClick={applyBoldItalic}
                  style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontStyle: 'italic', fontSize: '0.68rem' }}
               >
                  BI
               </button>

               <div className="w-px h-4 bg-border mx-1" />

               <button className={formatButtonClass(formatState.underline)}     title="Underline"     onClick={() => cmd('underline')}>
                  <Underline size={13} />
               </button>
               <button className={formatButtonClass(formatState.strikethrough)} title="Strikethrough" onClick={() => cmd('strikeThrough')}>
                  <Strikethrough size={13} />
               </button>

               {/* Link group */}
               <div className="w-px h-4 bg-border mx-1" />
               <button className={formatButtonClass(linkMode)} title="Link" onClick={openLinkMode}>
                  <Link size={13} />
               </button>

               {/* Color placeholders — slots reserved for font color and highlight color */}
               <div className="w-px h-4 bg-border mx-1" />
               <button
                  className="w-7 h-7 flex items-center justify-center rounded-md text-muted opacity-40 cursor-not-allowed"
                  title="Font color (coming soon)"
                  disabled
               >
                  <Baseline size={13} />
               </button>
               <button
                  className="w-7 h-7 flex items-center justify-center rounded-md text-muted opacity-40 cursor-not-allowed"
                  title="Highlight color (coming soon)"
                  disabled
               >
                  <Highlighter size={13} />
               </button>
            </div>

            {/* ── Link creator panel ──────────────────────────── */}
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
                        URL
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
                           Jump to block
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
                                       if (savedRange.current) { sel?.removeAllRanges(); sel?.addRange(savedRange.current) }
                                       cmd('createLink', `#${blockAnchor(block)}`)
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
                           Jump to section
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
                                       if (savedRange.current) { sel?.removeAllRanges(); sel?.addRange(savedRange.current) }
                                       cmd('createLink', `#section-${section.id}`)
                                       closeLinkMode()
                                    }}
                                 >
                                    <span className="font-mono text-[0.6rem] text-muted/50 w-5 shrink-0 text-right">
                                       {String(sectionIndex + 1).padStart(2, '0')}
                                    </span>
                                    <span className="truncate">{section.title || `Section ${sectionIndex + 1}`}</span>
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
                        Cancel
                     </button>
                     <div className="flex items-center gap-2">
                        {isEditingExistingLink && (
                           <button
                              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-red/70 hover:text-red hover:bg-red/10 transition-colors cursor-pointer"
                              onClick={removeLink}
                           >
                              <Link2Off size={12} />
                              Remove link
                           </button>
                        )}
                        <button
                           className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-colors cursor-pointer"
                           onClick={applyLink}
                        >
                           <CornerDownLeft size={12} />
                           Apply
                        </button>
                     </div>
                  </div>
               </div>
            )}
         </div>
      </div>
   )
}
