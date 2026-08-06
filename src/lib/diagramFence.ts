/**
 * diagramFence.ts, the ` ```diagram ` fence serializer / parser for the diagram (nodes + links) block.
 *
 * A diagram block round-trips losslessly through a fenced payload: diagram-level options ride the
 * fence INFO STRING as `key=value` tokens (reusing the shared `fenceInfoString.ts` grammar), and
 * the data rides the fence BODY as TWO Markdown pipe tables, a nodes table + an edges table,
 * separated by a blank line, both parsed with the same `parsePipeTableRow` the table block uses.
 * This is fidelity-first, NOT mermaid: a manually positioned diagram's load-bearing state
 * (x/y/size/shape/style) is exactly what plain mermaid cannot express, so the native format stores
 * the model directly.
 *
 * The two tables are classified by their HEADER (a nodes table's first header cell is `id`; an
 * edges table's is `from`), so their order is robust to hand editing and either can be absent.
 *
 * Both directions are total: `diagramSpecToFence` never throws on a partial spec, and
 * `fenceToDiagramSpec` never throws on a malformed fence (a bad coordinate defaults, an unknown
 * shape falls back to `rectangle`, an edge to a missing node is KEPT in the model, the renderer
 * skips it at draw time, so a hand-edited file can never break the document).
 */

import type {
   DiagramSpec, DiagramNode, DiagramEdge, DiagramOptions, NodeShape, EdgeArrow, EdgeRouting,
} from './diagram/types'
import {
   VALID_NODE_SHAPES, VALID_EDGE_ARROWS, VALID_EDGE_ROUTINGS,
   DEFAULT_NODE_SHAPE, DEFAULT_EDGE_ARROW, DEFAULT_EDGE_ROUTING,
   DIAGRAM_DEFAULT_NODE_WIDTH, DIAGRAM_DEFAULT_NODE_HEIGHT,
} from './diagram/types'
import { parsePipeTableRow } from './markdown'
import { serializeInfoValue, unquoteInfoValue, tokenizeInfoString } from './fenceInfoString'

// ##########################
// # INFO STRING (OPTIONS)  #
// ##########################

/** Serialize the diagram-level options into the ordered `key=value` token list (sans the tag). */
function serializeInfoTokens(options: DiagramOptions): string[] {
   const tokens: string[] = []
   if (options.title !== undefined && options.title !== '') {
      tokens.push(`title=${serializeInfoValue(options.title)}`)
   }
   // The explicit canvas extent rides as `canvas=<w>x<h>` (no spaces, so it needs no quoting); an
   // absent canvas means "autofit" and emits no token, keeping an untouched diagram's fence lean.
   if (options.canvas
      && Number.isFinite(options.canvas.width) && Number.isFinite(options.canvas.height)
      && options.canvas.width > 0 && options.canvas.height > 0) {
      tokens.push(`canvas=${options.canvas.width}x${options.canvas.height}`)
   }
   return tokens
}

/** Parse the info string (the whole `diagram ...` line after the backticks) into options. */
function parseInfoString(fenceInfo: string): DiagramOptions {
   const tokens = tokenizeInfoString(fenceInfo)
   // tokens[0] is the `diagram` tag itself; options start at index 1.
   const options: DiagramOptions = {}
   for (const token of tokens.slice(1)) {
      const equalsIndex = token.indexOf('=')
      if (equalsIndex === -1) continue
      const key = token.slice(0, equalsIndex)
      const value = unquoteInfoValue(token.slice(equalsIndex + 1))

      if (key === 'title') {
         if (value !== '') options.title = value
      } else if (key === 'canvas') {
         const canvas = parseCanvasToken(value)
         if (canvas) options.canvas = canvas
      }
   }
   return options
}

/** Parse a `<w>x<h>` canvas token into positive dimensions, or null when malformed. */
function parseCanvasToken(value: string): { width: number; height: number } | null {
   const parts = value.split('x')
   if (parts.length !== 2) return null
   const width = Number(parts[0])
   const height = Number(parts[1])
   if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
   return { width, height }
}

