import { useCallback, useEffect, useState } from 'react'
import type { BinderFolderRecord } from '../types'
import { useBinderBackend } from '../contexts/BinderBackendContext'

interface UseBinderNavResult {
   subfolders:           BinderFolderRecord[]   // immediate children of the current folder
   ancestors:            BinderFolderRecord[]   // [root-most ... immediate parent] of the current folder
   folderDocumentCounts: Record<string, number> // folderId -> direct document count (all folders)
   isLoading:            boolean
   createFolder:   (parentId: string, name: string) => Promise<string>
   renameFolder:   (id: string, name: string) => Promise<void>
   deleteFolder:   (id: string, recursive: boolean) => Promise<string[]>
   reorderFolders: (orderedIds: string[]) => Promise<void>
   moveFolder:     (id: string, targetParentId: string) => Promise<void>
}

/**
 * Drill-down folder navigation: loads the current folder's immediate subfolders, its
 * ancestor chain (for the breadcrumb), and per-folder document counts. Re-reads whenever
 * the current folder or the shared data version changes. Folder mutations bump the version
 * via onChanged so both the nav and the document grid refresh together.
 */
export function useBinderNav(currentFolderId: string, dataVersion: number, onChanged: () => void): UseBinderNavResult {
   const backend = useBinderBackend()
   const [subfolders, setSubfolders]                     = useState<BinderFolderRecord[]>([])
   const [ancestors, setAncestors]                       = useState<BinderFolderRecord[]>([])
   const [folderDocumentCounts, setFolderDocumentCounts] = useState<Record<string, number>>({})
   const [isLoading, setIsLoading]                       = useState(true)

   useEffect(() => {
      let active = true
      Promise.all([
         backend.getFolderChildren(currentFolderId),
         backend.getFolderAncestors(currentFolderId),
         backend.listDocuments(),
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
   }, [currentFolderId, dataVersion, backend])

   const createFolder = useCallback(async (parentId: string, name: string) => {
      const id = await backend.createFolder(parentId, name)
      onChanged()
      return id
   }, [onChanged, backend])

   const renameFolder = useCallback(async (id: string, name: string) => {
      await backend.renameFolder(id, name)
      onChanged()
   }, [onChanged, backend])

   const deleteFolder = useCallback(async (id: string, recursive: boolean) => {
      const deletedDocumentIds = await backend.deleteFolder(id, { recursive })
      onChanged()
      return deletedDocumentIds
   }, [onChanged, backend])

   const reorderFolders = useCallback(async (orderedIds: string[]) => {
      // Optimistic: apply the new order in the same frame as the drop (the persist + re-read are
      // async, without this the old order flashes and the drop animation lands on a stale slot).
      setSubfolders(current => {
         const byId = new Map(current.map(folder => [folder.id, folder]))
         const next = orderedIds
            .map(id => byId.get(id))
            .filter((folder): folder is BinderFolderRecord => folder !== undefined)
         return next.length === current.length ? next : current
      })
      await backend.reorderFolders(orderedIds)
      onChanged()
   }, [onChanged, backend])

   const moveFolder = useCallback(async (id: string, targetParentId: string) => {
      // Optimistic: the folder leaves the current level (nested into a sibling, or moved up), so
      // drop it from the visible list immediately; the re-read confirms.
      setSubfolders(current => current.filter(folder => folder.id !== id))
      await backend.moveFolder(id, targetParentId)
      onChanged()
   }, [onChanged, backend])

   return { subfolders, ancestors, folderDocumentCounts, isLoading, createFolder, renameFolder, deleteFolder, reorderFolders, moveFolder }
}
