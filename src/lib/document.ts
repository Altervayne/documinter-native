/*
 * Document primitive factories, block display utilities, and shared mutation helpers. moveItem and
 * mutateSec live here so the block / section / container mutation hooks all work from one copy
 * instead of each duplicating the logic.
 */

import type { Dispatch, SetStateAction } from 'react'
import type { Block, BlockType, DocMeta, ListItem, Section, Side } from '../types'
import type { T } from './i18n'


// #############
// # FACTORIES #
// #############

/** Create a new section with a fresh UUID and empty block list. */
export function mkSection(title: string): Section {
   return { id: crypto.randomUUID(), title, collapsed: false, blocks: [] }
}

/** Deep-copy a ListItem tree, assigning fresh UUIDs at every level. */
function cloneListItem(item: ListItem): ListItem {
   return { ...item, id: crypto.randomUUID(), children: item.children.map(cloneListItem) }
}

/** Deep-copy a block, assigning fresh UUIDs to it and any nested blocks or list items. */
export function cloneBlock(block: Block): Block {
   const base = { ...block, id: crypto.randomUUID() }
   if (block.type === 'container') {
      return {
         ...base,
         left:  (block.left  ?? []).map(cloneBlock),
         right: (block.right ?? []).map(cloneBlock),
      }
   }
   if ((block.type === 'list' || block.type === 'checklist') && block.items) {
      return { ...base, items: block.items.map(cloneListItem) }
   }
   return base
}

/** Create a new block of the given type with localised default content. */
export function mkBlock(type: BlockType, t: T): Block {
   const id = crypto.randomUUID()
   switch (type) {
      case 'p':       return { id, type, richText: [{ text: t.blockDefaultP }] }
      case 'h3':      return { id, type, richText: [{ text: t.blockDefaultH3 }] }
      case 'h4':      return { id, type, richText: [{ text: t.blockDefaultH4 }] }
      case 'callout': return { id, type, style: 'info', richText: [{ text: t.blockDefaultCallout }] }
      case 'code':      return { id, type, code: t.blockDefaultCode, lang: 'windev' }
      case 'math':      return { id, type, latex: '' }
      case 'graph':     return {
         id, type,
         graph: {
            type: 'bar',
            data: {
               labels: ['A', 'B', 'C'],
               series: [{ name: 'Series 1', values: [4, 7, 5] }],
            },
            options: { legend: true },
         },
      }
      case 'diagram':   return {
         id, type,
         diagram: {
            nodes: [
               { id: 'n1', x: 40,  y: 40, width: 120, height: 56, shape: 'rounded', label: 'Start' },
               { id: 'n2', x: 40,  y: 180, width: 120, height: 56, shape: 'rounded', label: 'End' },
            ],
            edges: [
               { id: 'e1', from: 'n1', to: 'n2' },
            ],
            options: {},
         },
      }
      case 'list':      return {
         id, type,
         items: [
            { id: crypto.randomUUID(), richText: [{ text: t.blockDefaultListItem1 }], children: [] },
            { id: crypto.randomUUID(), richText: [{ text: t.blockDefaultListItem2 }], children: [] },
         ],
      }
      case 'checklist': return {
         id, type,
         items: [
            { id: crypto.randomUUID(), richText: [{ text: t.blockDefaultListItem1 }], children: [], checked: false },
            { id: crypto.randomUUID(), richText: [{ text: t.blockDefaultListItem2 }], children: [], checked: false },
         ],
      }
      case 'table': return {
         id, type,
         richHeaders: [[{ text: 'Column 1' }], [{ text: 'Column 2' }]],
         richRows:    [[ [], [] ], [ [], [] ]],
      }
      case 'image':     return { id, type, src: '', alt: '', caption: '' }
      case 'container': return { id, type, ratio: 0.5, left: [], right: [] }
      case 'hr':        return { id, type }
   }
}

// ###########################
// # BLOCK DISPLAY UTILITIES #
// ###########################

/** The block's anchor id: its user-defined handle slug. */
export function blockAnchor(block: { handle?: string }): string {
   return block.handle ?? ''
}

/** Extract plain text from a block's primary content field. */
function blockPlainText(block: Block): string {
   if (!block.richText || block.richText.length === 0) return ''
   return block.richText.map(run => run.text).join('').replace(/\n/g, ' ')
}