// ##########################
// # LABEL CELL CODEC       #
// ##########################
// A pipe-table cell is one physical line, so a multi-line label ('\n') and a literal pipe both
// need encoding. Pipes are handled by escapePipeCell/parsePipeTableRow (the `\|` convention the
// table block already uses); newlines and backslashes are handled here so the codec composes
// cleanly with the pipe escaping and stays lossless.

/** Encode a label for a pipe-table cell: escape backslashes, newlines, then pipes (in that order). */
function encodeLabelCell(label: string): string {
   return label
      .replace(/\\/g, '\\\\')   // backslash first, so the escapes we add next aren't double-hit
      .replace(/\n/g, '\\n')    // newline -> literal backslash-n
      .replace(/\|/g, '\\|')    // pipe -> escaped pipe (matches parsePipeTableRow)
}

/**
 * Decode a cell value that `parsePipeTableRow` already returned (pipes de-escaped) back to the
 * label text, resolving `\n` -> newline and `\\` -> backslash. A trailing lone backslash, or an
 * `\<other>`, keeps the following character literally (lenient, never throws).
 */
function decodeLabelCell(cell: string): string {
   let result = ''
   let index = 0
   while (index < cell.length) {
      if (cell[index] === '\\' && index + 1 < cell.length) {
         const next = cell[index + 1]
         result += next === 'n' ? '\n' : next
         index += 2
      } else {
         result += cell[index]
         index++
      }
   }
   return result
}

// ##########################
// # NUMBER / TABLE HELPERS #
// ##########################

/** Whether a parsed row is a Markdown table separator (each cell is dashes, optional colons). */
function isSeparatorRow(cells: string[]): boolean {
   return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell.trim()))
}

/** Parse a numeric cell, falling back to `fallback` for a blank / non-finite value. */
function parseNumberCell(raw: string | undefined, fallback: number): number {
   if (raw === undefined) return fallback
   const trimmed = raw.trim()
   if (trimmed === '') return fallback
   const parsed = Number(trimmed)
   return Number.isFinite(parsed) ? parsed : fallback
}

/** A group of consecutive pipe-table rows (the raw lines) plus its parsed header cells. */
interface TableGroup {
   headerCells: string[]
   /** Body rows (header + optional separator already removed). */
   bodyRows: string[][]
}

/** A column-name -> column-index lookup, built from a table group's (lower-cased) header cells.
 *  Lets the parsers read cells by NAME so a hand-edited fence with reordered / partial columns
 *  still resolves each field correctly (self-describing by header). */
function columnIndex(headerCells: string[]): Map<string, number> {
   const index = new Map<string, number>()
   headerCells.forEach((cell, position) => {
      const key = cell.trim().toLowerCase()
      if (key !== '' && !index.has(key)) index.set(key, position)
   })
   return index
}

/** Read a row cell by any of the given header names (first match wins), else undefined. */
function cellByName(cells: string[], columns: Map<string, number>, ...names: string[]): string | undefined {
   for (const name of names) {
      const position = columns.get(name)
      if (position !== undefined) return cells[position]
   }
   return undefined
}

/**
 * Split the fence body into its constituent pipe tables (runs of consecutive `|`-lines separated
 * by blank lines), parsing each into a header + body-rows group. A leading separator row directly
 * after the header is skipped. Non-pipe lines are ignored, so stray prose can't break parsing.
 */
function splitTables(body: string): TableGroup[] {
   const groups: TableGroup[] = []
   let currentLines: string[] = []

   const flush = () => {
      if (currentLines.length === 0) return
      const rows = currentLines.map(parsePipeTableRow)
      currentLines = []
      if (rows.length === 0) return
      const headerCells = rows[0]
      let bodyStart = 1
      if (rows.length > 1 && isSeparatorRow(rows[1])) bodyStart = 2
      groups.push({ headerCells, bodyRows: rows.slice(bodyStart) })
   }

   for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (line.startsWith('|')) {
         currentLines.push(line)
      } else {
         flush()
      }
   }
   flush()
   return groups
}

// ##########################
// # NODES TABLE            #
// ##########################

const NODE_HEADER = '| id | shape | label | x | y | w | h | fill | stroke | text |'
const NODE_SEPARATOR = '| --- | ----- | ----- | - | - | - | - | ---- | ------ | ---- |'

