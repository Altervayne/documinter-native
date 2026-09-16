/*
 * Shared types + helpers for the binder's advanced search. Split out of BinderControls so that
 * file only exports components (the react-refresh lint rule); the control bar and the binder root
 * both import from here to keep the editable draft and the storage criteria in lock-step.
 */

import type { DateFilter } from '../../lib/binderSearch'

export type DateFilterMode = 'after' | 'before' | 'between'

/** Strings always present so the inputs stay controlled. */
export interface DateFilterDraft {
   mode: DateFilterMode
   from: string
   to:   string
}

export type SearchScope = 'current' | 'global'

export const EMPTY_DATE_FILTER: DateFilterDraft = { mode: 'after', from: '', to: '' }

/** The bounds that apply for the draft's mode, or undefined when it carries no usable bound. */
export function dateDraftToFilter(draft: DateFilterDraft): DateFilter | undefined {
   if (draft.mode === 'after')  return draft.from ? { from: draft.from } : undefined
   if (draft.mode === 'before') return draft.to   ? { to: draft.to }     : undefined
   const from = draft.from || undefined
   const to   = draft.to   || undefined
   return from || to ? { from, to } : undefined
}
