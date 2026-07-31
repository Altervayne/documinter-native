/**
 * searchFilters.ts, shared types + helpers for the binder's advanced search.
 *
 * Kept separate from BinderControls so the component file only exports components
 * (required by the react-refresh lint rule). Both the control bar and the binder root
 * import from here so the editable draft state and the storage criteria stay in lock-step.
 */

import type { DateFilter } from '../../lib/binderSearch'

/** How a date field is constrained: at/after a day, at/before a day, or within a range. */
export type DateFilterMode = 'after' | 'before' | 'between'

/** Editable per-field date state (strings always present so inputs stay controlled). */
export interface DateFilterDraft {
   mode: DateFilterMode
   from: string
   to:   string
}

/** Whether an active search is limited to the current folder or spans the whole binder. */
export type SearchScope = 'current' | 'global'

export const EMPTY_DATE_FILTER: DateFilterDraft = { mode: 'after', from: '', to: '' }

/**
 * Convert an editable draft to the storage DateFilter (just the bounds that apply for its mode),
 * or undefined when the draft carries no usable bound.
 */
export function dateDraftToFilter(draft: DateFilterDraft): DateFilter | undefined {
   if (draft.mode === 'after')  return draft.from ? { from: draft.from } : undefined
   if (draft.mode === 'before') return draft.to   ? { to: draft.to }     : undefined
   const from = draft.from || undefined
   const to   = draft.to   || undefined
   return from || to ? { from, to } : undefined
}
