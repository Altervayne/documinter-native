/*
 * PURE multi-select geometry for the diagram editor: equal-spacing snap detection, marquee hit-test,
 * align / distribute, and the group-translate primitive. Coordinates are ABSTRACT DIAGRAM UNITS, so a
 * caller converts a screen-pixel snap threshold through the current zoom before calling
 * `computeSpacingSnaps`. These helpers ONLY move nodes (x/y), so a spec round-trips byte-identically.
 */

import type { DiagramNode } from './types'
import type { NodeBox } from './edit'
import { nodeBox, roundUnit, translateNode } from './edit'

// Re-export the box helper these primitives lean on, so a caller can pull it from either module.
export { nodeBox } from './edit'
export type { NodeBox } from './edit'

// #########
// # TYPES #
// #########

/**
 * A distance indicator for the spacing-snap chrome: the equal gap value plus the two segments to tick.
 * `orientation: 'horizontal'` measures gaps along x; `cross` is the perpendicular tick coordinate.
 * `segments` holds exactly the two equal gaps: the dragged box's gap to its nearest peer, and the
 * existing peer-to-peer gap it matched.
 */
export interface SpacingBadge {
   orientation: 'horizontal' | 'vertical'
   gap:         number
   segments:    { start: number; end: number; cross: number }[]
}

/** Which line of the selection bounding box an align snaps every selected node to. */
export type AlignAxis = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'

export type DistributeAxis = 'horizontal' | 'vertical'

/** A marquee drag, possibly with a negative size. */
export interface Rect {
   x:      number
   y:      number
   width:  number
   height: number
}

// #############
// # CONSTANTS #
// #############

/** Slack for the "does not overlap the opposite flank" spacing validity checks. */
const SPACING_OVERLAP_EPSILON = 1e-6

// ####################
// # SPACING SNAP     #
// ####################

/** A per-orientation view of a box's main axis (start/end/size) and cross axis, so the horizontal-row
 *  and vertical-column spacing math share one code path (for a horizontal row main is x, cross is y). */
interface AxisView {
   start:       (box: NodeBox) => number
   end:         (box: NodeBox) => number
   size:        (box: NodeBox) => number
   crossStart:  (box: NodeBox) => number
   crossEnd:    (box: NodeBox) => number
   crossCenter: (box: NodeBox) => number
}

const HORIZONTAL_AXIS: AxisView = {
   start:       box => box.x,
   end:         box => box.x + box.width,
   size:        box => box.width,
   crossStart:  box => box.y,
   crossEnd:    box => box.y + box.height,
   crossCenter: box => box.y + box.height / 2,
}

const VERTICAL_AXIS: AxisView = {
   start:       box => box.y,
   end:         box => box.y + box.height,
   size:        box => box.height,
   crossStart:  box => box.x,
   crossEnd:    box => box.x + box.width,
   crossCenter: box => box.x + box.width / 2,
}

/** An adjacent peer-to-peer gap along the main axis: value + span + tick coords. */
interface ExistingGap {
   value:  number
   start:  number
   end:    number
   cross:  number
}

/** The center of a box along the main axis, for deciding which peers flank the dragged box. */
function mainCenter(axis: AxisView, box: NodeBox): number {
   return axis.start(box) + axis.size(box) / 2
}

/** The tick coordinate for a segment between two boxes: the midpoint of their cross-axis centers. */
function segmentCross(axis: AxisView, first: NodeBox, second: NodeBox): number {
   return (axis.crossCenter(first) + axis.crossCenter(second)) / 2
}

/** Whether `other`'s cross-axis span overlaps `dragged`'s. Only co-aligned boxes count as peers, so a
 *  gap is measured along a real line of neighbors. */
function isCoAligned(axis: AxisView, dragged: NodeBox, other: NodeBox): boolean {
   const overlap = Math.min(axis.crossEnd(dragged), axis.crossEnd(other))
      - Math.max(axis.crossStart(dragged), axis.crossStart(other))
   return overlap > 0
}

/**
 * The single best equal-spacing snap for the dragged box along one orientation, or a null snap. Keeps
 * the co-aligned peers, measures the existing adjacent gaps between them, then probes both flanking
 * peers: if nudging the dragged box by at most `threshold` makes its gap to a flank equal an existing
 * gap without overlapping the opposite flank, that is a candidate. The smallest nudge wins (first found
 * breaks a tie). Emits one badge marking the matched pair.
 */
