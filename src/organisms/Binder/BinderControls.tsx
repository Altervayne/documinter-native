import { useState } from 'react'
import { Search, X, ArrowUp, ArrowDown, SlidersHorizontal, Square, CheckSquare } from 'lucide-react'
import { DOCUMENT_DATE_FIELDS } from '../../lib/binderSearch'
import type { DocumentSortBy, DocumentDateField, DateFilter } from '../../lib/binderSearch'
import { useLang } from '../../contexts/LangContext'
import { dateDraftToFilter } from './searchFilters'
import type { DateFilterMode, DateFilterDraft, SearchScope } from './searchFilters'

interface BinderControlsProps {
   search:          string
   onSearchChange:  (value: string) => void
   sortBy:          DocumentSortBy
   onSortByChange:  (value: DocumentSortBy) => void
   sortDir:         'asc' | 'desc'
   onSortDirToggle: () => void
   dateFilters:            Record<DocumentDateField, DateFilterDraft>
   onDateFilterChange:     (field: DocumentDateField, next: DateFilterDraft) => void
   hasNeverOpened:         boolean
   onHasNeverOpenedToggle: () => void
   scope:                  SearchScope
   onScopeChange:          (scope: SearchScope) => void
   onClearFilters:         () => void
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
   return (
      <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full border border-accent/30 bg-accent/10 text-accent text-xs">
         {label}
         <button
            type="button"
            aria-label="Remove filter"
            onClick={onRemove}
            className="rounded-full p-0.5 hover:bg-accent/20 transition-colors cursor-pointer"
         >
            <X size={11} />
         </button>
      </span>
   )
}

/** One date field's constraint row: a mode picker plus the one or two date inputs that mode needs. */
function DateFilterRow({
   label, draft, modeLabels, fromLabel, toLabel, onChange,
}: {
   label:      string
   draft:      DateFilterDraft
   modeLabels: Record<DateFilterMode, string>
   fromLabel:  string
   toLabel:    string
   onChange:   (next: DateFilterDraft) => void
}) {
   const showFrom = draft.mode === 'after' || draft.mode === 'between'
   const showTo   = draft.mode === 'before' || draft.mode === 'between'
   const inputClass = 'bg-el border border-border rounded-md px-2 py-1.5 text-sm text-text outline-none focus:border-accent cursor-pointer'

   return (
      <div className="flex items-center gap-2 flex-wrap">
         <span className="w-16 shrink-0 text-xs text-muted">{label}</span>
         <select
            value={draft.mode}
            onChange={event => onChange({ ...draft, mode: event.target.value as DateFilterMode })}
            className="bg-el border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-accent cursor-pointer"
         >
            <option value="after">{modeLabels.after}</option>
            <option value="before">{modeLabels.before}</option>
            <option value="between">{modeLabels.between}</option>
         </select>
         {showFrom && (
            <input
               type="date"
               value={draft.from}
               max={showTo ? (draft.to || undefined) : undefined}
               aria-label={fromLabel}
               onChange={event => onChange({ ...draft, from: event.target.value })}
               className={inputClass}
            />
         )}
         {draft.mode === 'between' && <span className="text-xs text-muted">-</span>}
         {showTo && (
            <input
               type="date"
               value={draft.to}
               min={showFrom ? (draft.from || undefined) : undefined}
               aria-label={toLabel}
               onChange={event => onChange({ ...draft, to: event.target.value })}
               className={inputClass}
            />
         )}
      </div>
   )
}

/** Chip text for a date bound: "Updated >= x", "Updated <= y", or "Updated x - y". */
function dateChipLabel(fieldLabel: string, bounds: DateFilter): string {
   if (bounds.from && bounds.to) return `${fieldLabel} ${bounds.from} - ${bounds.to}`
   if (bounds.from)              return `${fieldLabel} ≥ ${bounds.from}`
   return `${fieldLabel} ≤ ${bounds.to}`
}

/**
 * Search + sort bar above the document grid. The "Filters" toggle reveals an advanced panel whose
 * active criteria show as dismissable chips. All state lives in the binder session, not persisted.
 */
