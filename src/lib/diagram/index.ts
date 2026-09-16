/*
 * The public entry point for the diagram (nodes + links) renderer. `renderDiagramToSvg(spec, theme)`
 * returns one self-contained, responsive <svg> string: pure, synchronous, deterministic, total,
 * colors baked as literal theme hex, safe to inline into the HTML export. An empty spec renders an
 * empty-state placeholder; an edge to a missing node id is skipped, never thrown.
 */

import type { DiagramSpec, DiagramNode, DiagramEdge, DiagramTheme, EdgeArrow } from './types'
import {
   DEFAULT_EDGE_ARROW,
} from './types'
import type { Point } from './geometry'
import {
   contentBounds, nodeCornerPoints, edgePolyline,
   wrapLabel, maxLabelLines, estimateTextWidth, LINE_HEIGHT_RATIO,
} from './geometry'
import { renderNodeShape, chevronPointDepth } from './shapes'
import { renderArrowhead } from './arrow'
import {
   escapeXml, roundCoordinate, element, selfClosingElement, textElement, titleElement, descElement,
} from '../svg'

// #############
// # CONSTANTS #
// #############

// Font names use SINGLE quotes: this string sits inside the double-quoted `style="..."` attribute
// on the root <svg>, where a double quote would prematurely close the attribute.
const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif"

const LABEL_FONT_SIZE = 14

const EDGE_LABEL_FONT_SIZE = 12

/** Inner horizontal padding reserved inside a node box for its label. */
const LABEL_PADDING = 8

const EDGE_STROKE_WIDTH = 1.5

const EDGE_DASH_ARRAY = '6 4'

const AUTOFIT_PADDING = 24

const EMPTY_WIDTH = 260
const EMPTY_HEIGHT = 120

// #####################
// # PUBLIC ENTRYPOINT #
// #####################

/** Render a diagram spec to a complete, self-contained SVG string for the resolved theme. */
export function renderDiagramToSvg(spec: DiagramSpec, theme: DiagramTheme): string {
   if (!spec.nodes || spec.nodes.length === 0) {
      return renderEmptyState(spec, theme)
   }

   const nodesById = new Map<string, DiagramNode>()
   for (const node of spec.nodes) nodesById.set(node.id, node)

   // Edges draw UNDER the nodes; the arrowhead body sits outside the node border so a node on top
   // never covers it.
   const edgeMarkup = (spec.edges ?? [])
      .map(edge => renderEdge(edge, nodesById, theme))
      .filter(markup => markup !== '')
      .join('')

   const nodeMarkup = spec.nodes.map(node => renderNode(node, theme)).join('')

   const viewBox = resolveViewBox(spec)
   const accessibleTitle = spec.options.title ?? 'Diagram'
   const accessibleDesc = describeDiagram(spec)

   return wrapSvg(viewBox, accessibleTitle, accessibleDesc, edgeMarkup + nodeMarkup)
}

// #####################
// # NODE RENDERING    #
// #####################

/** Render one node: its shape, a native <title> tooltip, and its wrapped, centered label. */
function renderNode(node: DiagramNode, theme: DiagramTheme): string {
   const colors = {
      fill:   node.fill ?? theme.nodeFill,
      stroke: node.stroke ?? theme.nodeStroke,
   }
   const shape = renderNodeShape(node, colors)
   const title = node.label.trim() !== '' ? titleElement(node.label) : ''
   const label = renderNodeLabel(node, node.textColor ?? theme.nodeText)
   return element('g', {}, `${title}${shape}${label}`)
}

/** Render a node's label as one or more centered <tspan> lines, wrapped/clipped to the box. */
function renderNodeLabel(node: DiagramNode, color: string): string {
   // A chevron's point/notch eats into the box on both sides; reserve that depth so the label stays
   // clear of the point.
   const horizontalInset = LABEL_PADDING + (node.shape === 'chevron' ? chevronPointDepth(node) : 0)
   const maxWidth = Math.max(0, node.width - horizontalInset * 2)
   const lines = wrapLabel(node.label, maxWidth, LABEL_FONT_SIZE, maxLabelLines(node.height, LABEL_FONT_SIZE))
   if (lines.length === 0) return ''

   const centerX = node.x + node.width / 2
   const centerY = node.y + node.height / 2
   const lineHeight = LABEL_FONT_SIZE * LINE_HEIGHT_RATIO
   const startY = centerY - (lines.length - 1) / 2 * lineHeight

   const tspans = lines.map((line, index) => {
      const y = roundCoordinate(startY + index * lineHeight)
      return `<tspan x="${roundCoordinate(centerX)}" y="${y}">${escapeXml(line)}</tspan>`
   }).join('')

   return `<text text-anchor="middle" dominant-baseline="central" font-size="${LABEL_FONT_SIZE}" fill="${escapeXml(color)}">${tspans}</text>`
}

