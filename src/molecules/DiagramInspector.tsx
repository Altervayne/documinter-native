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
   /** The selected node, or null unless exactly one is selected. */
   node:  DiagramNode | null
   /** The selected edge, or null. */
   edge:  DiagramEdge | null
   /** 2+ shows a brief count state instead of any per-node panel. */
   multiSelectCount: number
   /** The doc theme, for the default color a swatch shows when an element carries no override. */
   theme: DiagramTheme
   /** Draft the node label live on each keystroke. */
   onLabelDraft: (label: string) => void
   /** Persist the pending node label (on blur). */
   onLabelCommit: () => void
   onStyleChange: (patch: NodeStylePatch) => void
   /** Delete the selected node and its incident edges. */
   onDelete: () => void
   onEdgeLabelDraft: (label: string) => void
   onEdgeLabelCommit: () => void
   onEdgeStyleChange: (patch: EdgeStylePatch) => void
   onEdgeDelete: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * The diagram editor's property panel for the SELECTED element: a node shows shape / label /
 * fill / border / text-color, an edge shows label / arrowheads / routing / line style / color,
 * nothing selected shows a hint. Color swatches fall back to the doc-theme default when the element
 * carries no override, and a reset clears one back to it.
 */
export function DiagramInspector({
   node, edge, multiSelectCount, theme, onLabelDraft, onLabelCommit, onStyleChange, onDelete,
   onEdgeLabelDraft, onEdgeLabelCommit, onEdgeStyleChange, onEdgeDelete,
}: DiagramInspectorProps) {
   const { t } = useLang()

   // A multi-node selection has no single set of props to edit, so show a brief count instead.
   if (multiSelectCount >= 2) {
      return (
         <p className="diagram-inspector-hint">
            {t.diagramNodesSelected.replace('{count}', String(multiSelectCount))}
         </p>
      )
   }

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
         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramNodeShape}</span>
            <SegmentedIconToggle
               options={buildShapeOptions(t)}
               value={node.shape}
               onChange={(shape: NodeShape) => onStyleChange({ shape })}
               ariaLabel={t.diagramNodeShape}
            />
         </label>

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

         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramEdgeArrows}</span>
            <SegmentedIconToggle
               options={buildArrowOptions(t)}
               value={arrow}
               onChange={(next: EdgeArrow) => onStyleChange({ arrow: next })}
               ariaLabel={t.diagramEdgeArrows}
            />
         </label>

         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramEdgeRouting}</span>
            <SegmentedIconToggle
               options={buildRoutingOptions(t)}
               value={routing}
               onChange={(next: EdgeRouting) => onStyleChange({ routing: next })}
               ariaLabel={t.diagramEdgeRouting}
            />
         </label>

         <label className="diagram-field">
            <span className="diagram-field-label">{t.diagramEdgeLineStyle}</span>
            <SegmentedIconToggle
               options={buildLineStyleOptions(t)}
               value={lineStyle}
               onChange={next => onStyleChange({ dashed: next === 'dashed' })}
               ariaLabel={t.diagramEdgeLineStyle}
            />
         </label>

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
   /** The per-element override hex, or undefined when it uses the theme default. */
   value:      string | undefined
   /** The theme default shown when no override is set. */
   fallback:   string
   resetLabel: string
   onSet:   (hex: string) => void
   onClear: () => void
}

/** A labelled color swatch: shows the override when set, else `fallback`; the reset row (only when
 *  an override is set) clears it back to the default. */
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
