// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { mkSection, moveItem } from '../lib/document'

// -- Type Imports --
import type { Section } from '../types'
import type { T } from '../lib/i18n'

type ToastAction = { label: string; onClick: () => void }

export function useSectionMutations(
   setSections: Dispatch<SetStateAction<Section[]>>,
   showToast: (msg: string, action?: ToastAction) => void,
   clearToast: () => void,
   t: T,
) {
   const addSection = useCallback(() => {
      setSections(sections => [...sections, mkSection()])
   }, [setSections])

   const toggleSec = useCallback((secId: string) => {
      setSections(sections => sections.map(sec => sec.id === secId ? { ...sec, collapsed: !sec.collapsed } : sec))
   }, [setSections])

   const updateSecTitle = useCallback((secId: string, title: string) => {
      setSections(sections => sections.map(sec => sec.id === secId ? { ...sec, title } : sec))
   }, [setSections])

   const moveSecUp = useCallback((secId: string) => {
      setSections(sections => {
         const index = sections.findIndex(sec => sec.id === secId)
         return moveItem(sections, index, index - 1)
      })
   }, [setSections])

   const moveSecDown = useCallback((secId: string) => {
      setSections(sections => {
         const index = sections.findIndex(sec => sec.id === secId)
         return moveItem(sections, index, index + 1)
      })
   }, [setSections])

   const reorderSections = useCallback((oldIdx: number, newIdx: number) => {
      setSections(sections => arrayMove(sections, oldIdx, newIdx))
   }, [setSections])

   const removeSec = useCallback((secId: string) => {
      setSections(sections => {
         const sectionIndex = sections.findIndex(sec => sec.id === secId)
         const section = sections[sectionIndex]
         if (!section) return sections
         showToast(t.sectionDeleted, {
            label: t.undo,
            onClick: () => {
               setSections(current => {
                  const next = [...current]
                  next.splice(sectionIndex, 0, section)
                  return next
               })
               clearToast()
            },
         })
         return sections.filter(sec => sec.id !== secId)
      })
   }, [setSections, showToast, clearToast, t])

   return { addSection, toggleSec, updateSecTitle, moveSecUp, moveSecDown, reorderSections, removeSec }
}
