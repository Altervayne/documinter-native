/*
 * Pure formatting for a paged document's page number: turn (style, page number, total) into the printed
 * string. Shared by the editor's paged view and the paged HTML export so both read identically; the
 * words "Page" / "of" are passed in localized.
 */

// -- Type Imports --
import type { PageNumberStyle } from './format'

/** The style set offered in Page setup, in display order. */
export const PAGE_NUMBER_STYLES: readonly PageNumberStyle[] = ['plain', 'page', 'slash', 'pageOf', 'dashes']

/** The localized words a style may need. `page` = "Page"; `of` = "of" (French "sur"). */
export interface PageNumberLabels {
   page: string
   of:   string
}

/**
 * The printed page-number string for a 1-based page number out of `totalPages`.
 *   plain  -> `1`          page   -> `Page 1`       slash -> `1 / 12`
 *   pageOf -> `Page 1 of 12`                      dashes -> `- 1 -`
 */
export function formatPageNumber(
   style:      PageNumberStyle,
   pageNumber: number,
   totalPages: number,
   labels:     PageNumberLabels,
): string {
   switch (style) {
      case 'plain':  return `${pageNumber}`
      case 'page':   return `${labels.page} ${pageNumber}`
      case 'slash':  return `${pageNumber} / ${totalPages}`
      case 'pageOf': return `${labels.page} ${pageNumber} ${labels.of} ${totalPages}`
      case 'dashes': return `- ${pageNumber} -`
   }
}
