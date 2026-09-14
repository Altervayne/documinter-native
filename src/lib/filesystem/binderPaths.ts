/**
 * binderPaths.ts, the path <-> id derivations, the `.mint` filename scheme, and the system-folder rule.
 *
 * Pure helpers over the Binder's folder tree. The identity decisions from the arc-A design live here:
 * a folder's id IS its relative path from the Binder root (a directory carries no UUID), except the
 * root, whose id is the reserved ROOT_FOLDER_ID; a document's on-disk name is slug(title).mint with a
 * numeric suffix on collision, its stable id riding INSIDE the file (see mintFile.ts).
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

/** The stem used when a document has no sluggable title, so an untitled document still names a valid,
 *  non-empty file (slugify handles the transform for real titles; this covers the empty case). */
export const UNTITLED_FILE_STEM = 'untitled'

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

/** Pick a filename not already in `taken`, appending -2, -3, ... to the stem before the extension until
 *  it is free. Collision compare is case-insensitive: Windows and macOS default filesystems treat
 *  `Doc.mint` and `doc.mint` as the same file, so a case-only difference must still count as taken. */
function uniqueFileName(stem: string, extension: string, taken: ReadonlySet<string>): string {
   const takenLower = new Set<string>()
   for (const name of taken) takenLower.add(name.toLowerCase())
   const base = stem + extension
   if (!takenLower.has(base.toLowerCase())) return base
   let suffix = 2
   for (;;) {
      const candidate = `${stem}-${suffix}${extension}`
      if (!takenLower.has(candidate.toLowerCase())) return candidate
      suffix += 1
   }
}

/** The on-disk `.mint` file name for a document title, unique within its target directory. slug(title)
 *  is the human-readable stem (a transparent folder is the whole point); an empty/whitespace title falls
 *  back to UNTITLED_FILE_STEM so the name is never bare. The caller supplies the set of names already
 *  taken in the destination directory, keeping this pure. */
export function mintFileName(title: string, taken: ReadonlySet<string>): string {
   const stem = title.trim() === '' ? UNTITLED_FILE_STEM : slugify(title)
   return uniqueFileName(stem, MINT_EXTENSION, taken)
}

/** The on-disk `.mintplate` file name for a template name, unique within `.templates`. Same scheme as
 *  mintFileName (slug the display name, fall back to the untitled stem, suffix on collision); the stable
 *  identity is the template id INSIDE the file, so the name is purely for a readable folder. */
export function mintplateFileName(name: string, taken: ReadonlySet<string>): string {
   const stem = name.trim() === '' ? UNTITLED_FILE_STEM : slugify(name)
   return uniqueFileName(stem, MINTPLATE_EXTENSION, taken)
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
