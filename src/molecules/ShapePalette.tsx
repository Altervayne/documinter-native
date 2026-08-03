// -- Library / Type Imports --
import type { NodeShape } from '../lib/diagram'
import { NodeShapeGlyph, NODE_SHAPE_ORDER, NODE_SHAPE_LABEL_KEYS } from './DiagramShapeGlyph'
import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface ShapePaletteProps {
   /** Add a node of the chosen shape (placed at the canvas center by the editor, then selected). */
   onAddShape: (shape: NodeShape) => void
}

// #############
// # COMPONENT #
// #############

/**
 * The diagram node editor's shape palette: one button per v1 node shape. Clicking a shape ADDS a node
 * of that shape to the canvas (placed + selected by the editor), a one-click add, no armed-tool
 * mode, so the interaction stays reliable. App-chrome styling (`--color-*`), hosted in the Block
 * Editor Window; each button's glyph reads as the shape it creates.
 */
export function ShapePalette({ onAddShape }: ShapePaletteProps) {
   const { t } = useLang()
   return (
      <div className="diagram-shape-palette" role="toolbar" aria-label={t.diagramShapesSection}>
         {NODE_SHAPE_ORDER.map(shape => {
            const label = t[NODE_SHAPE_LABEL_KEYS[shape]]
            return (
               <button
                  key={shape}
                  type="button"
                  className="diagram-shape-btn"
                  aria-label={label}
                  title={label}
                  onClick={() => onAddShape(shape)}
               >
                  <NodeShapeGlyph shape={shape} />
                  <span className="diagram-shape-btn-label">{label}</span>
               </button>
            )
         })}
      </div>
   )
}
