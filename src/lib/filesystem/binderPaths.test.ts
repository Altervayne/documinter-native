import { describe, it, expect } from 'vitest'
import {
   isSystemFolderName,
   folderIdForRelativePath, relativeDirForFolderId,
   parentFolderId, folderName,
   mintFileName, dedupeFolderName, UNTITLED_FILE_STEM,
   joinRelative, relativePathForDocument,
   DOCUMINTER_DIR, TEMPLATES_DIR, MINT_EXTENSION,
} from './binderPaths'
import { ROOT_FOLDER_ID } from '../binderDatabase'

describe('isSystemFolderName', () => {
   it('treats dot-prefixed folders as system folders and normal ones as user content', () => {
      expect(isSystemFolderName(DOCUMINTER_DIR)).toBe(true)
      expect(isSystemFolderName(TEMPLATES_DIR)).toBe(true)
      expect(isSystemFolderName('.hidden')).toBe(true)
      expect(isSystemFolderName('templates')).toBe(false)
      expect(isSystemFolderName('Field Notes')).toBe(false)
   })
})

describe('folder id <-> relative path round-trip', () => {
   it('maps the root to ROOT_FOLDER_ID and back to an empty relative path', () => {
      expect(folderIdForRelativePath('')).toBe(ROOT_FOLDER_ID)
      expect(folderIdForRelativePath('.')).toBe(ROOT_FOLDER_ID)
      expect(relativeDirForFolderId(ROOT_FOLDER_ID)).toBe('')
      expect(folderIdForRelativePath(relativeDirForFolderId(ROOT_FOLDER_ID))).toBe(ROOT_FOLDER_ID)
   })

   it('keeps a nested path as its own id and round-trips exactly', () => {
      expect(folderIdForRelativePath('work/reports')).toBe('work/reports')
      expect(relativeDirForFolderId('work/reports')).toBe('work/reports')
      expect(folderIdForRelativePath(relativeDirForFolderId('work/reports'))).toBe('work/reports')
   })

   it('normalizes leading, trailing, and dot segments', () => {
      expect(folderIdForRelativePath('/work/')).toBe('work')
      expect(folderIdForRelativePath('./work/reports/')).toBe('work/reports')
      expect(folderIdForRelativePath('work//reports')).toBe('work/reports')
   })
})

describe('parentFolderId', () => {
   it('returns the containing path, the root one segment deep, and itself for the root', () => {
      expect(parentFolderId('work/reports/2026')).toBe('work/reports')
      expect(parentFolderId('work')).toBe(ROOT_FOLDER_ID)
      expect(parentFolderId(ROOT_FOLDER_ID)).toBe(ROOT_FOLDER_ID)
   })
})

describe('folderName', () => {
   it('returns the last segment, and empty for the root', () => {
      expect(folderName('work/reports')).toBe('reports')
      expect(folderName('work')).toBe('work')
      expect(folderName(ROOT_FOLDER_ID)).toBe('')
   })
})

describe('mintFileName', () => {
   it('slugifies the title into a .mint name', () => {
      expect(mintFileName('Field Guide', new Set())).toBe('field-guide.mint')
   })

   it('appends -2, -3, ... on collision', () => {
      const taken = new Set(['field-guide.mint'])
      expect(mintFileName('Field Guide', taken)).toBe('field-guide-2.mint')
      taken.add('field-guide-2.mint')
      expect(mintFileName('Field Guide', taken)).toBe('field-guide-3.mint')
   })

   it('compares collisions case-insensitively (Windows / macOS filesystems)', () => {
      expect(mintFileName('Field Guide', new Set(['FIELD-GUIDE.MINT']))).toBe('field-guide-2.mint')
   })

   it('falls back to the untitled stem for an empty or whitespace title', () => {
      expect(mintFileName('', new Set())).toBe(`${UNTITLED_FILE_STEM}${MINT_EXTENSION}`)
      expect(mintFileName('   ', new Set())).toBe(`${UNTITLED_FILE_STEM}${MINT_EXTENSION}`)
   })
})

describe('dedupeFolderName', () => {
   it('returns the desired name unchanged when no sibling holds it', () => {
      expect(dedupeFolderName('Drafts', new Set())).toBe('Drafts')
      expect(dedupeFolderName('Drafts', new Set(['Reports', 'Archive']))).toBe('Drafts')
   })

   it('appends " 2", " 3", ... (space-separated, Explorer-style) on collision', () => {
      expect(dedupeFolderName('Drafts', new Set(['Drafts']))).toBe('Drafts 2')
      expect(dedupeFolderName('Drafts', new Set(['Drafts', 'Drafts 2']))).toBe('Drafts 3')
      expect(dedupeFolderName('Drafts', new Set(['Drafts', 'Drafts 2', 'Drafts 3']))).toBe('Drafts 4')
   })

   it('compares collisions case-insensitively (Windows / macOS filesystems)', () => {
      expect(dedupeFolderName('Drafts', new Set(['DRAFTS']))).toBe('Drafts 2')
      expect(dedupeFolderName('Drafts', new Set(['drafts', 'DRAFTS 2']))).toBe('Drafts 3')
   })

   it('preserves the display name spelling (no slugging), unlike the file-name scheme', () => {
      expect(dedupeFolderName('Field Notes', new Set(['Field Notes']))).toBe('Field Notes 2')
   })
})

describe('joinRelative / relativePathForDocument', () => {
   it('joins a directory and name with no leading ./ and treats root as the bare name', () => {
      expect(joinRelative('work/reports', 'q1.mint')).toBe('work/reports/q1.mint')
      expect(joinRelative('', 'q1.mint')).toBe('q1.mint')
      expect(joinRelative('.', 'q1.mint')).toBe('q1.mint')
   })

   it('builds a document path from its folder id and file name', () => {
      expect(relativePathForDocument('work/reports', 'q1.mint')).toBe('work/reports/q1.mint')
      expect(relativePathForDocument(ROOT_FOLDER_ID, 'q1.mint')).toBe('q1.mint')
   })
})