// #####################
// # EDGE RENDERING    #
// #####################

/** Render one edge: clipped path, arrowhead(s), optional mid-edge label. Returns '' when either
 *  endpoint node is missing, so a dangling edge is silently skipped. */
function renderEdge(edge: DiagramEdge, nodesById: Map<string, DiagramNode>, theme: DiagramTheme): string {
   const fromNode = nodesById.get(edge.from)
   const toNode = nodesById.get(edge.to)
   if (!fromNode || !toNode) return ''

   const points = edgePolyline(edge, fromNode, toNode)
   if (points.length < 2) return ''

   const color = edge.stroke ?? theme.edgeStroke
   const pathData = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${roundCoordinate(point.x)},${roundCoordinate(point.y)}`)
      .join(' ')
   const path = selfClosingElement('path', {
      d:                pathData,
      fill:             'none',
      stroke:           color,
      'stroke-width':   EDGE_STROKE_WIDTH,
      'stroke-dasharray': edge.dashed ? EDGE_DASH_ARRAY : undefined,
   })

   const arrow: EdgeArrow = edge.arrow && isValidArrow(edge.arrow) ? edge.arrow : DEFAULT_EDGE_ARROW
   const arrows = renderEdgeArrows(points, arrow, color)

   const label = renderEdgeLabel(edge, points, theme)

   const title = titleElement(edgeTooltip(edge, fromNode, toNode))
   return element('g', {}, `${title}${path}${arrows}${label}`)
}

/** Whether an arrow value is accepted (a hand-edited spec may carry garbage). */
function isValidArrow(arrow: string): arrow is EdgeArrow {
   return arrow === 'none' || arrow === 'end' || arrow === 'start' || arrow === 'both'
}

/** Build the arrowhead polygon(s) for the resolved arrow placement. */
function renderEdgeArrows(points: Point[], arrow: EdgeArrow, color: string): string {
   if (arrow === 'none') return ''
   const last = points[points.length - 1]
   const secondLast = points[points.length - 2]
   const first = points[0]
   const second = points[1]

   let markup = ''
   if (arrow === 'end' || arrow === 'both') {
      markup += renderArrowhead(secondLast, last, color)
   }
   if (arrow === 'start' || arrow === 'both') {
      markup += renderArrowhead(second, first, color)
   }
   return markup
}

/** Render an edge's optional label at the polyline midpoint, over a surface-colored halo rect. */
function renderEdgeLabel(edge: DiagramEdge, points: Point[], theme: DiagramTheme): string {
   const label = edge.label?.trim()
   if (!label) return ''
   const midpoint = polylineMidpoint(points)
   const textWidth = estimateTextWidth(label, EDGE_LABEL_FONT_SIZE)
   const paddingX = 4
   const rectWidth = textWidth + paddingX * 2
   const rectHeight = EDGE_LABEL_FONT_SIZE * 1.4

   const halo = selfClosingElement('rect', {
      x:      midpoint.x - rectWidth / 2,
      y:      midpoint.y - rectHeight / 2,
      width:  rectWidth,
      height: rectHeight,
      rx:     3,
      ry:     3,
      fill:   theme.surface,
   })
   const text = textElement({
      x:                  midpoint.x,
      y:                  midpoint.y,
      'text-anchor':      'middle',
      'dominant-baseline': 'central',
      'font-size':        EDGE_LABEL_FONT_SIZE,
      fill:               theme.edgeText,
   }, label)
   return `${halo}${text}`
}

/** The midpoint of the polyline's middle segment (or its middle waypoint for an odd count). */
function polylineMidpoint(points: Point[]): Point {
   if (points.length === 0) return { x: 0, y: 0 }
   if (points.length === 1) return points[0]
   const lastIndex = points.length - 1
   const lowerIndex = Math.floor(lastIndex / 2)
   const upperIndex = Math.ceil(lastIndex / 2)
   const lower = points[lowerIndex]
   const upper = points[upperIndex]
   return { x: (lower.x + upper.x) / 2, y: (lower.y + upper.y) / 2 }
}

/** An edge tooltip: its label, else "from to" using the node labels/ids. */
function edgeTooltip(edge: DiagramEdge, fromNode: DiagramNode, toNode: DiagramNode): string {
   const fromLabel = fromNode.label.trim() || fromNode.id
   const toLabel = toNode.label.trim() || toNode.id
   const base = `${fromLabel} → ${toLabel}`
   return edge.label?.trim() ? `${base}: ${edge.label.trim()}` : base
}

// #####################
// # VIEWBOX / ENVELOPE #
// #####################

/** The `viewBox` string. An explicit `options.canvas` maps to `0 0 W H`; otherwise the autofit
 *  content bounding box padded by AUTOFIT_PADDING. */
function resolveViewBox(spec: DiagramSpec): string {
   const canvas = spec.options.canvas
   if (canvas && Number.isFinite(canvas.width) && Number.isFinite(canvas.height)
      && canvas.width > 0 && canvas.height > 0) {
      return `0 0 ${roundCoordinate(canvas.width)} ${roundCoordinate(canvas.height)}`
   }

   const points: Point[] = []
   for (const node of spec.nodes) points.push(...nodeCornerPoints(node))
   for (const edge of spec.edges ?? []) {
      for (const waypoint of edge.waypoints ?? []) points.push(waypoint)
   }
   const bounds = contentBounds(points, AUTOFIT_PADDING)
   const width = Math.max(1, bounds.maxX - bounds.minX)
   const height = Math.max(1, bounds.maxY - bounds.minY)
   return `${roundCoordinate(bounds.minX)} ${roundCoordinate(bounds.minY)} ${roundCoordinate(width)} ${roundCoordinate(height)}`
}

/** Wrap inner markup in the responsive <svg> root with the accessible title/desc. */
function wrapSvg(viewBox: string, accessibleTitle: string, accessibleDesc: string, body: string): string {
   const open =
      `<svg xmlns="http://www.w3.org/2000/svg" role="img"` +
      ` viewBox="${viewBox}"` +
      ` style="width:100%;height:auto;font-family:${FONT_STACK}">`
   return `${open}${titleElement(accessibleTitle)}${descElement(accessibleDesc)}${body}</svg>`
}

// #####################
// # EMPTY / A11Y      #
// #####################

/** A minimal placeholder SVG for an empty diagram. */
function renderEmptyState(spec: DiagramSpec, theme: DiagramTheme): string {
   const title = spec.options.title ?? 'Empty diagram'
   const note = textElement({
      x: EMPTY_WIDTH / 2,
      y: EMPTY_HEIGHT / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 14,
      fill: theme.textMuted,
   }, 'Empty diagram')
   return wrapSvg(`0 0 ${EMPTY_WIDTH} ${EMPTY_HEIGHT}`, title, 'Empty diagram with no nodes.', element('g', {}, note))
}

/** A one-line accessible summary: "Diagram with N nodes and M links." Returned RAW (desc escapes). */
function describeDiagram(spec: DiagramSpec): string {
   const nodeCount = spec.nodes.length
   const edgeCount = (spec.edges ?? []).length
   const nodeWord = nodeCount === 1 ? 'node' : 'nodes'
   const edgeWord = edgeCount === 1 ? 'link' : 'links'
   return `Diagram with ${nodeCount} ${nodeWord} and ${edgeCount} ${edgeWord}.`
}

// #####################
// # RE-EXPORTS        #
// #####################

export type {
   DiagramSpec,
   DiagramNode,
   DiagramEdge,
   DiagramWaypoint,
   DiagramOptions,
   DiagramTheme,
   NodeShape,
   EdgeArrow,
   EdgeRouting,
} from './types'

export {
   LIGHT_DIAGRAM_THEME,
   DARK_DIAGRAM_THEME,
   VALID_NODE_SHAPES,
   VALID_EDGE_ARROWS,
   VALID_EDGE_ROUTINGS,
   DEFAULT_NODE_SHAPE,
   DEFAULT_EDGE_ARROW,
   DEFAULT_EDGE_ROUTING,
   DIAGRAM_DEFAULT_NODE_WIDTH,
   DIAGRAM_DEFAULT_NODE_HEIGHT,
   DIAGRAM_HEADING_NODE_WIDTH,
   DIAGRAM_HEADING_NODE_HEIGHT,
   isHeadingShape,
} from './types'