/** Extract plain text from a list item (inline formatting stripped, newlines flattened to spaces). */
export function listItemPlainText(item: { richText?: { text: string }[] }): string {
   if (!item.richText || item.richText.length === 0) return ''
   return item.richText.map(run => run.text).join('').replace(/\n/g, ' ')
}

/** An anchor handle slug from the block's first line of text / code / list item, or a UUID fragment
 *  when empty. */
export function generateHandle(block: Block): string {
   const rawText = block.richText
      ? blockPlainText(block)
      : block.code
         ? block.code.split('\n')[0]
         : block.latex
            ? block.latex.split('\n')[0]
            : block.items?.[0]
               ? listItemPlainText(block.items[0])
               : ''
   const slug = rawText.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 28)
   return slug || crypto.randomUUID().substring(0, 8)
}

/** Like generateHandle but guaranteed free of `existingHandles`, appending `-2`, `-3`, ... on a
 *  collision. The anchor editor only warns on a clash; an auto-assignment behind the scenes (the
 *  graph <-> table live link) must never silently collide. */
export function generateUniqueHandle(block: Block, existingHandles: string[]): string {
   const base = generateHandle(block)
   if (!existingHandles.includes(base)) return base
   let suffix = 2
   let candidate = `${base}-${suffix}`
   while (existingHandles.includes(candidate)) {
      suffix += 1
      candidate = `${base}-${suffix}`
   }
   return candidate
}

/** Short plain-text preview of a block's content, used in the panel. */
export function blkPreview(block: Block): string {
   if (block.type === 'p' || block.type === 'h3' || block.type === 'h4')
      return blockPlainText(block).substring(0, 32)
   if (block.type === 'callout')
      return `[${block.style}] ${blockPlainText(block).substring(0, 20)}`
   if (block.type === 'code')
      return (block.code ?? '').substring(0, 32)
   if (block.type === 'math')
      return (block.latex ?? '').substring(0, 32)
   if (block.type === 'graph') {
      const graph = block.graph
      const title = graph?.options?.title?.trim()
      if (title) return title.substring(0, 32)
      const chartType   = graph?.type ?? 'bar'
      const seriesCount = graph?.data?.series?.length ?? 0
      return `Graph, ${chartType} (${seriesCount} series)`
   }
   if (block.type === 'diagram') {
      const diagram = block.diagram
      const title = diagram?.options?.title?.trim()
      if (title) return title.substring(0, 32)
      const nodeCount = diagram?.nodes?.length ?? 0
      const edgeCount = diagram?.edges?.length ?? 0
      return `Diagram (${nodeCount} nodes, ${edgeCount} links)`
   }
   if (block.type === 'list' || block.type === 'checklist')
      return (block.items?.[0] ? listItemPlainText(block.items[0]) : '').substring(0, 32)
   if (block.type === 'table')
      return `${(block.richHeaders ?? []).length} col × ${(block.richRows ?? []).length} rows`
   if (block.type === 'image') {
      if (block.imageMarkup) {
         const elementCount = block.imageMarkup.elements?.length ?? 0
         return `[Image] ${elementCount} annotation${elementCount === 1 ? '' : 's'}`
      }
      return `[Image] ${block.alt || '—'}`
   }
   if (block.type === 'container') {
      const pct = Math.round((block.ratio ?? 0.5) * 100)
      return `Container (${pct}/${100 - pct})`
   }
   if (block.type === 'hr') return '———————————————'
   return ''
}

// #########################################################
// # MUTATION HELPERS, SHARED BY THE THREE MUTATION HOOKS #
// #########################################################

/** Swap two items by index. Returns the array unchanged if either index is out of bounds. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
   if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
   const next = [...arr]
   ;[next[from], next[to]] = [next[to], next[from]]
   return next
}

/** Apply a transform to the single section matching secId, leaving the rest untouched. */
export function mutateSec(
   setSections: Dispatch<SetStateAction<Section[]>>,
   secId: string,
   fn: (sec: Section) => Section,
): void {
   setSections(sections => sections.map(sec => sec.id === secId ? fn(sec) : sec))
}

// ##############################################################################################
// # CROSS-ARRAY BLOCK MOVE (block DnD: cross-section, and into / out of container columns)      #
// ##############################################################################################

