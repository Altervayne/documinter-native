/**
 * Pure path/id helpers over the Binder's folder tree, plus the `.mint` filename scheme. A folder's id IS
 * its relative POSIX path from the root (ROOT_FOLDER_ID for the root itself); a document's filename is
 * sanitizeForFilename(title) + .mint, with its stable id riding inside the file (see mintFile.ts). All
 * paths here are POSIX; the filesystem backend converts OS separators at the plugin-fs boundary.
 */

import { slugify } from '../text'
import { ROOT_FOLDER_ID } from '../binderDatabase'

// #############
// # CONSTANTS #
// #############

/** Rebuildable cache folder. Dot-prefixed, so isSystemFolderName excludes it. */
export const DOCUMINTER_DIR = '.documinter'
/** Template source folder (`*.mintplate`), also dot-prefixed and excluded from the tree. */
export const TEMPLATES_DIR = '.templates'
export const MINT_EXTENSION = '.mint'
export const MINTPLATE_EXTENSION = '.mintplate'
export const INDEX_FILE = 'index.sqlite'

/** Fallback stem and default title for a document whose title sanitizes to nothing. Title-cased since
 *  sanitizeForFilename preserves case, and nextAvailableTitle bumps it ("Untitled" -> "Untitled 1"). */
export const UNTITLED_FILE_STEM = 'Untitled'

/** Windows reserved device names (case-insensitive). A stem equal to one gets a `_` folded into its base. */
const RESERVED_DEVICE_NAMES = new Set<string>([
   'CON', 'PRN', 'AUX', 'NUL',
   'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
   'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/** Stem cap, so `folderPath/stem.mint` stays under the ~255 path limit even nested deep. */
const MAX_STEM_LENGTH = 120

// ####################
// # SYSTEM FOLDER RULE #
// ####################

/** The one tree rule: a dot-prefixed folder is a system folder, excluded from the document tree. */
export function isSystemFolderName(name: string): boolean {
   return name.startsWith('.')
}

// ##################
// # FOLDER IDENTITY #
// ##################

function normalizeRelativePosix(path: string): string {
   return path.split('/').filter(segment => segment !== '' && segment !== '.').join('/')
}

/** Folder id for a relative dir: the root maps to ROOT_FOLDER_ID, every other folder's id IS its path. */
export function folderIdForRelativePath(relativeDir: string): string {
   const normalized = normalizeRelativePosix(relativeDir)
   return normalized === '' ? ROOT_FOLDER_ID : normalized
}

export function relativeDirForFolderId(folderId: string): string {
   return folderId === ROOT_FOLDER_ID ? '' : folderId
}

/** The containing folder's id. The root returns itself, a sentinel so a walk up the tree terminates. */
export function parentFolderId(folderId: string): string {
   if (folderId === ROOT_FOLDER_ID) return ROOT_FOLDER_ID
   const lastSlash = folderId.lastIndexOf('/')
   return lastSlash === -1 ? ROOT_FOLDER_ID : folderId.slice(0, lastSlash)
}

export function folderName(folderId: string): string {
   if (folderId === ROOT_FOLDER_ID) return ''
   const lastSlash = folderId.lastIndexOf('/')
   return lastSlash === -1 ? folderId : folderId.slice(lastSlash + 1)
}

// ##############
// # FILENAMES #
// ##############

/**
 * Map a freeform title to a valid, portable (Windows-strict) filename stem: the deterministic projection
 * at the heart of the filename policy. Illegal chars are replaced where a substitute stays legible, else
 * removed; never numbered (uniqueness lives on the title, see nextAvailableTitle). MUST be idempotent, so
 * the invariant stem === sanitizeForFilename(title) holds once established.
 */
export function sanitizeForFilename(title: string): string {
   let stem = title
      .replace(/:/g, ' - ')          // a colon reads as a subtitle separator ("Report: Q4" -> "Report - Q4")
      .replace(/[/\\]/g, '-')        // a path separator becomes a plain dash
      .replace(/[<>"|?*]/g, '')
      .replace(/[\x00-\x1F]/g, '')

   // Collapse whitespace, then the ` - - ` runs a chain of colons/slashes leaves ("Report::Q4" -> "Report - Q4").
   stem = stem.replace(/\s+/g, ' ').replace(/ (?:- ){2,}/g, ' - ')

   stem = trimFilenameFiller(stem)
   if (stem.length > MAX_STEM_LENGTH) stem = trimFilenameFiller(stem.slice(0, MAX_STEM_LENGTH))
   if (stem === '') return UNTITLED_FILE_STEM

   // Fold the `_` into the BASE, not the tail, so the result is not reserved and a second pass leaves it
   // alone (CON.txt -> CON_.txt, not CON.txt_).
   const dotIndex = stem.indexOf('.')
   const baseName = dotIndex === -1 ? stem : stem.slice(0, dotIndex)
   if (RESERVED_DEVICE_NAMES.has(baseName.toUpperCase())) {
      return dotIndex === -1 ? `${stem}_` : `${baseName}_${stem.slice(dotIndex)}`
   }
   return stem
}

function trimFilenameFiller(stem: string): string {
   return stem.replace(/^[\s.\-]+/, '').replace(/[\s.\-]+$/, '')
}

/** The `.mint` file name for a title: the sanitized stem plus the extension. No collision suffix; the
 *  backend keeps stems unique on the TITLE (nextAvailableTitle) before reaching here. */
export function mintFileName(title: string): string {
   return sanitizeForFilename(title) + MINT_EXTENSION
}

/**
 * The effective title for a new document in a folder, bumped so its sanitized stem is free. Appends " 1",
 * " 2", ... to the desired title (an empty title bumps off UNTITLED_FILE_STEM) and returns the TITLE, so
 * the caller writes it into the file and derives the filename from it. Case-insensitive, matching the
 * filesystem.
 */
export function nextAvailableTitle(desiredTitle: string, takenStems: ReadonlySet<string>): string {
   const takenLower = new Set<string>()
   for (const stem of takenStems) takenLower.add(stem.toLowerCase())
   const isFree = (title: string): boolean => !takenLower.has(sanitizeForFilename(title).toLowerCase())

   if (isFree(desiredTitle)) return desiredTitle

   const base = desiredTitle.trim() === '' ? UNTITLED_FILE_STEM : desiredTitle
   for (let counter = 1; ; counter++) {
      const candidate = `${base} ${counter}`
      if (isFree(candidate)) return candidate
   }
}

/** The `.mintplate` file name for a template. Templates keep the slug scheme (slug + `-2` on collision),
 *  not the document title-projection: they are few and named by id, outside the title-uniqueness policy. */
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

/** Pick a sibling folder name not already taken, appending " 2", " 3", ... (Explorer's convention, not the
 *  "-2" stem scheme, since a folder name is a display name). A folder's id IS its path, so two same-name
 *  siblings cannot coexist; this is the deliberate divergence from the IndexedDB backend (distinct UUIDs). */
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

export function joinRelative(dir: string, name: string): string {
   const cleanDir = normalizeRelativePosix(dir)
   return cleanDir === '' ? name : `${cleanDir}/${name}`
}

export function relativePathForDocument(folderId: string, fileName: string): string {
   return joinRelative(relativeDirForFolderId(folderId), fileName)
}
