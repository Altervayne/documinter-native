// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { mkSection } from '../lib/state'

// -- Type Imports --
import type { Section } from '../types'
import type { T } from '../lib/i18n'

type ToastAction = { label: string; onClick: () => void }

function moveItem<T>(arr: T[], from: number, to: number): T[] {
   if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
   const next = [...arr]
   ;[next[from], next[to]] = [next[to], next[from]]
   return next
}

export function useSectionMutations(
   setSections: Dispatch<SetStateAction<Section[]>>,
   showToast: (msg: string, action?: ToastAction) => void,
   clearToast: () => void,
   t: T,
) {
   const addSection = useCallback(() => {
      setSections(s => [...s, mkSection()])
   }, [setSections])

   const toggleSec = useCallback((secId: string) => {
      setSections(s => s.map(sec => sec.id === secId ? { ...sec, collapsed: !sec.collapsed } : sec))
   }, [setSections])

   const updateSecTitle = useCallback((secId: string, title: string) => {
      setSections(s => s.map(sec => sec.id === secId ? { ...sec, title } : sec))
   }, [setSections])

   const moveSecUp = useCallback((secId: string) => {
      setSections(s => {
         const i = s.findIndex(sec => sec.id === secId)
         return moveItem(s, i, i - 1)
      })
   }, [setSections])

   const moveSecDown = useCallback((secId: string) => {
      setSections(s => {
         const i = s.findIndex(sec => sec.id === secId)
         return moveItem(s, i, i + 1)
      })
   }, [setSections])

   const reorderSections = useCallback((oldIdx: number, newIdx: number) => {
      setSections(s => arrayMove(s, oldIdx, newIdx))
   }, [setSections])

   const removeSec = useCallback((secId: string) => {
      setSections(s => {
         const idx = s.findIndex(sec => sec.id === secId)
         const section = s[idx]
         if (!section) return s
         showToast(t.sectionDeleted, {
            label: t.undo,
            onClick: () => {
               setSections(cur => {
                  const next = [...cur]
                  next.splice(idx, 0, section)
                  return next
               })
               clearToast()
            },
         })
         return s.filter(sec => sec.id !== secId)
      })
   }, [setSections, showToast, clearToast, t])

   return { addSection, toggleSec, updateSecTitle, moveSecUp, moveSecDown, reorderSections, removeSec }
}
