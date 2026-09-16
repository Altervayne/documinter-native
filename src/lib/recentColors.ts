/*
 * Persistent backlog of recently-used custom inline colors (those picked through the full ColorPicker,
 * outside the curated palettes). Font and highlight keep separate lists; each is capped, deduped,
 * most-recent-first, and persisted to localStorage.
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

/** Defensive parse guard: an array of strings. */
function isStringArray(value: unknown): value is string[] {
   return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

// ##############
// # PUBLIC API #
// ##############

/** Both recent-color lists; empty when absent, malformed, or storage is unavailable. */
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

/** Push a color to the front of a list (dedupe, move-to-front, cap), persist, return the new store.
 *  The hex is lowercased so dedup matches the normalised values inline.ts produces. */
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
