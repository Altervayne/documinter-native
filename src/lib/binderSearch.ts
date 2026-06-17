/**
 * binderSearch.ts, In-memory filtering + sorting for the binder document list.
 *
 * Relocated verbatim from storage.ts. Owns the search/filter/sort types and the pure matching
 * + comparison functions that listDocuments (binderDocuments) applies after reading records.
 */

import type { BinderDocumentRecord } from '../types'

export type DocumentSortBy = 'updatedAt' | 'createdAt' | 'lastOpenedAt' | 'title' | 'manual'

/** Per-field targeted text queries (each an independent case-insensitive substring, all ANDed). */
export interface FieldQuery {
   title?:         string
   module?:        string
   env?:           string
   author?:        string
   date?:          string
   sectionTitles?: string
   content?:       string
}

/** The three timestamps a search can constrain. */
export type DocumentDateField = 'updatedAt' | 'createdAt' | 'lastOpenedAt'

/** The three date fields in display order, also drives matching iteration. */
export const DOCUMENT_DATE_FIELDS: DocumentDateField[] = ['updatedAt', 'createdAt', 'lastOpenedAt']

/**
 * A single date-field constraint. An inclusive lower bound (from) expresses "after", an
 * inclusive upper bound (to) expresses "before", and both together express a "between" range.
 * Bounds are 'YYYY-MM-DD' calendar days compared against the day portion of the ISO timestamp.
 */
export interface DateFilter {
   from?: string
   to?:   string
}

/**
 * Multi-criteria search. Every present criterion is ANDed together. Each of the three date
 * fields may carry its own independent constraint simultaneously. hasNeverOpened keeps only
 * documents that have no lastOpenedAt. Folder scoping is handled by DocumentListFilter.folderId,
 * not here.
 */
export interface SearchCriteria {
   text?:           string                                   // global full-text: meta + section titles + contents
   fields?:         FieldQuery                               // targeted per-field substrings
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

/** Global full-text match: all metadata fields + section titles + flattened block contents. */
function matchesText(record: BinderDocumentRecord, needle: string): boolean {
   const haystack = [
      record.meta.title, record.meta.module, record.meta.env, record.meta.author, record.meta.date,
      record.sectionTitles.join(' '),
      record.contentText ?? '',
   ].join(' ').toLowerCase()
   return haystack.includes(needle)
}

/** True when needle is empty/whitespace, or is a case-insensitive substring of haystack. */
function fieldMatches(needle: string | undefined, haystack: string): boolean {
   const trimmed = needle?.trim().toLowerCase()
   return !trimmed || haystack.toLowerCase().includes(trimmed)
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

   if (criteria.fields) {
      const fields = criteria.fields
      if (!fieldMatches(fields.title,         record.meta.title))            return false
      if (!fieldMatches(fields.module,        record.meta.module))           return false
      if (!fieldMatches(fields.env,           record.meta.env))              return false
      if (!fieldMatches(fields.author,        record.meta.author))           return false
      if (!fieldMatches(fields.date,          record.meta.date))             return false
      if (!fieldMatches(fields.sectionTitles, record.sectionTitles.join(' '))) return false
      if (!fieldMatches(fields.content,       record.contentText ?? ''))     return false
   }

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
