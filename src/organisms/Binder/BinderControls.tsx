import { Search, X, ArrowUp, ArrowDown } from 'lucide-react'
import type { DocumentSortBy } from '../../lib/storage'
import { useLang } from '../../contexts/LangContext'

interface BinderControlsProps {
   search:          string
   onSearchChange:  (value: string) => void
   sortBy:          DocumentSortBy
   onSortByChange:  (value: DocumentSortBy) => void
   sortDir:         'asc' | 'desc'
   onSortDirToggle: () => void
}

/** Search + sort bar above the document grid. State lives in the binder session (not persisted). */
export function BinderControls({ search, onSearchChange, sortBy, onSortByChange, sortDir, onSortDirToggle }: BinderControlsProps) {
   const { t } = useLang()
   const isManual = sortBy === 'manual'

   const options: { value: DocumentSortBy; label: string }[] = [
      { value: 'updatedAt',    label: t.binderSortUpdated },
      { value: 'lastOpenedAt', label: t.binderSortOpened },
      { value: 'createdAt',    label: t.binderSortCreated },
      { value: 'title',        label: t.binderSortTitle },
      { value: 'manual',       label: t.binderSortManual },
   ]

   return (
      <div className="flex items-center gap-2 flex-wrap">
         {/* Search */}
         <div className="relative flex-1 min-w-48 max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
               type="text"
               value={search}
               onChange={event => onSearchChange(event.target.value)}
               placeholder={t.binderSearchPlaceholder}
               className="w-full bg-el border border-border rounded-md pl-8 pr-8 py-1.5 text-sm text-text outline-none focus:border-accent transition-colors placeholder:text-muted/50"
            />
            {search && (
               <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer"
               >
                  <X size={14} />
               </button>
            )}
         </div>

         {/* Sort field */}
         <select
            value={sortBy}
            onChange={event => onSortByChange(event.target.value as DocumentSortBy)}
            className="bg-el border border-border rounded-md px-2 py-1.5 text-sm text-text outline-none focus:border-accent cursor-pointer"
         >
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
         </select>

         {/* Sort direction (disabled for manual) */}
         <button
            type="button"
            onClick={onSortDirToggle}
            disabled={isManual}
            aria-label="Toggle sort direction"
            className="p-1.5 rounded-md border border-border text-muted hover:text-text hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
         >
            {sortDir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
         </button>
      </div>
   )
}
