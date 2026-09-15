/**
 * binderPaths.ts, the path <-> id derivations, the `.mint` filename scheme, and the system-folder rule.
 *
 * Pure helpers over the Binder's folder tree. The identity decisions from the arc-A design live here:
 * a folder's id IS its relative path from the Binder root (a directory carries no UUID), except the
 * root, whose id is the reserved ROOT_FOLDER_ID; a document's on-disk name is sanitizeForFilename(title)
 * .mint, a deterministic projection of the title kept in sync with it, its stable id riding INSIDE the
 * file (see mintFile.ts). Filename collisions do NOT get a numeric suffix: uniqueness is resolved on the
 * TITLE instead (nextAvailableTitle), so the invariant stem === sanitizeForFilename(title) stays exact
 * and a rename in Explorer is always distinguishable from the app's own projection (see filename-policy).
 *
 * All paths here are POSIX-style relative paths (forward slashes), the canonical internal form. The
 * filesystem backend converts to/from OS separators at the plugin-fs boundary, this module never sees
 * a backslash and never touches the disk.
 */

import { slugify } from '../text'
import { ROOT_FOLDER_ID } from '../binderDatabase'

// #############
// # CONSTANTS #
// #############

/** The rebuildable cache folder (index + previews). Dot-prefixed, so isSystemFolderName excludes it. */
export const DOCUMINTER_DIR = '.documinter'
/** The Binder's template source folder (`*.mintplate`). Dot-prefixed, excluded from the tree too. */
export const TEMPLATES_DIR = '.templates'
/** The document file extension (the reclaimed `.mint`, self-contained inline-asset JSON). */
export const MINT_EXTENSION = '.mint'
/** The template file extension (same envelope as `.mint`, chrome-only payload). */
export const MINTPLATE_EXTENSION = '.mintplate'
/** The SQLite index file name inside DOCUMINTER_DIR. */
export const INDEX_FILE = 'index.sqlite'

/** The fallback stem (and default title) for a document whose title sanitizes to nothing, so an untitled
 *  document still names a valid, non-empty file. Title-cased because sanitizeForFilename preserves case,
 *  and this doubles as the human default title nextAvailableTitle bumps ("Untitled" -> "Untitled 1").
 *  The `.mintplate` scheme slugs it back to lowercase for its own untitled fallback (see there). */
export const UNTITLED_FILE_STEM = 'Untitled'

/** Windows reserved device names (case-insensitive, with or without an extension). A stem that equals one
 *  of these gets a `_` folded into its base name so the file is writable on Windows. */
