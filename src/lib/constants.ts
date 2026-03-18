// -- Library Imports --
import { AlignLeft, Heading3, Heading4, Info, Code2, List, Table, Image, Columns2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// -- Type Imports --
import type { BlockType } from '../types'

export const ACCENT_PRESETS: string[] = [
   '#f97316', '#2563eb', '#16a34a', '#7c3aed', '#e11d48', '#0891b2', '#2dcea8',
]

export const BLOCK_ICONS: { type: BlockType; icon: LucideIcon }[] = [
   { type: 'p',         icon: AlignLeft },
   { type: 'h3',        icon: Heading3  },
   { type: 'h4',        icon: Heading4  },
   { type: 'callout',   icon: Info      },
   { type: 'code',      icon: Code2     },
   { type: 'list',      icon: List      },
   { type: 'table',     icon: Table     },
   { type: 'image',     icon: Image     },
   { type: 'container', icon: Columns2  },
]

/** Keyed by BlockType — useful for O(1) icon lookups. */
export const BLOCK_ICONS_MAP: Record<BlockType, LucideIcon> = Object.fromEntries(
   BLOCK_ICONS.map(b => [b.type, b.icon])
) as Record<BlockType, LucideIcon>