function spacingForAxis(
   axis: AxisView, dragged: NodeBox, others: NodeBox[], threshold: number,
): { snap: number | null; badge: SpacingBadge | null; orientation: 'horizontal' | 'vertical' } {
   const orientation: 'horizontal' | 'vertical' = axis === HORIZONTAL_AXIS ? 'horizontal' : 'vertical'
   const none = { snap: null, badge: null, orientation }

   // ==== Keep only the co-aligned peers, sorted along the main axis. ====
   const peers = others.filter(other => isCoAligned(axis, dragged, other))
      .sort((first, second) => axis.start(first) - axis.start(second))
   // An existing gap needs two peers; with fewer there is no rhythm to match.
   if (peers.length < 2) return none

   // ==== The existing adjacent edge-to-edge gaps between neighboring peers. ====
   const existingGaps: ExistingGap[] = []
   for (let index = 0; index < peers.length - 1; index += 1) {
      const before = peers[index]
      const after  = peers[index + 1]
      existingGaps.push({
         value: axis.start(after) - axis.end(before),
         start: axis.end(before),
         end:   axis.start(after),
         cross: segmentCross(axis, before, after),
      })
   }

   // ==== The peers immediately flanking the dragged box's current position. ====
   const draggedCenter = mainCenter(axis, dragged)
   let leftPeer:  NodeBox | null = null
   let rightPeer: NodeBox | null = null
   for (const peer of peers) {
      const center = mainCenter(axis, peer)
      if (center < draggedCenter) {
         if (leftPeer === null || center > mainCenter(axis, leftPeer)) leftPeer = peer
      } else {
         if (rightPeer === null || center < mainCenter(axis, rightPeer)) rightPeer = peer
      }
   }

   const draggedSize = axis.size(dragged)

   let bestSnap:     number | null = null
   let bestDistance = Infinity
   let bestBadge:    SpacingBadge | null = null

   // ==== Probe the dragged box parked just after the left flank, matching each existing gap. ====
   if (leftPeer !== null) {
      for (const gap of existingGaps) {
         const targetStart = axis.end(leftPeer) + gap.value
         // Reject a placement that would overlap the right flank (never snap into a peer).
         if (rightPeer !== null && targetStart + draggedSize > axis.start(rightPeer) + SPACING_OVERLAP_EPSILON) continue
         const distance = Math.abs(targetStart - axis.start(dragged))
         if (distance <= threshold && distance < bestDistance) {
            bestDistance = distance
            bestSnap = targetStart
            bestBadge = {
               orientation,
               gap: gap.value,
               segments: [
                  { start: axis.end(leftPeer), end: targetStart, cross: segmentCross(axis, dragged, leftPeer) },
                  { start: gap.start, end: gap.end, cross: gap.cross },
               ],
            }
         }
      }
   }

   // ==== Probe the dragged box parked just before the right flank, matching each existing gap. ====
   if (rightPeer !== null) {
      for (const gap of existingGaps) {
         const targetEnd   = axis.start(rightPeer) - gap.value
         const targetStart = targetEnd - draggedSize
         // Reject a placement that would overlap the left flank.
         if (leftPeer !== null && targetStart < axis.end(leftPeer) - SPACING_OVERLAP_EPSILON) continue
         const distance = Math.abs(targetStart - axis.start(dragged))
         if (distance <= threshold && distance < bestDistance) {
            bestDistance = distance
            bestSnap = targetStart
            bestBadge = {
               orientation,
               gap: gap.value,
               segments: [
                  { start: targetEnd, end: axis.start(rightPeer), cross: segmentCross(axis, dragged, rightPeer) },
                  { start: gap.start, end: gap.end, cross: gap.cross },
               ],
            }
         }
      }
   }

   if (bestSnap === null) return none
   return { snap: roundUnit(bestSnap), badge: bestBadge, orientation }
}

/**
 * Equal-spacing detection for a dragged box against its neighbors, independently on each axis. Snaps
 * the dragged box so its gap to the nearest peer equals an existing peer-to-peer gap (within
 * `threshold`). Returns `snapX` for a matched row, `snapY` for a matched column (either, both, or
 * neither), plus one {@link SpacingBadge} per matched axis. The caller applies the snap as a normal move.
 */
export function computeSpacingSnaps(
   draggedBox: NodeBox, others: NodeBox[], threshold: number,
): { snapX?: number; snapY?: number; spacingBadges: SpacingBadge[] } {
   const horizontal = spacingForAxis(HORIZONTAL_AXIS, draggedBox, others, threshold)
   const vertical   = spacingForAxis(VERTICAL_AXIS, draggedBox, others, threshold)

   const spacingBadges: SpacingBadge[] = []
   if (horizontal.badge) spacingBadges.push(horizontal.badge)
   if (vertical.badge) spacingBadges.push(vertical.badge)

   return {
      snapX: horizontal.snap ?? undefined,
      snapY: vertical.snap ?? undefined,
      spacingBadges,
   }
}

// ####################
// # MARQUEE HIT-TEST #
// ####################

/** Normalize a marquee `rect` (dragged any direction) to non-negative edges. */
function normalizeRect(rect: Rect): { left: number; top: number; right: number; bottom: number } {
   const left   = Math.min(rect.x, rect.x + rect.width)
   const right  = Math.max(rect.x, rect.x + rect.width)
   const top    = Math.min(rect.y, rect.y + rect.height)
   const bottom = Math.max(rect.y, rect.y + rect.height)
   return { left, top, right, bottom }
}

