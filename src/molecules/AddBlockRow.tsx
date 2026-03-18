import type { BlockType } from '../types'
import { useLang } from '../lib/LangContext'
import { BLOCK_ICONS } from '../lib/constants'

interface AddBlockRowProps {
   onAdd: (type: BlockType) => void
   /** When true, hides the container button (no nested containers). */
   insideContainer?: boolean
   /**
    * When true, uses doc-CSS classes (.wysiwyg-add-btn / .inline-add-row) instead
    * of Tailwind classes. Use inside the WYSIWYG area so buttons follow doc-theme.
    */
   docStyle?: boolean
}

export function AddBlockRow({ onAdd, insideContainer, docStyle }: AddBlockRowProps) {
   const { t } = useLang()
   const labels: Record<BlockType, string> = {
      p: t.blockParagraph, h3: t.blockH3, h4: t.blockH4,
      callout: t.blockCallout, code: t.blockCode, list: t.blockList, table: t.blockTable,
      image: t.blockImage, container: t.blockContainer,
   }
   const icons = insideContainer ? BLOCK_ICONS.filter(blockIcon => blockIcon.type !== 'container') : BLOCK_ICONS

   if (docStyle) {
      // Uses doc.css classes so buttons inherit the document theme (light/dark)
      return (
         <div className="inline-add-row" style={{ opacity: 1 }}>
            <span style={{ fontSize: '0.65rem', color: '#9ca3af', fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
               {t.add}
            </span>
            {icons.map(({ type, icon: Icon }) => (
               <button key={type} title={labels[type]} className="wysiwyg-add-btn" onClick={() => onAdd(type)}>
                  <Icon size={13} />
               </button>
            ))}
         </div>
      )
   }

   return (
      <div className="flex flex-wrap items-center gap-1 pt-2.5 mt-1.5 border-t border-border/50">
         <span className="font-mono text-xs uppercase tracking-wider text-muted/50 mr-1">{t.add}</span>
         {icons.map(({ type, icon: Icon }) => (
            <button
               key={type}
               onClick={() => onAdd(type)}
               title={labels[type]}
               className="p-1.5 rounded-lg border border-border/60 bg-bg text-muted hover:text-accent hover:border-accent/50 hover:bg-accent/5 transition-colors cursor-pointer"
            >
               <Icon size={14} />
            </button>
         ))}
      </div>
   )
}
