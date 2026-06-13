import { useCallback, useEffect, useState } from 'react'
import type { BinderFolderRecord } from '../types'
import {
   getFolderChildren, getFolderAncestors, listDocuments,
   createFolder as storageCreateFolder, renameFolder as storageRenameFolder,
   deleteFolder as storageDeleteFolder, reorderFolders as storageReorderFolders,
} from '../lib/storage'

interface UseBinderNavResult {
   subfolders:           BinderFolderRecord[]   // immediate children of the current folder
   ancestors:            BinderFolderRecord[]   // [root-most … immediate parent] of the current folder
   folderDocumentCounts: Record<string, number> // folderId → direct document count (all folders)
   isLoading:            boolean
   createFolder:   (parentId: string, name: string) => Promise<string>
   renameFolder:   (id: string, name: string) => Promise<void>
   deleteFolder:   (id: string) => Promise<void>
   reorderFolders: (orderedIds: string[]) => Promise<void>
}

/**
 * Drill-down folder navigation: loads the current folder's immediate subfolders, its
 * ancestor chain (for the breadcrumb), and per-folder document counts. Re-reads whenever
 * the current folder or the shared data version changes. Folder mutations bump the version
 * via onChanged so both the nav and the document grid refresh together.
 */
export function useBinderNav(currentFolderId: string, dataVersion: number, onChanged: () => void): UseBinderNavResult {
   const [subfolders, setSubfolders]                     = useState<BinderFolderRecord[]>([])
   const [ancestors, setAncestors]                       = useState<BinderFolderRecord[]>([])
   const [folderDocumentCounts, setFolderDocumentCounts] = useState<Record<string, number>>({})
   const [isLoading, setIsLoading]                       = useState(true)

   useEffect(() => {
      let active = true
      Promise.all([
         getFolderChildren(currentFolderId),
         getFolderAncestors(currentFolderId),
         listDocuments(),
      ]).then(([children, ancestorChain, allDocuments]) => {
         if (!active) return
         setSubfolders(children)
         setAncestors(ancestorChain)
         const counts: Record<string, number> = {}
         for (const document of allDocuments) counts[document.folderId] = (counts[document.folderId] ?? 0) + 1
         setFolderDocumentCounts(counts)
         setIsLoading(false)
      }).catch(() => { if (active) setIsLoading(false) })
      return () => { active = false }
   }, [currentFolderId, dataVersion])

   const createFolder = useCallback(async (parentId: string, name: string) => {
      const id = await storageCreateFolder(name, parentId)
      onChanged()
      return id
   }, [onChanged])

   const renameFolder = useCallback(async (id: string, name: string) => {
      await storageRenameFolder(id, name)
      onChanged()
   }, [onChanged])

   const deleteFolder = useCallback(async (id: string) => {
      await storageDeleteFolder(id)
      onChanged()
   }, [onChanged])

   const reorderFolders = useCallback(async (orderedIds: string[]) => {
      await storageReorderFolders(orderedIds)
      onChanged()
   }, [onChanged])

   return { subfolders, ancestors, folderDocumentCounts, isLoading, createFolder, renameFolder, deleteFolder, reorderFolders }
}
