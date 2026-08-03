// -- Library Imports --
import { Trash2 } from 'lucide-react'

// -- Library / Type Imports --
import { SegmentedIconToggle } from '../atoms/SegmentedIconToggle'
import { ColorSwatchField } from './ColorSwatchField'
import { buildShapeOptions } from './DiagramShapeGlyph'
import { buildArrowOptions, buildRoutingOptions, buildLineStyleOptions } from './DiagramEdgeGlyph'
import { useLang } from '../contexts/LangContext'
import { DEFAULT_EDGE_ARROW, DEFAULT_EDGE_ROUTING } from '../lib/diagram'
import type { DiagramNode, DiagramEdge, DiagramTheme, NodeShape, EdgeArrow, EdgeRouting } from '../lib/diagram'
import type { NodeStylePatch, EdgeStylePatch } from '../lib/diagram/edit'

// #########
// # TYPES #
// #########

interface DiagramInspectorProps {
   /** The currently selected node, or null when a node is not selected. */
   node:  DiagramNode | null
   /** The currently selected edge, or null when an edge is not selected. */
   edge:  DiagramEdge | null
   /** The resolved doc theme, for the default color a swatch shows when an element carries no override. */
   theme: DiagramTheme
   /** Draft a node label edit live on each keystroke (kept in the block's working spec, not yet saved). */
   onLabelDraft: (label: string) => void
   /** Persist the pending node label edit (fires on blur of the label field). */
   onLabelCommit: () => void
   /** Apply a style patch (shape / a color set-or-clear) to the selected node. */
   onStyleChange: (patch: NodeStylePatch) => void
   /** Delete the selected node (and its incident edges). */
   onDelete: () => void
   /** Draft an edge label edit live on each keystroke. */
   onEdgeLabelDraft: (label: string) => void
   /** Persist the pending edge label edit (fires on blur of the label field). */
   onEdgeLabelCommit: () => void
   /** Apply a style patch (arrow / routing / dashed / color) to the selected edge. */
   onEdgeStyleChange: (patch: EdgeStylePatch) => void
   /** Delete the selected edge. */
   onEdgeDelete: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * The diagram editor's inspector: the property panel for the SELECTED element. A selected node shows
 * its shape, label, and fill / border / text-color overrides; a selected edge shows its label,
 * arrowheads, routing, line style, and line color. Nothing selected shows a hint. App-chrome styling
 * (`--color-*`), hosted in the Block Editor Window; the color swatches fall back to the doc-theme
 * default when the element carries no override, and a reset button clears an override back to it.
 */
export function DiagramInspector({
   node, edge, theme, onLabelDraft, onLabelCommit, onStyleChange, onDelete,
   onEdgeLabelDraft, onEdgeLabelCommit, onEdgeStyleChange, onEdgeDelete,
}: DiagramInspectorProps) {
   const { t } = useLang()

   if (node) {
      return (
         <NodePanel
            node={node}
            theme={theme}
            onLabelDraft={onLabelDraft}
            onLabelCommit={onLabelCommit}
            onStyleChange={onStyleChange}
            onDelete={onDelete}
         />
      )
   }
   if (edge) {
      return (
         <EdgePanel
            edge={edge}
            theme={theme}
            onLabelDraft={onEdgeLabelDraft}
            onLabelCommit={onEdgeLabelCommit}
            onStyleChange={onEdgeStyleChange}
            onDelete={onEdgeDelete}
         />
      )
   }
   return <p className="diagram-inspector-hint">{t.diagramNoSelection}</p>
}

// #############
// # NODE PANEL #
// #############

interface NodePanelProps {
   node:  DiagramNode
   theme: DiagramTheme
   onLabelDraft: (label: string) => void
   onLabelCommit: () => void
   onStyleChange: (patch: NodeStylePatch) => void
   onDelete: () => void
}

function NodePanel({ node, theme, onLabelDraft, onLabelCommit, onStyleChange, onDelete }: NodePanelProps) {
   const { t } = useLang()
   return (
      <div className="diagram-inspector">
         {/* ===== Shape ===== */}
         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramNodeShape}</span>
            <SegmentedIconToggle
               options={buildShapeOptions(t)}
               value={node.shape}
               onChange={(shape: NodeShape) => onStyleChange({ shape })}
               ariaLabel={t.diagramNodeShape}
            />
         </label>

         {/* ===== Label ===== */}
         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramNodeLabel}</span>
            <textarea
               key={node.id}
               className="diagram-text-field"
               rows={2}
               spellCheck={false}
               defaultValue={node.label}
               onChange={event => onLabelDraft(event.target.value)}
               onBlur={onLabelCommit}
            />
         </label>

