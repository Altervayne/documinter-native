import type { BlockType } from '../types'
import { AlignLeft, Heading3, Heading4, Info, Code2, List, Table } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface AddBlockRowProps {
  onAdd: (type: BlockType) => void
}

const BLOCK_BUTTONS: { type: BlockType; icon: LucideIcon; label: string }[] = [
  { type: 'p',       icon: AlignLeft, label: 'Paragraph' },
  { type: 'h3',      icon: Heading3,  label: 'Heading 3' },
  { type: 'h4',      icon: Heading4,  label: 'Heading 4' },
  { type: 'callout', icon: Info,      label: 'Callout'   },
  { type: 'code',    icon: Code2,     label: 'Code block'},
  { type: 'list',    icon: List,      label: 'List'      },
  { type: 'table',   icon: Table,     label: 'Table'     },
]

export function AddBlockRow({ onAdd }: AddBlockRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-2.5 mt-1.5 border-t border-border/50">
      <span className="font-mono text-xs uppercase tracking-wider text-muted/50 mr-1">add</span>
      {BLOCK_BUTTONS.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          onClick={() => onAdd(type)}
          title={label}
          className="p-1.5 rounded-lg border border-border/60 bg-bg text-muted hover:text-accent hover:border-accent/50 hover:bg-accent/5 transition-colors cursor-pointer"
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
