/**
 * recentColors.ts, persistent backlog of recently-used custom inline colors.
 *
 * Custom colors are those picked through the full ColorPicker that are NOT part of
 * the curated font/highlight palettes. Font and highlight keep separate lists since
 * they live in different color spaces. Each list is capped, deduped, most-recent-first,
 * and persisted to localStorage so the backlog survives reloads.
 */

// #####################
// # TYPES & CONSTANTS #
// #####################

/** Which inline color field a recents list belongs to. Mirrors InlineRun field names. */
export type RecentColorKind = 'color' | 'highlight'

interface RecentColorsStore {
   color:     string[]
   highlight: string[]
}

const STORAGE_KEY  = 'documinter-recent-colors'
const MAX_RECENTS  = 9

const EMPTY_STORE: RecentColorsStore = { color: [], highlight: [] }

// ###########
// # HELPERS #
// ###########

/** True when value is an array of strings (defensive parse guard). */
function isStringArray(value: unknown): value is string[] {
   return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

// ##############
// # PUBLIC API #
// ##############

/**
 * Read both recent-color lists from localStorage.
 * Returns empty lists when absent, malformed, or storage is unavailable.
 */
export function readRecentColors(): RecentColorsStore {
   try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { ...EMPTY_STORE }
      const parsed = JSON.parse(raw) as Partial<RecentColorsStore>
      return {
         color:     isStringArray(parsed.color)     ? parsed.color.slice(0, MAX_RECENTS)     : [],
         highlight: isStringArray(parsed.highlight) ? parsed.highlight.slice(0, MAX_RECENTS) : [],
      }
   } catch {
      return { ...EMPTY_STORE }
   }
}

/**
 * Push a color to the front of the given list (dedupe, move-to-front, cap at MAX_RECENTS),
 * persist the result, and return the updated store. The incoming hex is lowercased to
 * keep dedup consistent with the normalised values produced by inline.ts.
 */
export function pushRecentColor(kind: RecentColorKind, hex: string): RecentColorsStore {
   const normalized = hex.toLowerCase()
   const current    = readRecentColors()
   const withoutDuplicate = current[kind].filter(entry => entry.toLowerCase() !== normalized)
   const next: RecentColorsStore = {
      ...current,
      [kind]: [normalized, ...withoutDuplicate].slice(0, MAX_RECENTS),
   }
   try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
   } catch {
      // Storage unavailable (private mode / quota), keep the in-memory result anyway.
   }
   return next
}