         {/* ===== Colors (wrapping horizontal row, the swatches are compact, the panel is wide) ===== */}
         <div className="diagram-color-group">
            <ColorRow
               label={t.diagramNodeFill}
               value={node.fill}
               fallback={theme.nodeFill}
               resetLabel={t.diagramResetColor}
               onSet={fill => onStyleChange({ fill })}
               onClear={() => onStyleChange({ fill: undefined })}
            />
            <ColorRow
               label={t.diagramNodeStroke}
               value={node.stroke}
               fallback={theme.nodeStroke}
               resetLabel={t.diagramResetColor}
               onSet={stroke => onStyleChange({ stroke })}
               onClear={() => onStyleChange({ stroke: undefined })}
            />
            <ColorRow
               label={t.diagramNodeTextColor}
               value={node.textColor}
               fallback={theme.nodeText}
               resetLabel={t.diagramResetColor}
               onSet={textColor => onStyleChange({ textColor })}
               onClear={() => onStyleChange({ textColor: undefined })}
            />
         </div>

         <button type="button" className="diagram-btn diagram-btn-danger" onClick={onDelete}>
            <Trash2 size={13} />{t.diagramDeleteNode}
         </button>
      </div>
   )
}

// #############
// # EDGE PANEL #
// #############

interface EdgePanelProps {
   edge:  DiagramEdge
   theme: DiagramTheme
   onLabelDraft: (label: string) => void
   onLabelCommit: () => void
   onStyleChange: (patch: EdgeStylePatch) => void
   onDelete: () => void
}

function EdgePanel({ edge, theme, onLabelDraft, onLabelCommit, onStyleChange, onDelete }: EdgePanelProps) {
   const { t } = useLang()
   // Absent fields render at their model default, so show that default in the toggles.
   const arrow: EdgeArrow = edge.arrow ?? DEFAULT_EDGE_ARROW
   const routing: EdgeRouting = edge.routing ?? DEFAULT_EDGE_ROUTING
   const lineStyle = edge.dashed ? 'dashed' : 'solid'

   return (
      <div className="diagram-inspector">
         {/* ===== Label ===== */}
         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramEdgeLabel}</span>
            <textarea
               key={edge.id}
               className="diagram-text-field"
               rows={1}
               spellCheck={false}
               defaultValue={edge.label ?? ''}
               onChange={event => onLabelDraft(event.target.value)}
               onBlur={onLabelCommit}
            />
         </label>

         {/* ===== Arrowheads ===== */}
         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramEdgeArrows}</span>
            <SegmentedIconToggle
               options={buildArrowOptions(t)}
               value={arrow}
               onChange={(next: EdgeArrow) => onStyleChange({ arrow: next })}
               ariaLabel={t.diagramEdgeArrows}
            />
         </label>

         {/* ===== Routing ===== */}
         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramEdgeRouting}</span>
            <SegmentedIconToggle
               options={buildRoutingOptions(t)}
               value={routing}
               onChange={(next: EdgeRouting) => onStyleChange({ routing: next })}
               ariaLabel={t.diagramEdgeRouting}
            />
         </label>

         {/* ===== Line style ===== */}
         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramEdgeLineStyle}</span>
            <SegmentedIconToggle
               options={buildLineStyleOptions(t)}
               value={lineStyle}
               onChange={next => onStyleChange({ dashed: next === 'dashed' })}
               ariaLabel={t.diagramEdgeLineStyle}
            />
         </label>

         {/* ===== Color ===== */}
         <ColorRow
            label={t.diagramEdgeColor}
            value={edge.stroke}
            fallback={theme.edgeStroke}
            resetLabel={t.diagramResetColor}
            onSet={stroke => onStyleChange({ stroke })}
            onClear={() => onStyleChange({ stroke: undefined })}
         />

         <button type="button" className="diagram-btn diagram-btn-danger" onClick={onDelete}>
            <Trash2 size={13} />{t.diagramDeleteEdge}
         </button>
      </div>
   )
}

// #############
// # COLOR ROW #
// #############

interface ColorRowProps {
   label:      string
   /** The element's per-element override hex, or undefined when it uses the theme default. */
   value:      string | undefined
   /** The theme default shown in the swatch when no override is set. */
   fallback:   string
   resetLabel: string
   onSet:   (hex: string) => void
   onClear: () => void
}

/**
 * A labelled color swatch that opens the app ColorPicker in an anchored popover. The swatch shows
 * the element's override when set, otherwise the theme default (`fallback`); the popover's reset
 * row (only offered when an override is set) clears it back to that default.
 */
function ColorRow({ label, value, fallback, resetLabel, onSet, onClear }: ColorRowProps) {
   return (
      <label className="diagram-field">
         <span className="diagram-field-label">{label}</span>
         <ColorSwatchField
            value={value ?? fallback}
            title={label}
            ariaLabel={label}
            onChange={onSet}
            onReset={value !== undefined ? onClear : undefined}
            resetLabel={resetLabel}
            className="diagram-color"
         />
      </label>
   )
}
