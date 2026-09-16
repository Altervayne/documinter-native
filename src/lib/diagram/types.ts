/*
 * The pure data model + theme shape for the diagram (nodes + links) block. Coordinates live in
 * ABSTRACT DIAGRAM UNITS, not screen pixels; the renderer maps the bounding box (or an explicit
 * `options.canvas`) into the SVG viewBox. A DiagramTheme is resolved for ONE target (light or dark),
 * so the same renderer serves the in-app preview and the baked export by passing a different theme.
 */

// #########
// # TYPES #
// #########

/**
 * A node shape from a fixed set; an unknown value falls back to 'rectangle' on parse. `banner` and
 * `chevron` are HEADING shapes (a flat bar, a right-pointing process arrow), ordinary in every way
 * but seeded at a wider, shorter default size (see {@link isHeadingShape}).
 */
export type NodeShape = 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'pill' | 'banner' | 'chevron'

export type EdgeArrow = 'none' | 'end' | 'start' | 'both'

/** Straight or elbow. */
export type EdgeRouting = 'straight' | 'orthogonal'

/** `id` is referenced by edges, unrelated to the block-level `Block.handle` deep-link anchor. */
export interface DiagramNode {
   id:     string
   x:      number          // top-left, diagram units
   y:      number
   width:  number          // author-sized
   height: number
   shape:  NodeShape
   label:  string          // plain text; multi-line via '\n'
   fill?:  string
   stroke?: string
   textColor?: string
}

export interface DiagramWaypoint {
   x: number
   y: number
}

export interface DiagramEdge {
   id:       string
   from:     string
   to:       string
   label?:   string        // mid-edge label (e.g. "yes"/"no", ER cardinality "1..*")
   arrow?:   EdgeArrow     // default 'end'
   routing?: EdgeRouting   // default 'straight'
   /** Absent = a default straight line or single-mid-elbow orthogonal path. */
   waypoints?: DiagramWaypoint[]
   stroke?:  string
   dashed?:  boolean       // default solid
}

export interface DiagramOptions {
   /** Accessible name + optional visible caption. */
   title?: string
   /** Abstract canvas extent, mapped into the SVG viewBox. Absent = autofit to content + padding. */
   canvas?: { width: number; height: number }
}

export interface DiagramSpec {
   nodes:   DiagramNode[]
   edges:   DiagramEdge[]
   options: DiagramOptions
}

// ####################
// # MODEL VALIDATION #
// ####################

export const VALID_NODE_SHAPES: ReadonlySet<NodeShape> =
   new Set<NodeShape>(['rectangle', 'rounded', 'ellipse', 'diamond', 'pill', 'banner', 'chevron'])

export const DEFAULT_NODE_SHAPE: NodeShape = 'rectangle'

export const VALID_EDGE_ARROWS: ReadonlySet<EdgeArrow> =
   new Set<EdgeArrow>(['none', 'end', 'start', 'both'])

export const DEFAULT_EDGE_ARROW: EdgeArrow = 'end'

export const VALID_EDGE_ROUTINGS: ReadonlySet<EdgeRouting> =
   new Set<EdgeRouting>(['straight', 'orthogonal'])

export const DEFAULT_EDGE_ROUTING: EdgeRouting = 'straight'

/** Default node size, and the seed size a freshly placed node starts at. */
export const DIAGRAM_DEFAULT_NODE_WIDTH = 120
export const DIAGRAM_DEFAULT_NODE_HEIGHT = 56

/** Seed size for a freshly placed HEADING shape, wider and shorter so it reads as a heading. Only
 *  the CREATE size; an existing heading node resizes/moves like any other afterward. */
export const DIAGRAM_HEADING_NODE_WIDTH = 220
export const DIAGRAM_HEADING_NODE_HEIGHT = 44

export function isHeadingShape(shape: NodeShape): boolean {
   return shape === 'banner' || shape === 'chevron'
}

// ###############
// # THEME SHAPE #
// ###############

/** Ink / chrome tokens resolved as literal hex for ONE target theme. The renderer never branches on
 *  light-vs-dark, so swapping LIGHT_DIAGRAM_THEME for DARK_DIAGRAM_THEME is the only switch. */
export interface DiagramTheme {
   nodeFill: string
   nodeStroke: string
   nodeText: string
   edgeStroke: string
   edgeText: string
   /** Halo behind an edge label so a line under it stays legible; also the empty-state contrast. */
   surface: string
   textMuted: string
}

// ##########
// # THEMES #
// ##########

export const LIGHT_DIAGRAM_THEME: DiagramTheme = {
   nodeFill:   '#f1f5f9',
   nodeStroke: '#94a3b8',
   nodeText:   '#0f172a',
   edgeStroke: '#64748b',
   edgeText:   '#334155',
   surface:    '#ffffff',
   textMuted:  '#898781',
}

export const DARK_DIAGRAM_THEME: DiagramTheme = {
   nodeFill:   '#1e293b',
   nodeStroke: '#475569',
   nodeText:   '#f1f5f9',
   edgeStroke: '#94a3b8',
   edgeText:   '#cbd5e1',
   surface:    '#0f172a',
   textMuted:  '#898781',
}
