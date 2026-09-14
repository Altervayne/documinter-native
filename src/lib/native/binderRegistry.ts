/**
 * binderRegistry.ts, the native known-Binders list + active pointer, persisted in localStorage.
 *
 * This is app furniture, not document data: the folders the user has opened before, plus which one is
 * active. It pairs with Rust's persisted-scope (which re-grants the OS-level folder access on its own),
 * so this side only needs to remember the paths. Document data NEVER lives here.
 *
 * The pure transforms (rememberBinder / setActivePath / forgetBinder) take a registry and return a new
 * one, touching no globals, so they are unit-testable without a DOM. The read / write wrappers are the
 * only localStorage-bound part, kept deliberately thin (JSON + try/catch).
 */

// #####################
// # TYPES & CONSTANTS #
// #####################

/** One remembered Binder: its absolute root path, a display name, and when it was last opened. */
export interface KnownBinder {
   path:         string
   name:         string
   lastOpenedAt: string
}

/** The whole registry: which Binder is active (absolute path, null when none) plus the known list,
 *  ordered most-recently-opened first. */
export interface BinderRegistry {
   activePath: string | null
   known:      KnownBinder[]
}

const STORAGE_KEY = 'documinter-native-binders'

const EMPTY_REGISTRY: BinderRegistry = { activePath: null, known: [] }

// ###########
// # HELPERS #
// ###########

/** The display name for a Binder path: its last path segment (handles both separators, trims a
 *  trailing slash first). Falls back to the raw path when there is no segment to take. */
export function binderNameFromPath(path: string): string {
   const trimmed = path.replace(/[/\\]+$/, '')
   const segment = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
   return segment === '' ? path : segment
}

/** True when value has the shape of a KnownBinder (defensive parse guard). */
function isKnownBinder(value: unknown): value is KnownBinder {
   if (typeof value !== 'object' || value === null) return false
   const candidate = value as Record<string, unknown>
   return (
      typeof candidate.path === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.lastOpenedAt === 'string'
   )
}

// #####################
// # PURE TRANSFORMS   #
// #####################

/**
 * Upsert a Binder by path: bump its lastOpenedAt, move it to the front (most-recent-first), and set
 * it active. A supplied name wins; otherwise the existing entry's name is kept, else one is derived
 * from the path's last segment. Pure: returns a new registry, mutates nothing.
 */
export function rememberBinder(
   registry: BinderRegistry, entry: { path: string; name?: string },
): BinderRegistry {
   const now      = new Date().toISOString()
   const existing = registry.known.find(binder => binder.path === entry.path)
   const name     = entry.name ?? existing?.name ?? binderNameFromPath(entry.path)
   const updated: KnownBinder = { path: entry.path, name, lastOpenedAt: now }
   const rest = registry.known.filter(binder => binder.path !== entry.path)
   return { activePath: entry.path, known: [updated, ...rest] }
}

/** Set the active pointer. Only paths already in the known list are accepted; an unknown path clears
 *  the pointer to null (the caller should rememberBinder first). Pure. */
export function setActivePath(registry: BinderRegistry, path: string | null): BinderRegistry {
   if (path === null) return { ...registry, activePath: null }
   const isKnown = registry.known.some(binder => binder.path === path)
   return { ...registry, activePath: isKnown ? path : null }
}

/** Drop a Binder from the known list. If it was the active one, the pointer clears to null. Pure. */
export function forgetBinder(registry: BinderRegistry, path: string): BinderRegistry {
   return {
      activePath: registry.activePath === path ? null : registry.activePath,
      known:      registry.known.filter(binder => binder.path !== path),
   }
}

// #####################
// # LOCALSTORAGE I/O  #
// #####################

/** Read the registry from localStorage. Returns the empty default when absent, malformed, or storage
 *  is unavailable. Corrupt entries in the known list are dropped, never fatal. */
export function readBinderRegistry(): BinderRegistry {
   try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { activePath: null, known: [] }
      const parsed = JSON.parse(raw) as Partial<BinderRegistry>
      const known = Array.isArray(parsed.known) ? parsed.known.filter(isKnownBinder) : []
      const activePath = typeof parsed.activePath === 'string' ? parsed.activePath : null
      return { activePath, known }
   } catch {
      return { activePath: null, known: [] }
   }
}

/** Persist the registry to localStorage. Swallows storage errors (private mode / quota), so a failed
 *  write never breaks a Binder flow. */
export function writeBinderRegistry(registry: BinderRegistry): void {
   try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(registry))
   } catch {
      // Storage unavailable; the in-memory registry still drives the current session.
   }
}

export { EMPTY_REGISTRY }
