import type { BlockType } from '../types'
import { AlignLeft, Heading3, Heading4, Info, Code2, List, Table } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLang } from '../lib/LangContext'

interface AddBlockRowProps {
  onAdd: (type: BlockType) => void
}

const BLOCK_ICONS: { type: BlockType; icon: LucideIcon }[] = [
  { type: 'p',       icon: AlignLeft },
  { type: 'h3',      icon: Heading3  },
  { type: 'h4',      icon: Heading4  },
  { type: 'callout', icon: Info      },
  { type: 'code',    icon: Code2     },
  { type: 'list',    icon: List      },
  { type: 'table',   icon: Table     },
]

export function AddBlockRow({ onAdd }: AddBlockRowProps) {
  const { t } = useLang()
  const labels: Record<BlockType, string> = {
    p: t.blockParagraph, h3: t.blockH3, h4: t.blockH4,
    callout: t.blockCallout, code: t.blockCode, list: t.blockList, table: t.blockTable,
  }
  return (
    <div className="flex flex-wrap items-center gap-1 pt-2.5 mt-1.5 border-t border-border/50">
      <span className="font-mono text-xs uppercase tracking-wider text-muted/50 mr-1">{t.add}</span>
      {BLOCK_ICONS.map(({ type, icon: Icon }) => (
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
