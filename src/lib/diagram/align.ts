/**
 * align.ts, the PURE multi-select geometry for the diagram editor: equal-spacing snap detection,
 * marquee hit-test, align / distribute, and the group-translate primitive.
 *
 * PURE DATA / PURE FUNCTIONS, side-effect free, DOM-free, exactly like `lib/diagram/edit.ts` (which
 * this module sits alongside and reuses). Every coordinate is in ABSTRACT DIAGRAM UNITS, never screen
 * pixels, so a caller converts a constant screen-pixel snap threshold through the current zoom before
 * calling `computeSpacingSnaps`, the same way it feeds `computeAlignmentSnaps`. These helpers ONLY move
 * nodes (x / y), so a spec round-trips through the fence byte-identically, no new serialized fields.
 *
 * The editor component (`blocks/DiagramBlock.tsx` + the `molecules/Diagram*` panels) is thin glue over
 * these functions, so the interaction math lives here under unit test rather than in the UI, and the
 * marquee / align toolbar / distribute buttons / group drag all read from one tested source of truth.
 */

import type { DiagramNode } from './types'
import type { NodeBox } from './edit'
import { nodeBox, roundUnit, translateNode } from './edit'

// The alignment + move primitives read best next to the box helper they lean on, so re-export it here
// and let a caller pull `nodeBox` / `NodeBox` from either module.
export { nodeBox } from './edit'
export type { NodeBox } from './edit'

// #########
// # TYPES #
// #########

/**
 * A distance indicator for the spacing-snap chrome: the equal gap value plus the two segments to mark
 * with a tick. `orientation: 'horizontal'` means the gaps are measured along x (a row of peers);
 * `'vertical'` means along y (a column). All positions are in diagram units; `cross` is the
 * perpendicular coordinate the tick sits at. `segments` always holds exactly the two equal gaps: the
 * dragged box's gap to its nearest peer, and the existing peer-to-peer gap it matched.
 */
export interface SpacingBadge {
   orientation: 'horizontal' | 'vertical'
   gap:         number
   segments:    { start: number; end: number; cross: number }[]
}

/** Which line of the selection bounding box an align snaps every selected node to. */
export type AlignAxis = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'

/** The axis a distribute equalizes edge-to-edge gaps along. */
export type DistributeAxis = 'horizontal' | 'vertical'

/** An axis-aligned rectangle in diagram units (a marquee drag, possibly with a negative size). */
export interface Rect {
   x:      number
   y:      number
   width:  number
   height: number
}

// #############
// # CONSTANTS #
// #############

/** Slack (diagram units) for the "does not overlap the opposite flank" spacing validity checks. */
const SPACING_OVERLAP_EPSILON = 1e-6

// ####################
// # SPACING SNAP     #
// ####################

/**
 * A per-orientation view of a box's main axis (start / end / size) and its perpendicular (cross) axis,
 * so the horizontal-row and vertical-column spacing math share one code path. For a horizontal row the
 * main axis is x and the cross axis is y; for a vertical column they swap.
 */
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

/** An adjacent peer-to-peer gap along the main axis: its value + the span + tick coords to mark it. */
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

/**
 * Whether `other` is co-aligned with `dragged` on the perpendicular axis, i.e. their cross-axis spans
 * strictly overlap. Only co-aligned boxes count as peers for spacing, so a gap is always measured along
 * a real line of neighbors (a horizontal row = boxes whose vertical spans overlap the dragged box's).
 */
function isCoAligned(axis: AxisView, dragged: NodeBox, other: NodeBox): boolean {
   const overlap = Math.min(axis.crossEnd(dragged), axis.crossEnd(other))
      - Math.max(axis.crossStart(dragged), axis.crossStart(other))
   return overlap > 0
}