export function BinderControls({
   search, onSearchChange, sortBy, onSortByChange, sortDir, onSortDirToggle,
   dateFilters, onDateFilterChange,
   hasNeverOpened, onHasNeverOpenedToggle, scope, onScopeChange, onClearFilters,
}: BinderControlsProps) {
   const { t } = useLang()
   const [isPanelOpen, setIsPanelOpen] = useState(false)

   const isManual = sortBy === 'manual'

   const sortOptions: { value: DocumentSortBy; label: string }[] = [
      { value: 'updatedAt',    label: t.binderSortUpdated },
      { value: 'lastOpenedAt', label: t.binderSortOpened },
      { value: 'createdAt',    label: t.binderSortCreated },
      { value: 'title',        label: t.binderSortTitle },
      { value: 'manual',       label: t.binderSortManual },
   ]

   const dateFieldLabels: Record<DocumentDateField, string> = {
      updatedAt:    t.binderDateUpdated,
      createdAt:    t.binderDateCreated,
      lastOpenedAt: t.binderDateOpened,
   }
   const modeLabels: Record<DateFilterMode, string> = {
      after:   t.binderDateAfter,
      before:  t.binderDateBefore,
      between: t.binderDateBetween,
   }

   // =======================================================
   //  Active-criteria bookkeeping (drives the badge + chips)
   // =======================================================
   const activeDateFields = DOCUMENT_DATE_FIELDS
      .map(field => ({ field, bounds: dateDraftToFilter(dateFilters[field]) }))
      .filter((entry): entry is { field: DocumentDateField; bounds: DateFilter } => entry.bounds !== undefined)

   const scopeActive = scope === 'current'
   const activeCount = activeDateFields.length + (hasNeverOpened ? 1 : 0) + (scopeActive ? 1 : 0)

   const scopeButtonClass = (value: SearchScope) =>
      `px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
         scope === value ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text hover:bg-accent/5'
      }`

   return (
      <div className="flex flex-col gap-2.5">
         <div className="flex items-center gap-2 flex-wrap">
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

            {/* Shows the active advanced-criteria count even while collapsed. */}
            <button
               type="button"
               onClick={() => setIsPanelOpen(open => !open)}
               aria-expanded={isPanelOpen}
               className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-sm transition-colors cursor-pointer ${
                  isPanelOpen || activeCount > 0
                     ? 'border-accent/50 text-accent bg-accent/10'
                     : 'border-border text-muted hover:text-text hover:bg-accent/10'
               }`}
            >
               <SlidersHorizontal size={14} />
               {t.binderFilters}
               {activeCount > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent text-bg text-[10px] font-semibold leading-none">
                     {activeCount}
                  </span>
               )}
            </button>

            <select
               value={sortBy}
               onChange={event => onSortByChange(event.target.value as DocumentSortBy)}
               className="bg-el border border-border rounded-md px-2 py-1.5 text-sm text-text outline-none focus:border-accent cursor-pointer"
            >
               {sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>

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

         {isPanelOpen && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-el/40 p-3">
               <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-16 shrink-0 text-xs text-muted">{t.binderSearchScope}</span>
                  <div className="flex rounded-md border border-border overflow-hidden w-fit">
                     <button type="button" onClick={() => onScopeChange('global')}  className={scopeButtonClass('global')}>{t.binderScopeGlobal}</button>
                     <button type="button" onClick={() => onScopeChange('current')} className={scopeButtonClass('current')}>{t.binderScopeCurrent}</button>
                  </div>
               </div>

               <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted/70">{t.binderDatesHeading}</span>
               {DOCUMENT_DATE_FIELDS.map(field => (
                  <DateFilterRow
                     key={field}
                     label={dateFieldLabels[field]}
                     draft={dateFilters[field]}
                     modeLabels={modeLabels}
                     fromLabel={`${dateFieldLabels[field]} ${t.binderFilterFrom}`}
                     toLabel={`${dateFieldLabels[field]} ${t.binderFilterTo}`}
                     onChange={next => onDateFilterChange(field, next)}
                  />
               ))}
               </div>

               <button
                  type="button"
                  onClick={onHasNeverOpenedToggle}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors cursor-pointer w-fit ${
                     hasNeverOpened
                        ? 'border-accent/50 bg-accent/15 text-accent'
                        : 'border-border text-muted hover:text-text hover:bg-accent/10'
                  }`}
               >
                  {hasNeverOpened ? <CheckSquare size={14} /> : <Square size={14} />}
                  {t.binderNeverOpened}
               </button>
            </div>
         )}

         {activeCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
               {scopeActive && (
                  <FilterChip label={t.binderScopeCurrentChip} onRemove={() => onScopeChange('global')} />
               )}
               {activeDateFields.map(({ field, bounds }) => (
                  <FilterChip
                     key={field}
                     label={dateChipLabel(dateFieldLabels[field], bounds)}
                     onRemove={() => onDateFilterChange(field, { ...dateFilters[field], from: '', to: '' })}
                  />
               ))}
               {hasNeverOpened && (
                  <FilterChip label={t.binderNeverOpened} onRemove={onHasNeverOpenedToggle} />
               )}
               {activeCount >= 2 && (
                  <button
                     type="button"
                     onClick={onClearFilters}
                     className="text-xs text-muted hover:text-text underline-offset-2 hover:underline cursor-pointer"
                  >
                     {t.binderClearFilters}
                  </button>
               )}
            </div>
         )}
      </div>
   )
}