/** The ids of every node whose box INTERSECTS `rect`, in input order. A marquee grabs any
 *  partially-touched node (an overlap test, not containment), matching most editors. */
export function nodesInRect(nodes: DiagramNode[], rect: Rect): string[] {
   const bounds = normalizeRect(rect)
   const hit: string[] = []
   for (const node of nodes) {
      const box = nodeBox(node)
      const overlaps = box.x <= bounds.right && box.x + box.width >= bounds.left
         && box.y <= bounds.bottom && box.y + box.height >= bounds.top
      if (overlaps) hit.push(node.id)
   }
   return hit
}

// ####################
// # ALIGN            #
// ####################

/** The bounding box enclosing every box in `boxes`; caller guarantees a non-empty list. */
function groupBounds(boxes: NodeBox[]): { minX: number; minY: number; maxX: number; maxY: number } {
   let minX = Infinity
   let minY = Infinity
   let maxX = -Infinity
   let maxY = -Infinity
   for (const box of boxes) {
      if (box.x < minX) minX = box.x
      if (box.y < minY) minY = box.y
      if (box.x + box.width  > maxX) maxX = box.x + box.width
      if (box.y + box.height > maxY) maxY = box.y + box.height
   }
   return { minX, minY, maxX, maxY }
}

/** Move every selected node so its chosen edge/center lines up with the selection bounding box's
 *  corresponding line. Needs 2+ selected; fewer returns the input unchanged. */
export function alignNodes(
   nodes: DiagramNode[], selectedIds: ReadonlySet<string>, alignment: AlignAxis,
): DiagramNode[] {
   const selectedBoxes = nodes.filter(node => selectedIds.has(node.id)).map(nodeBox)
   if (selectedBoxes.length < 2) return nodes

   const bounds = groupBounds(selectedBoxes)

   return nodes.map(node => {
      if (!selectedIds.has(node.id)) return node
      const box = nodeBox(node)
      switch (alignment) {
         case 'left':    return { ...node, x: roundUnit(bounds.minX) }
         case 'right':   return { ...node, x: roundUnit(bounds.maxX - box.width) }
         case 'hcenter': return { ...node, x: roundUnit((bounds.minX + bounds.maxX) / 2 - box.width / 2) }
         case 'top':     return { ...node, y: roundUnit(bounds.minY) }
         case 'bottom':  return { ...node, y: roundUnit(bounds.maxY - box.height) }
         case 'vmiddle': return { ...node, y: roundUnit((bounds.minY + bounds.maxY) / 2 - box.height / 2) }
      }
   })
}

// ####################
// # DISTRIBUTE       #
// ####################

/** Equalize the edge-to-edge gaps of the selected nodes along `axis`, keeping the two extremes fixed
 *  and spreading the middle ones evenly between them. Needs 3+ selected; fewer returns the input. */
export function distributeNodes(
   nodes: DiagramNode[], selectedIds: ReadonlySet<string>, axis: DistributeAxis,
): DiagramNode[] {
   const view = axis === 'horizontal' ? HORIZONTAL_AXIS : VERTICAL_AXIS
   const selected = nodes.filter(node => selectedIds.has(node.id))
      .map(node => ({ id: node.id, box: nodeBox(node) }))
      .sort((first, second) => view.start(first.box) - view.start(second.box))
   if (selected.length < 3) return nodes

   const first = selected[0]
   const last  = selected[selected.length - 1]

   let totalSize = 0
   for (const entry of selected) totalSize += view.size(entry.box)

   const span = view.end(last.box) - view.start(first.box)
   const equalGap = (span - totalSize) / (selected.length - 1)

   // Accumulate the running edge from the UNROUNDED start so a long row does not drift, but store the
   // rounded start for the model write.
   const nextStartById = new Map<string, number>()
   let runningEdge = view.end(first.box)
   for (let index = 1; index < selected.length - 1; index += 1) {
      const entry = selected[index]
      const nextStart = runningEdge + equalGap
      nextStartById.set(entry.id, roundUnit(nextStart))
      runningEdge = nextStart + view.size(entry.box)
   }

   return nodes.map(node => {
      const nextStart = nextStartById.get(node.id)
      if (nextStart === undefined) return node
      return axis === 'horizontal' ? { ...node, x: nextStart } : { ...node, y: nextStart }
   })
}

// ####################
// # GROUP TRANSLATE  #
// ####################

/** Move every selected node by (deltaX, deltaY). Backs both the group move-drag and the arrow-key nudge. */
export function translateNodes(
   nodes: DiagramNode[], selectedIds: ReadonlySet<string>, deltaX: number, deltaY: number,
): DiagramNode[] {
   return nodes.map(node => (selectedIds.has(node.id) ? translateNode(node, deltaX, deltaY) : node))
}
