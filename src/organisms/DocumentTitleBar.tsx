// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Type Imports --
import type { DocMeta } from '../types'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

interface DocumentTitleBarProps {
   meta:         DocMeta
   onMetaChange: (patch: Partial<DocMeta>) => void
}

/**
 * The document title bar (second strip), mounted in document mode. It holds the single active
 * document's title in the slot the tab strip will later occupy — this is shell + information
 * architecture only, NO tab logic. Title editing is unchanged from the old header: same
 * click-to-edit affordance, same commit path through onMetaChange (App's handleMetaChange).
 */
export function DocumentTitleBar({ meta, onMetaChange }: DocumentTitleBarProps) {
   const { t } = useLang()
   const [titleEditing, setTitleEditing] = useState(false)
   const [titleDraft,   setTitleDraft]   = useState('')
   const titleInputRef       = useRef<HTMLInputElement>(null)
   const suppressNextBlurRef = useRef(false)

   function handleTitleClick() {
      setTitleDraft(meta.title)
      setTitleEditing(true)
   }

   // Select all text once the input mounts
   useEffect(() => {
      if (titleEditing) titleInputRef.current?.select()
   }, [titleEditing])

   function commitTitle(value: string) {
      const trimmed = value.trim()
      // Empty value → keep current title (no change)
      onMetaChange({ title: trimmed || meta.title })
      setTitleEditing(false)
   }

   function handleTitleBlur() {
      if (suppressNextBlurRef.current) {
         suppressNextBlurRef.current = false
         return
      }
      commitTitle(titleDraft)
   }

   function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Enter') {
         event.preventDefault()
         suppressNextBlurRef.current = true   // prevent double-commit on the resulting blur
         commitTitle(titleDraft)
         titleInputRef.current?.blur()
      } else if (event.key === 'Escape') {
         suppressNextBlurRef.current = true
         setTitleEditing(false)
         titleInputRef.current?.blur()
      }
   }

   return (
      <div className="shrink-0 flex items-end h-9 px-2 gap-1 bg-bg border-b border-border z-100">
         {/* Tab-strip slot: the single active-document "tab" holding the title. Tabs land here later. */}
         <div className="flex items-center h-7 px-3 min-w-0 max-w-[60%] rounded-t-md border border-b-0 border-border bg-raised">
            {titleEditing ? (
               <input
                  ref={titleInputRef}
                  type="text"
                  aria-label={t.docTitle}
                  value={titleDraft}
                  onChange={event => setTitleDraft(event.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleTitleKeyDown}
                  className="font-mono text-sm bg-transparent border-0 border-b border-accent/60 outline-none w-44 text-text"
               />
            ) : (
               <span
                  onClick={handleTitleClick}
                  title={meta.title || t.untitledDoc}
                  className="font-mono text-sm text-text/70 truncate cursor-text hover:text-text/90 select-none transition-colors"
               >
                  {meta.title || t.untitledDoc}
               </span>
            )}
         </div>
      </div>
   )
}
