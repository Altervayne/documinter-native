// -- React Imports --
import { useCallback, useEffect, useRef, useState } from 'react'
import { PointerSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib Imports --
import { getFolderAncestors } from '../lib/binderFolders'

// -- Hook / Type Imports --
import { useBinderDocuments } from './useBinderDocuments'
import { useBinderNav } from './useBinderNav'
import type { BinderDocumentRecord, BinderFolderRecord } from '../types'
import type { FolderDropTarget } from '../organisms/Binder/BinderNav'

// Which drop a card-over-nav will perform: into the hovered folder (down a level), to the
// current folder's parent via the Back button (up a level), or nothing.
export type DropIntent = 'down' | 'up' | null

// The item currently being dragged: a document card (carries its record) or a folder (id + label).
export type ActiveDrag =
   | { type: 'doc'; record: BinderDocumentRecord }
   | { type: 'folder'; id: string; label: string }

// Spring-loaded navigation: dwelling on a folder / Back button for this long during a drag
// navigates there (drilling in / up) without ending the drag, so items can be moved many levels.
export const SPRING_HOLD_MS = 900
type SpringTarget = { kind: 'folder'; id: string } | { kind: 'back' }

/** Drag ids are namespaced so onDragEnd can tell documents from folders. */
type DragItem = { type: 'doc' | 'folder'; id: string }
function parseDragId(raw: string): DragItem | null {
   if (raw.startsWith('doc:'))    return { type: 'doc',    id: raw.slice(4) }
   if (raw.startsWith('folder:')) return { type: 'folder', id: raw.slice(7) }
   return null
}

interface UseBinderDragAndDropOptions {
   docs:                   ReturnType<typeof useBinderDocuments>
   nav:                    ReturnType<typeof useBinderNav>
   navigateTo:             (folder: BinderFolderRecord | null) => void
   currentFolder:          BinderFolderRecord | null
   currentFolderId:        string
   /** Card-on-card reorder only persists under manual sort with no active search. */
   manualSortActive:       boolean
   /** Clear the selected document after a move (selection state lives in the binder root). */
   clearDocumentSelection: () => void
}

/**
 * Owns the binder's entire drag-and-drop subsystem: the dnd-kit sensors + drag handlers, the
 * cursor-"puck" morph driven by a window pointermove listener (direct DOM writes), back/cancel/
 * folder hit-testing via refs, spring-loaded folder navigation (dwell timer + ring), and native
 * file-drop import. State stays local to the binder subtree; the root binds the returned handlers
 * to DndContext and renders the overlay/nav from the returned state + refs.
 */
export function useBinderDragAndDrop({
   docs, nav, navigateTo, currentFolder, currentFolderId, manualSortActive, clearDocumentSelection,
}: UseBinderDragAndDropOptions) {
   const { documents, handleMove, handleReorder, handleImportJSON } = docs
   const { subfolders, ancestors, moveFolder, reorderFolders } = nav

   // =========================
   //  Drag-and-drop file import
   // =========================
   // Native HTML5 file drops (from the OS file explorer) are a separate system from dnd-kit's
   // pointer-based card dragging, so the two never collide. A dropped .documinter.json becomes a
   // new document in the folder currently being viewed.
   const [isFileDragOver, setIsFileDragOver] = useState(false)

   const handleFileDragOver = useCallback((event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return   // ignore non-file drags
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsFileDragOver(true)
   }, [])

   const handleFileDragLeave = useCallback((event: React.DragEvent) => {
      // Native dragleave also fires when crossing between child elements, only clear when the
      // cursor has actually left the drop container.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setIsFileDragOver(false)
   }, [])

   const handleFileDrop = useCallback((event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setIsFileDragOver(false)
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) void handleImportJSON(files, currentFolderId)
   }, [handleImportJSON, currentFolderId])

   // ============
   //  Drag & drop
   // ============
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
   // Drag overlay morph: over the nav, the card clone funnels into a cursor "puck" (dot + pill).
   const navRef          = useRef<HTMLDivElement>(null)
   const backRef         = useRef<HTMLButtonElement>(null)   // Back button, up-drop hit target
   const clusterRef      = useRef<HTMLDivElement>(null)      // the puck, pinned to the live cursor
   const overlayCardRef  = useRef<HTMLDivElement>(null)      // the full-card clone (funnels into the dot)
   const grabCapturedRef = useRef(false)                     // funnel origin captured once per drag
   const overBackRef     = useRef(false)                     // cursor over Back button (read at drop)
   const cancelRef       = useRef<HTMLDivElement>(null)      // Cancel-move dropzone hit target
   const overCancelRef   = useRef(false)                     // cursor over the Cancel-move zone (read at drop)
   const folderTargetRef = useRef<FolderDropTarget | null>(null)   // folder drag: hovered row + zone (read at drop)
   const [isOverNav, setIsOverNav]         = useState(false)
   const [overCancel, setOverCancel]       = useState(false)
   const [overBack, setOverBack]           = useState(false)
   const [isOverFolder, setIsOverFolder]   = useState(false)
   const [folderTarget, setFolderTarget]   = useState<FolderDropTarget | null>(null)
   const isDocDragging    = activeDrag?.type === 'doc'
   const isFolderDragging = activeDrag?.type === 'folder'
   const draggedFolderId  = activeDrag?.type === 'folder' ? activeDrag.id : null

   // Spring-loaded navigation state: a dwell timer, the current dwell target, and a progress ring.
   const springTimerRef  = useRef<number | null>(null)
   const springTargetRef = useRef<SpringTarget | null>(null)
   const [springActive, setSpringActive] = useState(false)   // ring visible
   const [springRunId, setSpringRunId]   = useState(0)        // bump to restart the ring animation
   // Kept fresh so the (delayed) dwell timer navigates against the current view, not a stale closure.
   const springDataRef = useRef({ subfolders, ancestors, navigateTo })

   const resetSpring = useCallback(() => {
      if (springTimerRef.current !== null) { clearTimeout(springTimerRef.current); springTimerRef.current = null }
      springTargetRef.current = null
      setSpringActive(false)
   }, [])

   // Sync the data the dwell timer needs every render (the timer fires long after the closure that
   // started it, possibly after a navigation, so it must read the live view).
   useEffect(() => {
      springDataRef.current = { subfolders, ancestors, navigateTo }
   })

   // Puck visibility + direction differ by drag kind: a card morphs over the whole nav; a folder
   // morphs only when it would actually move (nested into a folder, or up via the Back button).
   const folderNest   = isFolderDragging && folderTarget?.zone === 'nest'
   const puckVisible  = isDocDragging ? isOverNav : (isFolderDragging && (overBack || Boolean(folderNest)))
   const puckIntent: DropIntent = overBack ? 'up' : (isDocDragging ? (isOverFolder ? 'down' : null) : (folderNest ? 'down' : null))

   // While anything is dragging, follow the real cursor: pin the puck to it and flag the Back
   // button (up-drop). For a card: nav-panel hover (card->puck morph) + funnel origin. For a folder:
   // hit-test the folder rows to derive the hovered row + zone (top/bottom edge = reorder, center =
   // nest). Direct DOM writes where possible, no re-render unless a tracked value changes.
   useEffect(() => {
      if (!isDocDragging && !isFolderDragging) return
      const inside = (rect: DOMRect | undefined, x: number, y: number) =>
         Boolean(rect) && x >= rect!.left && x <= rect!.right && y >= rect!.top && y <= rect!.bottom

      // Restart / clear the dwell timer + ring as the navigable target changes; fire navigation
      // (drill into a folder, or up via Back) when the cursor holds the same target for SPRING_HOLD_MS.
      const updateSpring = (next: SpringTarget | null) => {
         const previous = springTargetRef.current
         const same = (!previous && !next)
            || (!!previous && !!next && previous.kind === next.kind
                && (previous.kind !== 'folder' || previous.id === (next as { id?: string }).id))
         if (same) return
         if (springTimerRef.current !== null) { clearTimeout(springTimerRef.current); springTimerRef.current = null }
         springTargetRef.current = next
         if (!next) { setSpringActive(false); return }
         setSpringActive(true)
         setSpringRunId(runId => runId + 1)
         springTimerRef.current = window.setTimeout(() => {
            springTimerRef.current = null
            springTargetRef.current = null
            setSpringActive(false)
            const { subfolders: liveSubfolders, ancestors: liveAncestors, navigateTo: navTo } = springDataRef.current
            if (next.kind === 'back') navTo(liveAncestors.length > 0 ? liveAncestors[liveAncestors.length - 1] : null)
            else {
               const folder = liveSubfolders.find(candidate => candidate.id === next.id)
               if (folder) navTo(folder)
            }
         }, SPRING_HOLD_MS)
      }

      const handlePointerMove = (event: PointerEvent) => {
         const { clientX: x, clientY: y } = event
         if (clusterRef.current) {
            clusterRef.current.style.left = `${x}px`
            clusterRef.current.style.top  = `${y}px`
         }
         const overNav      = inside(navRef.current?.getBoundingClientRect(),    x, y)
         const overBackNow  = inside(backRef.current?.getBoundingClientRect(),   x, y)
         const overCancelNow = inside(cancelRef.current?.getBoundingClientRect(), x, y)
         overBackRef.current   = overBackNow
         overCancelRef.current = overCancelNow
         setOverBack(overBackNow)
         setOverCancel(overCancelNow)

         // Folder row directly under the cursor (geometry; excludes the dragged folder itself).
         let hovered: FolderDropTarget | null = null
         if (!overBackNow && navRef.current) {
            for (const row of navRef.current.querySelectorAll<HTMLElement>('[data-folder-id]')) {
               const rect = row.getBoundingClientRect()
               if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
               const id = row.getAttribute('data-folder-id')
               if (id && id !== draggedFolderId) {
                  const ratio = (y - rect.top) / rect.height
                  hovered = { id, zone: ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'nest' }
               }
               break
            }
         }

         if (isDocDragging) {
            setIsOverNav(overNav)
            // Capture the grab point once (while the card is still full-size) so the collapse
            // funnels toward the cursor rather than the card's center.
            if (!grabCapturedRef.current && !overNav && overlayCardRef.current) {
               const cardRect = overlayCardRef.current.getBoundingClientRect()
               overlayCardRef.current.style.transformOrigin = `${x - cardRect.left}px ${y - cardRect.top}px`
               grabCapturedRef.current = true
            }
            // A card springs into any hovered folder, or up via Back.
            updateSpring(overBackNow ? { kind: 'back' } : hovered ? { kind: 'folder', id: hovered.id } : null)
            return
         }

         // Folder drag: nest highlight / reorder line come from the hovered row + zone.
         setFolderTarget(hovered)
         folderTargetRef.current = hovered
         // A folder springs into a hovered folder's center (nest zone), or up via Back.
         updateSpring(overBackNow ? { kind: 'back' } : hovered?.zone === 'nest' ? { kind: 'folder', id: hovered.id } : null)
      }
      window.addEventListener('pointermove', handlePointerMove)
      return () => {
         window.removeEventListener('pointermove', handlePointerMove)
         if (springTimerRef.current !== null) { clearTimeout(springTimerRef.current); springTimerRef.current = null }
      }
   }, [isDocDragging, isFolderDragging, draggedFolderId])

   const handleDragStart = useCallback((event: DragStartEvent) => {
      const item = parseDragId(String(event.active.id))
      if (!item) return
      setIsOverNav(false)
      setOverBack(false)
      setIsOverFolder(false)
      setFolderTarget(null)
      setOverCancel(false)
      overBackRef.current     = false
      overCancelRef.current   = false
      folderTargetRef.current = null
      grabCapturedRef.current = false
      resetSpring()
      if (item.type === 'doc') {
         const record = documents.find(record => record.id === item.id)
         if (record) setActiveDrag({ type: 'doc', record })
      } else {
         const folder = subfolders.find(folder => folder.id === item.id)
         setActiveDrag({ type: 'folder', id: item.id, label: folder?.name ?? '' })
      }
   }, [documents, subfolders, resetSpring])

   // Nest folder A into B, rejected if B is a descendant of A (would create a cycle). Among the
   // visible siblings a cycle is impossible, but the full ancestor walk is validated regardless.
   const nestFolder = useCallback(async (folderId: string, targetParentId: string) => {
      const folderAncestors = await getFolderAncestors(targetParentId)
      if (folderAncestors.some(ancestor => ancestor.id === folderId)) return
      await moveFolder(folderId, targetParentId)
   }, [moveFolder])

   const handleDragEnd = useCallback((event: DragEndEvent) => {
      const droppedOnBack   = overBackRef.current
      const droppedOnCancel = overCancelRef.current
      const folderTargetNow = folderTargetRef.current
      setActiveDrag(null)
      setIsOverNav(false)
      setOverBack(false)
      setOverCancel(false)
      setIsOverFolder(false)
      setFolderTarget(null)
      overBackRef.current     = false
      overCancelRef.current   = false
      folderTargetRef.current = null
      resetSpring()

      // Dropped on the Cancel-move zone -> abort: no move, reorder, or navigation commit.
      if (droppedOnCancel) return

      const { active, over } = event
      const source = parseDragId(String(active.id))
      if (!source) return

      if (source.type === 'doc') {
         const record = documents.find(item => item.id === source.id)
         const isForeign = !record   // arrived in this view via spring-navigation, not a local doc

         // Drop on the Back button -> move the document up a level (to the current folder's parent).
         if (droppedOnBack && currentFolder) {
            if (!record || record.folderId !== currentFolder.parentId) {
               void handleMove(source.id, currentFolder.parentId)
               clearDocumentSelection()
            }
            return
         }
         const target = over && active.id !== over.id ? parseDragId(String(over.id)) : null
         if (target?.type === 'folder') {
            // Move into the dropped-on folder, unless it's already the doc's folder.
            if (record && record.folderId === target.id) return
            void handleMove(source.id, target.id)
            clearDocumentSelection()
            return
         }
         if (isForeign) {
            // Spring-navigated here from elsewhere -> land the document in the current folder.
            void handleMove(source.id, currentFolderId)
            clearDocumentSelection()
            return
         }
         if (target?.type === 'doc') {
            // Reorder documents, only meaningful (and only persisted) under manual sort.
            if (!manualSortActive) return
            const ids = documents.map(item => item.id)
            const oldIndex = ids.indexOf(source.id)
            const newIndex = ids.indexOf(target.id)
            if (oldIndex !== -1 && newIndex !== -1) void handleReorder(arrayMove(ids, oldIndex, newIndex))
         }
         return
      }

      // Folder drag, drops are driven by our own zone/Back detection, not dnd-kit `over`.
      if (droppedOnBack && currentFolder) {
         void moveFolder(source.id, currentFolder.parentId)   // up a level, always cycle-safe
         return
      }
      if (folderTargetNow?.zone === 'nest') {
         void nestFolder(source.id, folderTargetNow.id)
         return
      }
      const isNativeFolder = subfolders.some(folder => folder.id === source.id)
      if (!isNativeFolder) {
         // A folder spring-navigated here (foreign to this level) -> land it in the current folder.
         void nestFolder(source.id, currentFolderId)
      } else if (folderTargetNow) {
         // Reorder before/after the target among the visible siblings.
         const ids = subfolders.map(folder => folder.id).filter(id => id !== source.id)
         const targetIndex = ids.indexOf(folderTargetNow.id)
         if (targetIndex !== -1) {
            ids.splice(folderTargetNow.zone === 'before' ? targetIndex : targetIndex + 1, 0, source.id)
            void reorderFolders(ids)
         }
      }
   }, [documents, handleMove, handleReorder, moveFolder, reorderFolders, subfolders, manualSortActive, currentFolder, currentFolderId, nestFolder, resetSpring, clearDocumentSelection])

   const handleDragCancel = useCallback(() => {
      setActiveDrag(null)
      setIsOverNav(false)
      setOverBack(false)
      setOverCancel(false)
      setIsOverFolder(false)
      setFolderTarget(null)
      overBackRef.current     = false
      overCancelRef.current   = false
      folderTargetRef.current = null
      resetSpring()
   }, [resetSpring])

   return {
      // DndContext bindings
      sensors,
      onDragStart:  handleDragStart,
      onDragEnd:    handleDragEnd,
      onDragCancel: handleDragCancel,
      // FolderOverWatcher (rendered by the root inside DndContext)
      setIsOverFolder,
      // drop-target refs the root passes to BinderNav
      navRef, backRef, cancelRef,
      // drag flags
      activeDrag, isDocDragging, isFolderDragging, isOverNav, overBack, overCancel, folderTarget,
      // overlay (puck + clones), rendered by the root from these
      overlayCardRef, clusterRef, puckVisible, puckIntent, springActive, springRunId,
      // native file-drop import
      isFileDragOver, handleFileDragOver, handleFileDragLeave, handleFileDrop,
   }
}