/**
 * Whether a document holds nothing worth warning about before discarding: no blocks, no title, no
 * filled-in meta values. True of a fresh blank OR a template-created doc (a template seeds only blank
 * values), false of a document opened from a file. closeTab uses it to decide whether losing an
 * unsaved, not-yet-in-the-binder tab warrants a confirmation.
 */
export function isEmptyDocument(document: { meta: DocMeta; sections: Section[] }): boolean {
   const hasBlocks      = document.sections.some(section => section.blocks.length > 0)
   const hasFieldValues = document.meta.fields.some(field => field.value.trim() !== '')
   return !hasBlocks && !document.meta.title.trim() && !hasFieldValues
}

/** Find a block anywhere on the canvas (section body or container column) with its owning section.
 *  The shared drag ghost uses this to render inner container blocks, which are not in section.blocks. */
export function findBlockOnCanvas(sections: Section[], blockId: string): { section: Section; block: Block } | null {
   for (const section of sections) {
      for (const block of section.blocks) {
         if (block.id === blockId) return { section, block }
         if (block.type === 'container') {
            const inner = [...(block.left ?? []), ...(block.right ?? [])].find(child => child.id === blockId)
            if (inner) return { section, block: inner }
         }
      }
   }
   return null
}

/** Where a block lives: a section's body, or one column of a container block inside a section. */
export type BlockLoc =
   | { kind: 'section'; sectionId: string }
   | { kind: 'column';  sectionId: string; blockId: string; side: Side }

/** Reads one column of a container block; an absent side reads as empty. */
function readColumn(container: Block, side: Side): Block[] {
   return (side === 'left' ? container.left : container.right) ?? []
}

/** Immutably set one column of a container block. */
function withColumn(container: Block, side: Side, blocks: Block[]): Block {
   return side === 'left' ? { ...container, left: blocks } : { ...container, right: blocks }
}

/** Insert `moving` into `arr` immediately before `beforeBlockId` (appended when null / not found). */
function insertBefore(arr: Block[], moving: Block, beforeBlockId: string | null): Block[] {
   const found = beforeBlockId === null ? -1 : arr.findIndex(block => block.id === beforeBlockId)
   const index = found === -1 ? arr.length : found
   return [...arr.slice(0, index), moving, ...arr.slice(index)]
}

/**
 * Move a block out of `from` and into `to`, before `beforeBlockId` (appended when null), in one
 * immutable pass that rebuilds only the affected sections. Handles section bodies, container columns,
 * and moves between them; same-location moves reorder in place. No-op-safe: an unknown block or
 * location returns `sections` unchanged.
 */
export function relocateBlock(
   sections: Section[],
   from: BlockLoc,
   blockId: string,
   to: BlockLoc,
   beforeBlockId: string | null,
): Section[] {
   // Find the moving block object in its source location so the SAME reference is re-inserted.
   const fromSection = sections.find(section => section.id === from.sectionId)
   if (!fromSection) return sections
   const sourceArray = from.kind === 'section'
      ? fromSection.blocks
      : readColumn(fromSection.blocks.find(block => block.id === from.blockId) ?? ({} as Block), from.side)
   const moving = sourceArray.find(block => block.id === blockId)
   if (!moving) return sections

   // `from` and `to` may target the same section (even the same array), so a section applies its
   // removal AND its insertion together, removal first, on the same working `blocks`.
   return sections.map(section => {
      const isFrom = section.id === from.sectionId
      const isTo   = section.id === to.sectionId
      if (!isFrom && !isTo) return section

      let blocks = section.blocks
      if (isFrom) {
         blocks = from.kind === 'section'
            ? blocks.filter(block => block.id !== blockId)
            : blocks.map(block => block.id === from.blockId
               ? withColumn(block, from.side, readColumn(block, from.side).filter(inner => inner.id !== blockId))
               : block)
      }
      if (isTo) {
         blocks = to.kind === 'section'
            ? insertBefore(blocks, moving, beforeBlockId)
            : blocks.map(block => block.id === to.blockId
               ? withColumn(block, to.side, insertBefore(readColumn(block, to.side), moving, beforeBlockId))
               : block)
      }
      return { ...section, blocks }
   })
}
