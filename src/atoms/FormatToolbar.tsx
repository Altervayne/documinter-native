import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Link, Link2Off } from 'lucide-react'
import type { Block, Section } from '../types'

interface AnchoredBlock {
   block:         Block
   sectionIndex:  number
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

interface Pos { top: number; left: number }

interface FormatToolbarProps {
   sections: Section[]
}

/**
 * Floating format toolbar that appears above a text selection inside any
 * element with the data-rich attribute (set by ContentEditable rich=true).
 * Uses position:fixed so it works inside scrollable containers.
 */
export function FormatToolbar({ sections }: FormatToolbarProps) {
   const [pos, setPos] = useState<Pos | null>(null)
   const [linkMode, setLinkMode] = useState(false)
   const [linkUrl, setLinkUrl]   = useState('')
   const savedRange     = useRef<Range | null>(null)
   const inputRef       = useRef<HTMLInputElement>(null)
   // Ref so the selectionchange handler can read link mode without stale closure
   const linkModeRef    = useRef(false)
   // Set to true by the link-click handler; consumed by the useEffect([pos]) below
   const pendingLinkOpen = useRef(false)
   // Stores the <a> element captured by onDocClick so openLinkMode can read its href
   const pendingLinkAnchor = useRef<HTMLAnchorElement | null>(null)

   // ── Helper functions (defined before early return so useEffect can call them) ──

   function openLinkMode() {
      // Save selection so we can restore it before inserting the link
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
      // Pre-fill with existing href.
      // onDocClick stores the <a> directly (selectNodeContents makes anchorNode the element,
      // not a text child, so the parentElement.closest('a') path below would miss it).
      const existingLink = pendingLinkAnchor.current
         ?? sel?.anchorNode?.parentElement?.closest('a')
      pendingLinkAnchor.current = null
      setLinkUrl(existingLink?.getAttribute('href') ?? '')
      linkModeRef.current = true  // set before focus moves so selectionchange ignores the collapse
      setLinkMode(true)
   }

   function closeLinkMode() {
      linkModeRef.current = false
      setLinkMode(false)
      setLinkUrl('')
   }

   function applyLink() {
      const sel = window.getSelection()
      // Restore saved selection (focusing the input collapsed it)
      if (savedRange.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRange.current)
      }
      if (linkUrl.trim()) {
         cmd('createLink', linkUrl.trim())
      }
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

   // ── Effects ────────────────────────────────────────────────────────────────

   useEffect(() => {
      function onSelChange() {
         // While the URL input is focused, the contenteditable selection collapses.
         // Bail out so the toolbar stays mounted until the user confirms or cancels.
         if (linkModeRef.current) return

         const sel = window.getSelection()
         if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            setPos(null)
            return
         }
         // Only show inside rich-text contenteditables
         const anchor = sel.anchorNode
         const inRich = anchor?.parentElement?.closest('[data-rich]')
         if (!inRich) {
            setPos(null)
            return
         }
         const rect = sel.getRangeAt(0).getBoundingClientRect()
         if (!rect.width) {
            setPos(null)
            return
         }
         setPos({ top: rect.top - 44, left: rect.left + rect.width / 2 })
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
         // selectionchange fires next, sets pos, then the useEffect([pos]) opens link mode
      }

      document.addEventListener('selectionchange', onSelChange)
      document.addEventListener('click', onDocClick)
      return () => {
         document.removeEventListener('selectionchange', onSelChange)
         document.removeEventListener('click', onDocClick)
      }
   }, [])

   // After a link-click sets pendingLinkOpen, wait for pos to be set by selectionchange,
   // then open link mode so the panel appears with the href pre-filled.
   useEffect(() => {
      if (pos && pendingLinkOpen.current) {
         pendingLinkOpen.current = false
         openLinkMode()
      }
   }, [pos])

   // Focus the URL input when link mode opens
   useEffect(() => {
      if (linkMode) inputRef.current?.focus()
   }, [linkMode])

   if (!pos) return null

   const buttonClass = 'w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 transition-colors cursor-pointer text-white/75 hover:text-white'

