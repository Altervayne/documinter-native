import type { PaneId, PaneLeaf, PaneNode } from '../types'

// #####################
// # READ-ONLY QUERIES #
// #####################

/** Every PaneId present as a leaf in the tree. */
export function visiblePanels(tree: PaneNode): Set<PaneId> {
   if (tree.kind === 'leaf') return new Set([tree.paneId])
   const result = new Set<PaneId>()
   for (const id of visiblePanels(tree.children[0])) result.add(id)
   for (const id of visiblePanels(tree.children[1])) result.add(id)
   return result
}

export function isPanelVisible(tree: PaneNode, paneId: PaneId): boolean {
   if (tree.kind === 'leaf') return tree.paneId === paneId
   return isPanelVisible(tree.children[0], paneId) || isPanelVisible(tree.children[1], paneId)
}

export function countVisiblePanels(tree: PaneNode): number {
   if (tree.kind === 'leaf') return 1
   return countVisiblePanels(tree.children[0]) + countVisiblePanels(tree.children[1])
}

/** True when the tree's PaneIds exactly equal `expected`. */
export function hasExactPanels(tree: PaneNode, expected: Set<PaneId>): boolean {
   const actual = visiblePanels(tree)
   if (actual.size !== expected.size) return false
   for (const id of expected) {
      if (!actual.has(id)) return false
   }
   return true
}

// ############################
// # IMMUTABLE TREE MUTATIONS #
// ############################

/** Remove the leaf with paneId; a split that loses a child collapses to its remaining child. Returns
 *  null only when the tree IS that leaf (single-leaf), so callers guard with countVisiblePanels > 1. */
export function removePanel(tree: PaneNode, paneId: PaneId): PaneNode | null {
   if (tree.kind === 'leaf') {
      return tree.paneId === paneId ? null : tree
   }

   const newLeft  = removePanel(tree.children[0], paneId)
   const newRight = removePanel(tree.children[1], paneId)

   if (newLeft  === null) return newRight
   if (newRight === null) return newLeft

   return { ...tree, children: [newLeft, newRight] }
}

/** Insert a new leaf as the right child of a fresh horizontal split at the root. The fallback when no
 *  stored position is available. */
export function insertPanelRight(tree: PaneNode, paneId: PaneId): PaneNode {
   const newLeaf: PaneLeaf = { kind: 'leaf', paneId }
   return { kind: 'split', orientation: 'h', ratio: 0.5, children: [tree, newLeaf] }
}

/** Move the leaf `draggedId` next to `targetId`: remove it, then reinsert on the `zone` side of the
 *  target in the resulting tree. */
export function relocatePanel(
   tree:      PaneNode,
   draggedId: PaneId,
   targetId:  PaneId,
   zone:      'left' | 'right' | 'top' | 'bottom',
): PaneNode {
   const withoutDragged = removePanel(tree, draggedId)
   if (withoutDragged === null) return tree   // single-leaf tree, nothing to relocate

   const draggedLeaf: PaneLeaf = { kind: 'leaf', paneId: draggedId }
   return insertAtTarget(withoutDragged, draggedLeaf, targetId, zone)
}

/** Update the ratio of the split reached by following `path` (0|1 child indices) from the root; an empty
 *  path targets the root split. A malformed path (one landing on a leaf) is a no-op. */
export function setSplitRatio(tree: PaneNode, path: number[], ratio: number): PaneNode {
   if (tree.kind === 'leaf') return tree   // path lands on a leaf, no-op

   if (path.length === 0) {
      return { ...tree, ratio }
   }

   const [head, ...tail] = path
   if (head !== 0 && head !== 1) return tree   // malformed path index, no-op

   const childIndex = head as 0 | 1
   const newChild   = setSplitRatio(tree.children[childIndex], tail, ratio)
   const newChildren: [PaneNode, PaneNode] = childIndex === 0
      ? [newChild, tree.children[1]]
      : [tree.children[0], newChild]

   return { ...tree, children: newChildren }
}

// ####################
// # INTERNAL HELPERS #
// ####################

/** Find the leaf `targetId` and wrap it in a new split holding `newLeaf` on the `zone` side. */
function insertAtTarget(
   tree:     PaneNode,
   newLeaf:  PaneLeaf,
   targetId: PaneId,
   zone:     'left' | 'right' | 'top' | 'bottom',
): PaneNode {
   if (tree.kind === 'leaf') {
      if (tree.paneId !== targetId) return tree

      const orientation: 'h' | 'v' = (zone === 'left' || zone === 'right') ? 'h' : 'v'
      const firstChild  = (zone === 'left' || zone === 'top')    ? newLeaf : tree
      const secondChild = (zone === 'right' || zone === 'bottom') ? newLeaf : tree

      return { kind: 'split', orientation, ratio: 0.5, children: [firstChild, secondChild] }
   }

   return {
      ...tree,
      children: [
         insertAtTarget(tree.children[0], newLeaf, targetId, zone),
         insertAtTarget(tree.children[1], newLeaf, targetId, zone),
      ],
   }
}
