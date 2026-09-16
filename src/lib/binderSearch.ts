/*
 * In-memory filtering + sorting for the binder document list: the search / filter / sort types and
 * the pure matching + comparison functions listDocuments applies after reading records.
 */

import type { BinderDocumentRecord } from '../types'

export type DocumentSortBy = 'updatedAt' | 'createdAt' | 'lastOpenedAt' | 'title' | 'manual'

export type DocumentDateField = 'updatedAt' | 'createdAt' | 'lastOpenedAt'

/** The three date fields in display order, also drives matching iteration. */
export const DOCUMENT_DATE_FIELDS: DocumentDateField[] = ['updatedAt', 'createdAt', 'lastOpenedAt']

/** A single date-field constraint. Inclusive `from` is "after", inclusive `to` is "before", both a
 *  "between" range. Bounds are 'YYYY-MM-DD' days compared against the day portion of the timestamp. */
export interface DateFilter {
   from?: string
   to?:   string
}

/** Every present criterion is ANDed. Each date field may carry its own independent constraint.
 *  hasNeverOpened keeps only documents with no lastOpenedAt. Folder scoping lives on
 *  DocumentListFilter.folderId, not here. */
export interface SearchCriteria {
   text?:           string                                   // free-text: title + every field label/value + section titles + contents
   dates?:          Partial<Record<DocumentDateField, DateFilter>>
   hasNeverOpened?: boolean
}

/** Filter/sort/search options for listDocuments. */
export interface DocumentListFilter {
   folderId?: string                  // folder scope (undefined = all folders)
   sortBy?:   DocumentSortBy          // default 'updatedAt'
   sortDir?:  'asc' | 'desc'          // default 'desc'; ignored for 'manual'
   criteria?: SearchCriteria          // multi-criteria search (all ANDed; within folderId scope)
}

/** Matches over title + every field label / value + section titles + contents. */
function matchesText(record: BinderDocumentRecord, needle: string): boolean {
   const fieldText = record.meta.fields.map(field => `${field.label} ${field.value}`).join(' ')
   const haystack = [
      record.meta.title,
      fieldText,
      record.sectionTitles.join(' '),
      record.contentText ?? '',
   ].join(' ').toLowerCase()
   return haystack.includes(needle)
}

/** The day portion (YYYY-MM-DD) of the record's chosen date field, or undefined if unset. */
function recordDateDay(record: BinderDocumentRecord, field: DocumentDateField): string | undefined {
   const value = field === 'createdAt' ? record.createdAt
      : field === 'lastOpenedAt'        ? record.lastOpenedAt
      :                                   record.updatedAt
   return value ? value.slice(0, 10) : undefined
}

/** True when the record satisfies every present criterion (all ANDed). */
export function matchesCriteria(record: BinderDocumentRecord, criteria: SearchCriteria): boolean {
   const text = criteria.text?.trim().toLowerCase()
   if (text && !matchesText(record, text)) return false

   if (criteria.hasNeverOpened && record.lastOpenedAt !== undefined) return false

   if (criteria.dates) {
      for (const field of DOCUMENT_DATE_FIELDS) {
         const dateFilter = criteria.dates[field]
         if (!dateFilter) continue
         const day = recordDateDay(record, field)
         // A never-opened document has no lastOpenedAt day, so any constraint on it excludes it.
         if (!day) return false
         if (dateFilter.from && day < dateFilter.from) return false
         if (dateFilter.to   && day > dateFilter.to)   return false
      }
   }

   return true
}

/** Comparator for the in-memory document sort. 'manual' ignores direction (always ascending). */
export function documentComparator(sortBy: DocumentSortBy, sortDir: 'asc' | 'desc'): (a: BinderDocumentRecord, b: BinderDocumentRecord) => number {
   const direction = sortDir === 'asc' ? 1 : -1
   return (a, b) => {
      switch (sortBy) {
         case 'manual':    return a.sortOrder - b.sortOrder
         case 'title':     return direction * a.meta.title.localeCompare(b.meta.title)
         case 'createdAt': return direction * a.createdAt.localeCompare(b.createdAt)
         case 'lastOpenedAt': {
            // Never-opened documents always sort last, regardless of direction.
            if (!a.lastOpenedAt && !b.lastOpenedAt) return 0
            if (!a.lastOpenedAt) return 1
            if (!b.lastOpenedAt) return -1
            return direction * a.lastOpenedAt.localeCompare(b.lastOpenedAt)
         }
         case 'updatedAt':
         default:          return direction * a.updatedAt.localeCompare(b.updatedAt)
      }
   }
}