   return (
      <div
         className="fixed z-9999 flex flex-col rounded-lg shadow-xl border border-white/12"
         style={{
            top: pos.top,
            left: pos.left,
            transform: 'translateX(-50%)',
            background: '#0d1117',
         }}
         onMouseDown={event => event.preventDefault()} // keep focus in contenteditable
      >
         {/* Formatting buttons row */}
         <div className="flex items-center gap-0.5 px-1.5 py-1">
            <button className={buttonClass} title="Bold"              onClick={() => cmd('bold')}>
               <Bold size={12} />
            </button>
            <button className={buttonClass} title="Italic"            onClick={() => cmd('italic')}>
               <Italic size={12} />
            </button>
            <button
               className={buttonClass}
               title="Bold + Italic"
               onClick={applyBoldItalic}
               style={{ fontSize: '0.68rem', fontFamily: 'Georgia, serif', fontWeight: 700, fontStyle: 'italic' }}
            >
               BI
            </button>
            <div className="w-px h-4 bg-white/15 mx-0.5" />
            <button className={buttonClass} title="Underline"         onClick={() => cmd('underline')}>
               <Underline size={12} />
            </button>
            <button className={buttonClass} title="Strikethrough"     onClick={() => cmd('strikeThrough')}>
               <Strikethrough size={12} />
            </button>
            <div className="w-px h-4 bg-white/15 mx-0.5" />
            <button
               className={buttonClass}
               title="Insert link"
               onClick={openLinkMode}
               style={linkMode ? { color: 'white', background: 'rgba(255,255,255,0.12)' } : {}}
            >
               <Link size={12} />
            </button>
         </div>

         {/* Link panel — shown when link mode is active */}
         {linkMode && (
            <div className="border-t border-white/10 pt-1 pb-1.5 flex flex-col gap-1">
               {/* External URL row */}
               <div className="flex items-center gap-1 px-1.5">
                  <input
                     ref={inputRef}
                     type="url"
                     placeholder="https://…"
                     value={linkUrl}
                     onChange={event => setLinkUrl(event.target.value)}
                     onKeyDown={event => { if (event.key === 'Enter') applyLink(); else if (event.key === 'Escape') closeLinkMode() }}
                     className="flex-1 bg-white/8 border border-white/15 rounded px-2 py-0.5 text-white/90 text-xs outline-none focus:border-white/35"
                     style={{ minWidth: 180 }}
                  />
                  <button
                     className="w-6 h-6 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 text-white/75 hover:text-white transition-colors cursor-pointer"
                     title="Apply link"
                     onClick={applyLink}
                  >
                     ↵
                  </button>
                  <button
                     className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors cursor-pointer"
                     title="Remove link"
                     onClick={removeLink}
                  >
                     <Link2Off size={11} />
                  </button>
               </div>

               {/* Block anchor picker */}
               {getAnchoredBlocks(sections).length > 0 && (() => {
                  // Derive which anchor is currently linked (for highlighting)
                  const activeFragment = linkUrl.startsWith('#') ? linkUrl.slice(1) : null
                  return (
                     <div className="border-t border-white/10 pt-1 px-1.5">
                        <div className="text-white/30 text-[0.6rem] uppercase tracking-wider mb-0.5 px-1">
                           Jump to block
                        </div>
                        <div className="flex flex-col gap-px max-h-28 overflow-y-auto">
                           {getAnchoredBlocks(sections).map(({ block, sectionIndex }) => {
                              const isActive = activeFragment === block.handle
                              return (
                                 <button
                                    key={block.id}
                                    className={`text-left text-xs rounded px-2 py-0.5 transition-colors cursor-pointer truncate ${
                                       isActive
                                          ? 'bg-white/15 text-white'
                                          : 'text-white/65 hover:text-white hover:bg-white/10'
                                    }`}
                                    onClick={() => {
                                       const sel = window.getSelection()
                                       if (savedRange.current) {
                                          sel?.removeAllRanges()
                                          sel?.addRange(savedRange.current)
                                       }
                                       cmd('createLink', `#${block.handle}`)
                                       closeLinkMode()
                                    }}
                                 >
                                    <span className="text-white/30 font-mono text-[0.6rem] mr-1.5">
                                       {String(sectionIndex + 1).padStart(2, '0')}
                                    </span>
                                    #{block.handle}
                                 </button>
                              )
                           })}
                        </div>
                     </div>
                  )
               })()}

               {/* Section anchor picker */}
               {sections.length > 0 && (() => {
                  const activeFragment = linkUrl.startsWith('#') ? linkUrl.slice(1) : null
                  return (
                     <div className="border-t border-white/10 pt-1 px-1.5">
                        <div className="text-white/30 text-[0.6rem] uppercase tracking-wider mb-0.5 px-1">
                           Jump to section
                        </div>
                        <div className="flex flex-col gap-px max-h-36 overflow-y-auto">
                           {sections.map((section, sectionIndex) => {
                              const isActive = activeFragment === `section-${section.id}`
                              return (
                                 <button
                                    key={section.id}
                                    className={`text-left text-xs rounded px-2 py-0.5 transition-colors cursor-pointer truncate ${
                                       isActive
                                          ? 'bg-white/15 text-white'
                                          : 'text-white/65 hover:text-white hover:bg-white/10'
                                    }`}
                                    onClick={() => {
                                       const sel = window.getSelection()
                                       if (savedRange.current) {
                                          sel?.removeAllRanges()
                                          sel?.addRange(savedRange.current)
                                       }
                                       cmd('createLink', `#section-${section.id}`)
                                       closeLinkMode()
                                    }}
                                 >
                                    <span className="text-white/30 font-mono text-[0.6rem] mr-1.5">
                                       {String(sectionIndex + 1).padStart(2, '0')}
                                    </span>
                                    {section.title}
                                 </button>
                              )
                           })}
                        </div>
                     </div>
                  )
               })()}
            </div>
         )}
      </div>
   )
}
