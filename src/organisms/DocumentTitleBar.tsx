// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Icon Imports --
import { X } from 'lucide-react'

// -- Type Imports --
import type { DocMeta, OpenDocument } from '../types'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

interface DocumentTitleBarProps {
   openDocuments: OpenDocument[]
   activeTabKey:  string
   onActivateTab: (tabKey: string) => void
   onCloseTab:    (tabKey: string) => void
   onMetaChange:  (patch: Partial<DocMeta>) => void
}

/**
 * The tab strip (second bar, document mode). One chip per open document: click an inactive tab to
 * activate it, click the active tab to edit its title (the click-to-edit affordance commits through
 * onMetaChange → the active tab's meta.title). Each chip shows a per-tab dirty dot and a close (×).
 */
export function DocumentTitleBar({ openDocuments, activeTabKey, onActivateTab, onCloseTab, onMetaChange }: DocumentTitleBarProps) {
   const { t } = useLang()
   // Which tab's title is being edited (null = none). Tracking the tabKey rather than a boolean means
   // a tab switch (or closing the edited tab) implicitly ends editing — the input only renders while
   // editingTabKey matches the active tab — so no reset-on-switch effect is needed.
   const [editingTabKey, setEditingTabKey] = useState<string | null>(null)
   const [titleDraft,    setTitleDraft]    = useState('')
   const titleInputRef       = useRef<HTMLInputElement>(null)
   const suppressNextBlurRef = useRef(false)

   const activeDocument = openDocuments.find(document => document.tabKey === activeTabKey)
   const activeTitle    = activeDocument?.meta.title ?? ''

   // Select all text once the input mounts.
   useEffect(() => { if (editingTabKey !== null) titleInputRef.current?.select() }, [editingTabKey])

   function handleTabClick(tabKey: string) {
      if (tabKey === activeTabKey) {
         setTitleDraft(activeTitle)
         setEditingTabKey(tabKey)
      } else {
         onActivateTab(tabKey)
      }
   }

   function commitTitle(value: string) {
      const trimmed = value.trim()
      onMetaChange({ title: trimmed || activeTitle })   // empty value keeps the current title
      setEditingTabKey(null)
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
         setEditingTabKey(null)
         titleInputRef.current?.blur()
      }
   }

   return (
      <div className="shrink-0 flex items-end h-9 px-2 gap-1 bg-bg border-b border-border z-100 overflow-x-auto">
         {openDocuments.map(openDocument => {
            const isActive = openDocument.tabKey === activeTabKey
            const isDirty  = openDocument.saveStatus !== 'clean'
            const title    = openDocument.meta.title || t.untitledDoc
            return (
               <div
                  key={openDocument.tabKey}
                  onClick={() => handleTabClick(openDocument.tabKey)}
                  title={title}
                  className={[
                     'flex items-center h-7 pl-3 pr-1.5 gap-1.5 shrink-0 max-w-[14rem] rounded-t-md border border-b-0 cursor-pointer transition-colors',
                     isActive ? 'border-border bg-raised' : 'border-transparent bg-transparent hover:bg-raised/50',
                  ].join(' ')}
               >
                  {isActive && editingTabKey === openDocument.tabKey ? (
                     <input
                        ref={titleInputRef}
                        type="text"
                        aria-label={t.docTitle}
                        value={titleDraft}
                        onChange={event => setTitleDraft(event.target.value)}
                        onBlur={handleTitleBlur}
                        onKeyDown={handleTitleKeyDown}
                        onClick={event => event.stopPropagation()}
                        className="font-mono text-sm bg-transparent border-0 border-b border-accent/60 outline-none w-40 text-text"
                     />
                  ) : (
                     <span className={`font-mono text-sm truncate select-none transition-colors ${isActive ? 'text-text/90' : 'text-text/50'}`}>
                        {title}
                     </span>
                  )}

                  {isDirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-yellow" />}

                  <button
                     type="button"
                     aria-label={t.closeTab}
                     onClick={event => { event.stopPropagation(); onCloseTab(openDocument.tabKey) }}
                     className="shrink-0 grid place-items-center w-4 h-4 rounded text-muted/60 hover:text-text hover:bg-border/60 transition-colors"
                  >
                     <X size={12} />
                  </button>
               </div>
            )
         })}
      </div>
   )
}