/** Serialize the nodes to the nodes pipe table (header + separator + one row per node). */
function serializeNodesTable(nodes: DiagramNode[]): string {
   const rows = nodes.map(node => {
      const cells = [
         encodeLabelCell(node.id),
         node.shape,
         encodeLabelCell(node.label),
         String(node.x),
         String(node.y),
         String(node.width),
         String(node.height),
         node.fill ?? '',
         node.stroke ?? '',
         node.textColor ?? '',
      ]
      return `| ${cells.join(' | ')} |`
   })
   return [NODE_HEADER, NODE_SEPARATOR, ...rows].join('\n')
}

/** Parse a nodes table group into DiagramNodes. A row missing an id is skipped (no edge can ref it). */
function parseNodesTable(group: TableGroup): DiagramNode[] {
   const columns = columnIndex(group.headerCells)
   const nodes: DiagramNode[] = []
   for (const cells of group.bodyRows) {
      const id = decodeLabelCell(cellByName(cells, columns, 'id') ?? '').trim()
      if (id === '') continue
      const shapeRaw = (cellByName(cells, columns, 'shape') ?? '').trim() as NodeShape
      const node: DiagramNode = {
         id,
         shape:  VALID_NODE_SHAPES.has(shapeRaw) ? shapeRaw : DEFAULT_NODE_SHAPE,
         label:  decodeLabelCell(cellByName(cells, columns, 'label') ?? ''),
         x:      parseNumberCell(cellByName(cells, columns, 'x'), 0),
         y:      parseNumberCell(cellByName(cells, columns, 'y'), 0),
         width:  parseNumberCell(cellByName(cells, columns, 'w', 'width'), DIAGRAM_DEFAULT_NODE_WIDTH),
         height: parseNumberCell(cellByName(cells, columns, 'h', 'height'), DIAGRAM_DEFAULT_NODE_HEIGHT),
      }
      const fill = (cellByName(cells, columns, 'fill') ?? '').trim()
      const stroke = (cellByName(cells, columns, 'stroke') ?? '').trim()
      const text = (cellByName(cells, columns, 'text', 'textcolor') ?? '').trim()
      if (fill !== '') node.fill = fill
      if (stroke !== '') node.stroke = stroke
      if (text !== '') node.textColor = text
      nodes.push(node)
   }
   return nodes
}

// ##########################
// # EDGES TABLE            #
// ##########################

const EDGE_HEADER = '| id | from | to | label | arrow | routing | dashed | stroke | waypoints |'
const EDGE_SEPARATOR = '| -- | ---- | -- | ----- | ----- | ------- | ------ | ------ | --------- |'

/** Serialize an edge's waypoints to a compact `x,y;x,y` cell (empty when none). */
function serializeWaypoints(edge: DiagramEdge): string {
   const waypoints = edge.waypoints ?? []
   if (waypoints.length === 0) return ''
   return waypoints.map(point => `${point.x},${point.y}`).join(';')
}

/** Parse a `x,y;x,y` waypoints cell into points, skipping any malformed pair. */
function parseWaypoints(raw: string | undefined): { x: number; y: number }[] {
   if (!raw || raw.trim() === '') return []
   const points: { x: number; y: number }[] = []
   for (const pair of raw.split(';')) {
      const parts = pair.split(',')
      if (parts.length !== 2) continue
      const x = Number(parts[0])
      const y = Number(parts[1])
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y })
   }
   return points
}

/** Serialize the edges to the edges pipe table. Hand-routed waypoints ride their own compact
 *  `x,y;x,y` cell so an elbowed edge round-trips losslessly. */
function serializeEdgesTable(edges: DiagramEdge[]): string {
   const rows = edges.map(edge => {
      const cells = [
         encodeLabelCell(edge.id),
         encodeLabelCell(edge.from),
         encodeLabelCell(edge.to),
         encodeLabelCell(edge.label ?? ''),
         edge.arrow ?? '',
         edge.routing ?? '',
         edge.dashed ? 'true' : '',
         edge.stroke ?? '',
         serializeWaypoints(edge),
      ]
      return `| ${cells.join(' | ')} |`
   })
   return [EDGE_HEADER, EDGE_SEPARATOR, ...rows].join('\n')
}

