/**
 * types.ts, the pure data model + theme shape for the home-grown diagram (nodes + links) block.
 *
 * PURE TYPES + a couple of frozen theme constants. Imports NOTHING (no React, no DOM, no layout
 * library). The renderer (index.ts + geometry.ts + shapes.ts + arrow.ts) consumes a DiagramSpec
 * plus a resolved DiagramTheme and produces a self-contained SVG string, exactly the way the graph
 * block turns a GraphSpec into a self-contained SVG and the math block turns `latex` into MathML.
 *
 * The theme is resolved for ONE target theme (light OR dark), so the same renderer serves the
 * in-app preview AND the baked HTML export just by passing a different DiagramTheme.
 *
 * Coordinates live in ABSTRACT DIAGRAM UNITS, not screen pixels: a node at { x: 40, y: 40 } means
 * the same thing regardless of how wide the document column is. The renderer maps the diagram's
 * bounding box (or the explicit `options.canvas`) into the SVG viewBox and styles the <svg>
 * `width:100%;height:auto`, so it scales to the column with no runtime resize (see index.ts).
 */

// #########
// # TYPES #
// #########

/**
 * A shape drawn for a node, from a fixed set; an unknown value falls back to 'rectangle' on parse.
 * `banner` and `chevron` are HEADING shapes: a flat bar and a right-pointing arrow/process banner,
 * for labeling steps/phases in a process chart. They are ordinary node shapes (same place/label/
 * style/move/resize/serialize/color as any other shape), just seeded at a wider, shorter default
 * size when added from the palette (see {@link isHeadingShape} + `DIAGRAM_HEADING_NODE_WIDTH`/
 * `DIAGRAM_HEADING_NODE_HEIGHT`).
 */
export type NodeShape = 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'pill' | 'banner' | 'chevron'

/** Arrowhead placement on an edge. 'end' is the common flowchart arrow (A -> B). */
export type EdgeArrow = 'none' | 'end' | 'start' | 'both'

/** How an edge's path is drawn between its endpoints (straight or elbow; splines deferred). */
export type EdgeRouting = 'straight' | 'orthogonal'

/**
 * A node: a positioned, sized, labeled shape. Coordinates are in ABSTRACT DIAGRAM UNITS
 * (see the file header), not screen pixels. `id` is a stable PER-DIAGRAM identifier referenced
 * by edges, unrelated to the block-level `Block.handle` deep-link anchor.
 */
export interface DiagramNode {
   id:     string
   x:      number          // top-left, diagram units
   y:      number
   width:  number          // diagram units; author-sized (see the text-in-SVG handling in index.ts)
   height: number
   shape:  NodeShape
   label:  string          // plain text; multi-line via '\n'
   fill?:  string          // optional hex fill override; default = the theme node surface
   stroke?: string         // optional hex border override; default = the theme node border
   textColor?: string      // optional hex label color override; default = the theme node text
}

/** An intermediate bend point on a hand-routed edge (diagram units). */
export interface DiagramWaypoint {
   x: number
   y: number
}

/** An edge: a directed (or undirected) link between two nodes, optionally labeled. */
export interface DiagramEdge {
   id:       string        // stable per-diagram id (needed for stable editor selection/keys)
   from:     string        // source node id
   to:       string        // target node id
   label?:   string        // optional mid-edge label (e.g. "yes"/"no", ER cardinality "1..*")
   arrow?:   EdgeArrow     // default 'end'
   routing?: EdgeRouting   // default 'straight'
   /** Optional intermediate bend points (diagram units) for a hand-routed edge. Absent = the
    *  renderer draws a default straight line or a single-mid-elbow orthogonal path. */
   waypoints?: DiagramWaypoint[]
   stroke?:  string        // optional hex line color override; default = the theme edge color
   dashed?:  boolean       // dashed vs solid (default solid)
}

/** Diagram-level presentation options; all optional, all with render defaults. */
export interface DiagramOptions {
   /** Accessible name + optional visible caption. */
   title?: string
   /** The abstract canvas extent in diagram units; the renderer maps this into the SVG viewBox.
    *  Absent = the viewBox is computed from the node/waypoint bounding box + padding (autofit). */
   canvas?: { width: number; height: number }
}

