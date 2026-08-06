// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { cloneBlock, mkSection, moveItem } from '../lib/document'

// -- Context Imports --
import { useToast } from '../contexts/ToastContext'

// -- Type Imports --
import type { Section } from '../types'
import type { T } from '../lib/i18n'

export function useSectionMutations(
   setSections: Dispatch<SetStateAction<Section[]>>,
   t: T,
) {
   const { showToast, dismissToast } = useToast()

   const addSection = useCallback(() => {
      setSections(sections => [...sections, mkSection(t.defaultSectionTitle)])
   }, [setSections, t])

   /** Inserts an already-built section at a given index (the section-menu insert-above/insert-below
    *  actions). Mirrors insertBlockAfter's contract: the caller supplies the full section, this
    *  never calls mkSection itself. */
   const insertSectionAt = useCallback((index: number, section: Section) => {
      setSections(sections => {
         const next = [...sections]
         next.splice(index, 0, section)
         return next
      })
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

   const duplicateSec = useCallback((secId: string) => {
      setSections(sections => {
         const sectionIndex = sections.findIndex(sec => sec.id === secId)
         if (sectionIndex === -1) return sections
         const original = sections[sectionIndex]
         const clone: Section = {
            ...original,
            id:     crypto.randomUUID(),
            title:  `${original.title} (copy)`,
            blocks: original.blocks.map(cloneBlock),
         }
         const next = [...sections]
         next.splice(sectionIndex + 1, 0, clone)
         return next
      })
   }, [setSections])

   const removeSec = useCallback((secId: string) => {
      let deletedSection: Section | undefined
      let deletedIndex = -1
      setSections(sections => {
         deletedIndex   = sections.findIndex(sec => sec.id === secId)
         deletedSection = sections[deletedIndex]
         if (!deletedSection) return sections
         return sections.filter(sec => sec.id !== secId)
      })
      if (!deletedSection) return
      const sectionSnapshot = deletedSection
      const indexSnapshot   = deletedIndex
      const toastId = showToast(t.sectionDeleted, {
         action: {
            label:   t.undo,
            onClick: () => {
               setSections(current => {
                  const next = [...current]
                  next.splice(indexSnapshot, 0, sectionSnapshot)
                  return next
               })
               dismissToast(toastId)
            },
         },
      })
   }, [setSections, showToast, dismissToast, t])

   return { addSection, insertSectionAt, toggleSec, updateSecTitle, moveSecUp, moveSecDown, reorderSections, duplicateSec, removeSec }
}