/** Parse an edges table group into DiagramEdges. A row missing from/to is skipped (unlinkable). */
function parseEdgesTable(group: TableGroup): DiagramEdge[] {
   const columns = columnIndex(group.headerCells)
   const edges: DiagramEdge[] = []
   let autoId = 0
   for (const cells of group.bodyRows) {
      const from = decodeLabelCell(cellByName(cells, columns, 'from') ?? '').trim()
      const to = decodeLabelCell(cellByName(cells, columns, 'to') ?? '').trim()
      if (from === '' || to === '') continue
      // An id is optional in a hand-edited fence; synthesize a stable one so the editor keys hold.
      const idCell = decodeLabelCell(cellByName(cells, columns, 'id') ?? '').trim()
      const id = idCell !== '' ? idCell : `edge-${autoId}`
      autoId++

      const edge: DiagramEdge = { id, from, to }
      const label = decodeLabelCell(cellByName(cells, columns, 'label') ?? '')
      if (label !== '') edge.label = label

      const arrowRaw = (cellByName(cells, columns, 'arrow') ?? '').trim()
      if (arrowRaw !== '' && VALID_EDGE_ARROWS.has(arrowRaw as EdgeArrow) && arrowRaw !== DEFAULT_EDGE_ARROW) {
         edge.arrow = arrowRaw as EdgeArrow
      }
      const routingRaw = (cellByName(cells, columns, 'routing') ?? '').trim()
      if (routingRaw !== '' && VALID_EDGE_ROUTINGS.has(routingRaw as EdgeRouting) && routingRaw !== DEFAULT_EDGE_ROUTING) {
         edge.routing = routingRaw as EdgeRouting
      }
      if ((cellByName(cells, columns, 'dashed') ?? '').trim().toLowerCase() === 'true') edge.dashed = true
      const stroke = (cellByName(cells, columns, 'stroke') ?? '').trim()
      if (stroke !== '') edge.stroke = stroke
      const waypoints = parseWaypoints(cellByName(cells, columns, 'waypoints'))
      if (waypoints.length > 0) edge.waypoints = waypoints

      edges.push(edge)
   }
   return edges
}

// ################
// # PUBLIC API #
// ################

/**
 * Serialize a DiagramSpec to its fence pieces: the full info string (including the leading
 * `diagram` tag) and the two-table body. The caller wraps them in the ``` ... ``` fence. Same output
 * in both `.mint` and `.md`, a diagram fence is Documint-specific in either format.
 */
export function diagramSpecToFence(spec: DiagramSpec): { info: string; body: string } {
   const infoTokens = serializeInfoTokens(spec.options ?? {})
   const info = ['diagram', ...infoTokens].join(' ').trimEnd()
   const nodesTable = serializeNodesTable(spec.nodes ?? [])
   const edgesTable = serializeEdgesTable(spec.edges ?? [])
   // The blank line between the two tables is the group separator splitTables reads back.
   const body = `${nodesTable}\n\n${edgesTable}`
   return { info, body }
}

/**
 * Parse a `diagram` fence (its whole info string + its two-table body) back into a DiagramSpec.
 * Total: a malformed or partial fence degrades per-field and yields whatever nodes/edges could be
 * read (possibly empty), never an exception. The two tables are matched by header (`id` = nodes,
 * `from` = edges), so their order does not matter and either can be absent.
 */
export function fenceToDiagramSpec(fenceInfo: string, body: string): DiagramSpec {
   const options = parseInfoString(fenceInfo)
   const groups = splitTables(body)

   let nodes: DiagramNode[] = []
   let edges: DiagramEdge[] = []
   for (const group of groups) {
      const columns = columnIndex(group.headerCells)
      // An edges table is the one carrying both `from` and `to` columns; anything else with an
      // `id` column is a nodes table. Header-based (not position-based), so the two `id`-first
      // tables never confuse each other and a hand-edited column order still classifies right.
      if (columns.has('from') && columns.has('to')) {
         edges = edges.concat(parseEdgesTable(group))
      } else if (columns.has('id')) {
         nodes = nodes.concat(parseNodesTable(group))
      }
   }

   return { nodes, edges, options }
}
