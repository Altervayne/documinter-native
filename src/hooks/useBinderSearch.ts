// -- React Imports --
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Lib Imports --
import { DOCUMENT_DATE_FIELDS } from '../lib/binderSearch'
import type { SearchCriteria, DocumentDateField, DateFilter } from '../lib/binderSearch'

// -- Binder-local search helpers --
import { EMPTY_DATE_FILTER, dateDraftToFilter } from '../organisms/Binder/searchFilters'
import type { DateFilterDraft, SearchScope } from '../organisms/Binder/searchFilters'

interface UseBinderSearchResult {
   searchInput:       string
   setSearchInput:    Dispatch<SetStateAction<string>>
   dateFilters:       Record<DocumentDateField, DateFilterDraft>
   setDateFilter:     (field: DocumentDateField, next: DateFilterDraft) => void
   hasNeverOpened:    boolean
   setHasNeverOpened: Dispatch<SetStateAction<boolean>>
   scope:             SearchScope
   setScope:          Dispatch<SetStateAction<SearchScope>>
   /** The assembled multi-criteria query (debounced text + fields, date constraints, never-opened). */
   criteria:          SearchCriteria
   /** True when any criterion is active,drives global-scope listing and the empty-state copy. */
   hasActiveCriteria: boolean
   /** Reset the advanced filters (fields, dates, never-opened, scope), NOT the search text. */
   clearFilters:      () => void
   /** Reset everything search-related (text + filters); used when navigating folders. */
   resetSearch:       () => void
}

/**
 * Owns the binder's session-local search + advanced-filter draft state, the two 250ms debounces
 * (text and per-field queries), and the assembled `criteria` / `hasActiveCriteria`. State stays
 * local to the binder subtree, the root consumes this hook and threads the results into
 * BinderControls and the document-list query. Sort (sortBy/sortDir) is not search state and
 * stays in the root.
 */
export function useBinderSearch(): UseBinderSearchResult {
   const [searchInput, setSearchInput]         = useState('')
   const [debouncedSearch, setDebouncedSearch] = useState('')

   // Advanced filters: an independent date constraint per field, never-opened, and search scope.
   const [dateFilters, setDateFilters] = useState<Record<DocumentDateField, DateFilterDraft>>({
      updatedAt:    EMPTY_DATE_FILTER,
      createdAt:    EMPTY_DATE_FILTER,
      lastOpenedAt: EMPTY_DATE_FILTER,
   })
   const [hasNeverOpened, setHasNeverOpened] = useState(false)
   const [scope, setScope]                   = useState<SearchScope>('global')

   const setDateFilter = useCallback((field: DocumentDateField, next: DateFilterDraft) => {
      setDateFilters(previous => ({ ...previous, [field]: next }))
   }, [])

   useEffect(() => {
      const timer = setTimeout(() => setDebouncedSearch(searchInput), 250)
      return () => clearTimeout(timer)
   }, [searchInput])

   const criteria = useMemo<SearchCriteria>(() => {
      const dates: Partial<Record<DocumentDateField, DateFilter>> = {}
      for (const field of DOCUMENT_DATE_FIELDS) {
         const filter = dateDraftToFilter(dateFilters[field])
         if (filter) dates[field] = filter
      }
      return {
         text:           debouncedSearch.trim() || undefined,
         dates:          Object.keys(dates).length > 0 ? dates : undefined,
         hasNeverOpened: hasNeverOpened || undefined,
      }
   }, [debouncedSearch, dateFilters, hasNeverOpened])

   const hasActiveCriteria = Boolean(criteria.text || criteria.dates || criteria.hasNeverOpened)

   const clearFilters = useCallback(() => {
      setDateFilters({ updatedAt: EMPTY_DATE_FILTER, createdAt: EMPTY_DATE_FILTER, lastOpenedAt: EMPTY_DATE_FILTER })
      setHasNeverOpened(false)
      setScope('global')
   }, [])

   const resetSearch = useCallback(() => {
      setSearchInput('')          // navigating exits a global search
      setDebouncedSearch('')
      clearFilters()              // …and clears any advanced filters
   }, [clearFilters])

   return {
      searchInput, setSearchInput,
      dateFilters, setDateFilter,
      hasNeverOpened, setHasNeverOpened,
      scope, setScope,
      criteria, hasActiveCriteria,
      clearFilters, resetSearch,
   }
}