const RESERVED_DEVICE_NAMES = new Set<string>([
   'CON', 'PRN', 'AUX', 'NUL',
   'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
   'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/** Stem length cap, so `folderPath/stem.mint` stays well under the ~255 path limit even nested deep. */
const MAX_STEM_LENGTH = 120

// ####################
// # SYSTEM FOLDER RULE #
// ####################

/** The ONE tree rule: a dot-prefixed folder is a Documinter system folder, excluded from the document
 *  tree. Covers `.documinter`, `.templates`, and any other dot-folder, so a scan skips them wholesale
 *  and a user folder literally named `templates` stays unambiguously theirs. */
export function isSystemFolderName(name: string): boolean {
   return name.startsWith('.')
}

// ##################
// # FOLDER IDENTITY #
// ##################

/** Normalize a relative POSIX path to its canonical form: drop empty and `.` segments, keep the rest
 *  joined by single slashes. Returns '' for the root (empty / '.' / all-empty input). */
function normalizeRelativePosix(path: string): string {
   return path.split('/').filter(segment => segment !== '' && segment !== '.').join('/')
}

/** The folder id for a relative directory path from the Binder root. The root ('' or '.') maps to the
 *  reserved ROOT_FOLDER_ID; every other folder's id IS its normalized relative posix path. */
export function folderIdForRelativePath(relativeDir: string): string {
   const normalized = normalizeRelativePosix(relativeDir)
   return normalized === '' ? ROOT_FOLDER_ID : normalized
}

/** The relative directory path for a folder id, the inverse of folderIdForRelativePath. ROOT_FOLDER_ID
 *  maps back to '' (the Binder root itself); every other id is already its own relative path. */
export function relativeDirForFolderId(folderId: string): string {
   return folderId === ROOT_FOLDER_ID ? '' : folderId
}

/** The id of the folder containing this one. A one-segment-deep folder's parent is the root; the root
 *  has no parent and returns ROOT_FOLDER_ID itself (a self-referential sentinel, so a walk up the tree
 *  terminates rather than throwing). */
export function parentFolderId(folderId: string): string {
   if (folderId === ROOT_FOLDER_ID) return ROOT_FOLDER_ID
   const lastSlash = folderId.lastIndexOf('/')
   return lastSlash === -1 ? ROOT_FOLDER_ID : folderId.slice(0, lastSlash)
}

/** The folder's display name, its last path segment. The root has no segment and returns '' (the
 *  Binder name is app furniture, supplied elsewhere, not derived from the path). */
export function folderName(folderId: string): string {
   if (folderId === ROOT_FOLDER_ID) return ''
   const lastSlash = folderId.lastIndexOf('/')
   return lastSlash === -1 ? folderId : folderId.slice(lastSlash + 1)
}

// ##############
// # FILENAMES #
// ##############

/**
 * Map a freeform title to a valid, portable filename stem: the deterministic projection at the heart of
 * the native filename policy (docs/native/filename-policy.md). Portable = the strictest common rules
 * (Windows), so a Binder copies cleanly across OSes. Illegal characters are REPLACED where a substitute
 * keeps the title legible and removed otherwise, never suffixed with a number (uniqueness lives on the
 * title, see nextAvailableTitle).
 *
 * MUST be idempotent: sanitizeForFilename(sanitizeForFilename(x)) === sanitizeForFilename(x). Every step
 * lands on a form the next pass leaves untouched (no illegal char it re-substitutes, single-spaced, no
 * leading/trailing filler, a `_`-folded reserved base that is no longer reserved), so the invariant is
 * stable once established.
 */
export function sanitizeForFilename(title: string): string {
   let stem = title
      // Replace where a substitute reads naturally, so a title stays recognizable in the folder.
      .replace(/:/g, ' - ')          // a colon reads as a subtitle separator ("Report: Q4" -> "Report - Q4")
      .replace(/[/\\]/g, '-')        // a path separator becomes a plain dash
      // Remove the rest outright: no readable substitute, and they are forbidden or control.
      .replace(/[<>"|?*]/g, '')
      .replace(/[\x00-\x1F]/g, '')

   // Collapse whitespace runs to one space, then the ` - - ` spacer runs a chain of colons/slashes creates
   // ("Report::Q4" -> "Report - - Q4" -> "Report - Q4") back down to a single spaced dash.
   stem = stem.replace(/\s+/g, ' ').replace(/ (?:- ){2,}/g, ' - ')

   // Trim leading/trailing whitespace, dots and dashes (Windows forbids a trailing dot or space).
   stem = trimFilenameFiller(stem)

   // Cap the length, then re-trim so a cut cannot leave trailing filler.
   if (stem.length > MAX_STEM_LENGTH) stem = trimFilenameFiller(stem.slice(0, MAX_STEM_LENGTH))

   if (stem === '') return UNTITLED_FILE_STEM

   // Reserved device name (with or without an extension): fold a `_` into the BASE name, not the tail, so
   // the result is no longer reserved AND a second pass leaves it alone (CON.txt -> CON_.txt, not CON.txt_).
   const dotIndex = stem.indexOf('.')
   const baseName = dotIndex === -1 ? stem : stem.slice(0, dotIndex)
   if (RESERVED_DEVICE_NAMES.has(baseName.toUpperCase())) {
      return dotIndex === -1 ? `${stem}_` : `${baseName}_${stem.slice(dotIndex)}`
   }
   return stem
}

/** Strip leading/trailing whitespace, dots and dashes, the filesystem filler a title can leave at either
 *  end after substitution. Shared by sanitizeForFilename so the pre-cap and post-cap trims stay identical. */
function trimFilenameFiller(stem: string): string {
   return stem.replace(/^[\s.\-]+/, '').replace(/[\s.\-]+$/, '')
}

/** The on-disk `.mint` file name for a document title: the sanitized stem plus the extension, nothing
 *  more. Collisions are NOT resolved here (no numeric suffix) because the invariant must stay exact:
 *  stem === sanitizeForFilename(title). Two documents cannot share a stem in one folder, so the backend
 *  keeps them apart on the TITLE (nextAvailableTitle) before ever reaching this. */
export function mintFileName(title: string): string {
   return sanitizeForFilename(title) + MINT_EXTENSION
}

/**
 * The effective title for a new document in a folder, bumped so its sanitized stem is free. Returns the
 * desired title unchanged when its stem is not already taken; otherwise appends " 1", " 2", ... to a base
 * title until the stem is free, and returns that TITLE (not the stem), so the caller writes it into the
 * file and derives the filename from it. An empty desired title stays empty when free (the file is still
 * "Untitled.mint" via mintFileName) but bumps against the untitled stem to "Untitled 1", "Untitled 2".
 *
 * Compare is case-insensitive (the taken stems are lowercased), matching the filesystem's own handling on
 * Windows / macOS: two titles that sanitize to the same stem in any case count as a collision.
 */
export function nextAvailableTitle(desiredTitle: string, takenStems: ReadonlySet<string>): string {
   const takenLower = new Set<string>()
   for (const stem of takenStems) takenLower.add(stem.toLowerCase())
   const isFree = (title: string): boolean => !takenLower.has(sanitizeForFilename(title).toLowerCase())

   if (isFree(desiredTitle)) return desiredTitle

   // Bump off a non-empty base ("Report" -> "Report 1"); an empty title bumps off the untitled default
   // ("" -> "Untitled 1") so the number reads against a real word, never a bare " 1".
   const base = desiredTitle.trim() === '' ? UNTITLED_FILE_STEM : desiredTitle
   for (let counter = 1; ; counter++) {
      const candidate = `${base} ${counter}`
      if (isFree(candidate)) return candidate
   }
}

/** The on-disk `.mintplate` file name for a template name, unique within `.templates`. Templates keep the
 *  slug scheme (slug the display name, suffix on collision) rather than the document title-projection:
 *  they are few, named-by-id, and never subject to the title-level uniqueness policy. An empty name slugs
 *  the untitled default back to lowercase for parity with slugify's own output. */
export function mintplateFileName(name: string, taken: ReadonlySet<string>): string {
   const stem = name.trim() === '' ? slugify(UNTITLED_FILE_STEM) : slugify(name)
   const takenLower = new Set<string>()
   for (const existing of taken) takenLower.add(existing.toLowerCase())
   const base = stem + MINTPLATE_EXTENSION
   if (!takenLower.has(base.toLowerCase())) return base
   let suffix = 2
   for (;;) {
      const candidate = `${stem}-${suffix}${MINTPLATE_EXTENSION}`
      if (!takenLower.has(candidate.toLowerCase())) return candidate
      suffix += 1
   }
}

/** Pick a sibling folder name not already taken, appending " 2", " 3", ... (space-separated, Explorer's
 *  own convention, NOT the "-2" file-stem scheme, since a folder name is a display name not a slug) until
 *  it is free. Collision compare is case-insensitive, matching the filesystem's own folder-name handling.
 *  A folder's id IS its relative path, so two same-name siblings cannot coexist on disk; this is the
 *  DELIBERATE native-canonical divergence from the IndexedDB backend, which allowed same-name siblings
 *  (distinct UUIDs). IDB is deleted in arc D, so this becomes the only behaviour. */
export function dedupeFolderName(desiredName: string, takenSiblingNames: ReadonlySet<string>): string {
   const takenLower = new Set<string>()
   for (const name of takenSiblingNames) takenLower.add(name.toLowerCase())
   if (!takenLower.has(desiredName.toLowerCase())) return desiredName
   let suffix = 2
   for (;;) {
      const candidate = `${desiredName} ${suffix}`
      if (!takenLower.has(candidate.toLowerCase())) return candidate
      suffix += 1
   }
}

// ##########
// # JOINS #
// ##########

/** Join a relative directory and a name into a relative POSIX path, with no leading `./`. A root
 *  directory ('' after normalization) yields the bare name. */
export function joinRelative(dir: string, name: string): string {
   const cleanDir = normalizeRelativePosix(dir)
   return cleanDir === '' ? name : `${cleanDir}/${name}`
}

/** The relative path a document is stored (and indexed) under: its folder's directory joined to its
 *  file name. This is the `path` the index maps the document id to. */
export function relativePathForDocument(folderId: string, fileName: string): string {
   return joinRelative(relativeDirForFolderId(folderId), fileName)
}