/**
 * The single best equal-spacing snap for the dragged box along one orientation, or a null snap. Filters
 * `others` to the co-aligned peers, measures the existing adjacent edge-to-edge gaps between them, then
 * probes both flanking peers (the nearest peer below and above the dragged box on the main axis): if
 * nudging the dragged box by at most `threshold` makes ITS gap to a flank equal an existing peer gap,
 * without overlapping the opposite flank, that is a candidate. The smallest nudge within threshold wins
 * (first found breaks a tie, so the result is deterministic). Emits one badge marking the matched pair.
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
 * Illustrator-style equal-spacing detection for a dragged box against its neighbors. Independently on
 * each axis, considers the OTHER boxes co-aligned with the dragged box on the perpendicular axis (a
 * horizontal row = boxes whose vertical spans overlap, a vertical column = horizontal spans overlap),
 * measures the existing adjacent edge-to-edge gaps between those peers, and snaps the dragged box so its
 * gap to the nearest peer equals one of those gaps (within `threshold`, same diagram units as
 * {@link computeAlignmentSnaps}). Returns `snapX` for a matched horizontal row, `snapY` for a matched
 * vertical column (either, both, or neither), plus one {@link SpacingBadge} per matched axis marking the
 * equal-gap pair. Nothing matching returns no snap + empty badges. PURE + deterministic, never throws;
 * the caller applies the returned snap as a normal node move, so serialization stays byte-identical.
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

/** Normalize a marquee `rect` (dragged in any direction) to non-negative width/height edges. */
function normalizeRect(rect: Rect): { left: number; top: number; right: number; bottom: number } {
   const left   = Math.min(rect.x, rect.x + rect.width)
   const right  = Math.max(rect.x, rect.x + rect.width)
   const top    = Math.min(rect.y, rect.y + rect.height)
   const bottom = Math.max(rect.y, rect.y + rect.height)
   return { left, top, right, bottom }
}

/**
 * The ids of every node whose bounding box INTERSECTS `rect`, in input order. A marquee grabs any
 * partially-touched node, not only fully-enclosed ones (matching most editors), so this is a box
 * overlap test, not a containment test. `rect` may have been dragged up-left (negative width/height),
 * so it is normalized first. Deterministic + pure.
 */
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

/** The bounding box (as edges) enclosing every box in `boxes`; caller guarantees a non-empty list. */
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

/**
 * Move every selected node so its chosen edge / center lines up with the SELECTION BOUNDING BOX's
 * corresponding line: `left` -> box min x, `right` -> box max x, `hcenter` -> box mid x, and the
 * top / bottom / vmiddle analogs on y. Returns a NEW nodes array with the non-selected nodes untouched;
 * needs 2+ selected to do anything (0 or 1 selected returns the input unchanged). Moved coordinates
 * round with {@link roundUnit}. PURE.
 */
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

/**
 * Equalize the edge-to-edge gaps of the selected nodes along `axis`, keeping the two extreme nodes fixed
 * and spreading the middle ones evenly between them. Returns a NEW nodes array with the non-selected
 * nodes untouched; needs 3+ selected to do anything (fewer returns the input unchanged). The nodes are
 * sorted along the axis, the total free space (the extremes' outer span minus the sum of every selected
 * node's size) is divided into equal gaps, and each middle node is placed one gap past the running edge.
 * Moved coordinates round with {@link roundUnit}. PURE.
 */
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

   // Walk the middle nodes left-to-right, each parked one equal gap past the previous node's far edge.
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

/**
 * Move every selected node by (deltaX, deltaY) diagram units, returning a NEW nodes array with the
 * non-selected nodes untouched. Uses the same rounding discipline as {@link translateNode}, so it backs
 * both the group move-drag and the arrow-key nudge. PURE.
 */
export function translateNodes(
   nodes: DiagramNode[], selectedIds: ReadonlySet<string>, deltaX: number, deltaY: number,
): DiagramNode[] {
   return nodes.map(node => (selectedIds.has(node.id) ? translateNode(node, deltaX, deltaY) : node))
}