/** The full spec stored on a diagram block: nodes + edges + presentation options. */
export interface DiagramSpec {
   nodes:   DiagramNode[]
   edges:   DiagramEdge[]
   options: DiagramOptions
}

// ####################
// # MODEL VALIDATION #
// ####################

/** Every node shape the renderer accepts; the parse default when a `shape` cell is bad. */
export const VALID_NODE_SHAPES: ReadonlySet<NodeShape> =
   new Set<NodeShape>(['rectangle', 'rounded', 'ellipse', 'diamond', 'pill', 'banner', 'chevron'])

export const DEFAULT_NODE_SHAPE: NodeShape = 'rectangle'

/** Every arrow placement the renderer accepts; the parse default when an `arrow` cell is bad. */
export const VALID_EDGE_ARROWS: ReadonlySet<EdgeArrow> =
   new Set<EdgeArrow>(['none', 'end', 'start', 'both'])

export const DEFAULT_EDGE_ARROW: EdgeArrow = 'end'

/** Every routing mode the renderer accepts; the parse default when a `routing` cell is bad. */
export const VALID_EDGE_ROUTINGS: ReadonlySet<EdgeRouting> =
   new Set<EdgeRouting>(['straight', 'orthogonal'])

export const DEFAULT_EDGE_ROUTING: EdgeRouting = 'straight'

/**
 * The sane default node size (diagram units) for a node whose width/height could not be read, and
 * the seed size a freshly placed node starts at. Kept here as one source of truth so the fence
 * parser and the (future) editor agree.
 */
export const DIAGRAM_DEFAULT_NODE_WIDTH = 120
export const DIAGRAM_DEFAULT_NODE_HEIGHT = 56

/**
 * The seed size (diagram units) for a freshly placed HEADING shape (`banner` / `chevron`): wider
 * and shorter than the general default so it reads as a step/phase heading immediately, without the
 * author having to resize it by hand. Only affects the size a node is CREATED at; an existing
 * heading node resizes/moves exactly like any other node afterward.
 */
export const DIAGRAM_HEADING_NODE_WIDTH = 220
export const DIAGRAM_HEADING_NODE_HEIGHT = 44

/** Whether `shape` is one of the heading shapes (flat banner / chevron arrow), used to pick the
 *  seed size a freshly added node starts at (see {@link DIAGRAM_HEADING_NODE_WIDTH}). */
export function isHeadingShape(shape: NodeShape): boolean {
   return shape === 'banner' || shape === 'chevron'
}

// ###############
// # THEME SHAPE #
// ###############

/**
 * The ink / chrome tokens the renderer paints with, resolved as literal hex for ONE target theme
 * (light or dark). The renderer never branches on light-vs-dark itself, so passing
 * LIGHT_DIAGRAM_THEME vs DARK_DIAGRAM_THEME (or a custom build) is the single switch between the
 * in-app preview and the baked export.
 */
export interface DiagramTheme {
   /** Default node surface fill (overridable per node). */
   nodeFill: string
   /** Default node border color (overridable per node). */
   nodeStroke: string
   /** Default node label color (overridable per node). */
   nodeText: string
   /** Default edge line color (overridable per edge). */
   edgeStroke: string
   /** Edge label text color. */
   edgeText: string
   /** The chart surface color, used as the halo behind an edge label so a line under it stays
    *  legible; also the empty-state background note contrast. */
   surface: string
   /** Muted text for the empty-state placeholder note. */
   textMuted: string
}

// ##########
// # THEMES #
// ##########

/** The light target theme. Pass this for the in-app light preview and a light-themed export. */
export const LIGHT_DIAGRAM_THEME: DiagramTheme = {
   nodeFill:   '#f1f5f9',
   nodeStroke: '#94a3b8',
   nodeText:   '#0f172a',
   edgeStroke: '#64748b',
   edgeText:   '#334155',
   surface:    '#ffffff',
   textMuted:  '#898781',
}

/** The dark target theme. Pass this for the in-app dark preview and a dark-themed export. */
export const DARK_DIAGRAM_THEME: DiagramTheme = {
   nodeFill:   '#1e293b',
   nodeStroke: '#475569',
   nodeText:   '#f1f5f9',
   edgeStroke: '#94a3b8',
   edgeText:   '#cbd5e1',
   surface:    '#0f172a',
   textMuted:  '#898781',
}
