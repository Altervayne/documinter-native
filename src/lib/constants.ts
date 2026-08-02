// -- Library Imports --
import { AlignLeft, Heading3, Heading4, Info, Code2, Sigma, BarChart3, List, ListChecks, Table, Image, Columns2, SeparatorHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// -- Type Imports --
import type { BlockType } from '../types'
import type { T } from './i18n'

export const ACCENT_PRESETS: string[] = [
   '#f97316', '#2563eb', '#16a34a', '#7c3aed', '#e11d48', '#0891b2', '#2dcea8',
]

// ==========================================================
//  Accent preset friendly names
// ==========================================================
// The document background context menu's accent rows show a human name (this lookup) rather
// than the raw hex, the color swatch icon still conveys the exact value. Keyed by hex so a
// caller can resolve a name for any ACCENT_PRESETS entry without relying on array position.
export const ACCENT_PRESET_NAME_KEYS: Record<string, keyof T> = {
   '#f97316': 'accentNameOrange',
   '#2563eb': 'accentNameBlue',
   '#16a34a': 'accentNameGreen',
   '#7c3aed': 'accentNameViolet',
   '#e11d48': 'accentNameRose',
   '#0891b2': 'accentNameCyan',
   '#2dcea8': 'accentNameTeal',
}

/** Resolves an ACCENT_PRESETS hex to its localized friendly name, falling back to the raw hex
 *  for any color with no entry in ACCENT_PRESET_NAME_KEYS (defensive, every current preset has
 *  one, but a future preset added without a name shouldn't render a blank label). */
export function accentPresetName(hex: string, t: T): string {
   const nameKey = ACCENT_PRESET_NAME_KEYS[hex]
   return nameKey ? t[nameKey] : hex
}

/** Curated font-color palette, base/light pairs across the hue wheel plus neutrals. */
export const FONT_COLOR_PALETTE = [
   '#111111', // Black
   '#6b6b6b', // Dark Gray
   '#b83232', // Red
   '#1a5fa8', // Blue
   '#c47a00', // Amber
   '#1a7a4a', // Green
   '#7b3db8', // Purple
   '#b8365a', // Pink
   '#1a8c8c', // Teal

   '#ffffff', // White
   '#d0d0d0', // Light Gray
   '#e07a7a', // Light Red
   '#5ba3e0', // Light Blue
   '#f0b84a', // Light Amber
   '#5dbf8a', // Light Green
   '#b885e8', // Light Purple
   '#e882a4', // Light Pink
   '#62c4c4', // Light Teal
] as const

/** Curated highlight-color palette, soft pastels that keep dark text legible on the swatch. */
export const HIGHLIGHT_COLOR_PALETTE = [
   '#fff9c4', // Yellow
   '#ffe0b2', // Peach
   '#ffcdd2', // Rose
   '#f8bbd9', // Pink
   '#e8d5f5', // Lavender
   '#d4e4f7', // Sky
   '#c8edf5', // Ice
   '#c8f0e4', // Mint
   '#d8f0c4', // Sage
   '#fff0c4', // Cream
   '#ffe4c4', // Apricot
   '#ffd6d6', // Blush
   '#edd5f0', // Lilac
   '#d5e8ff', // Periwinkle
   '#d5f0f0', // Aqua
   '#e8f5d5', // Lime
   '#f5e8d5', // Sand
   '#e8e8e8', // Mist
] as const

export const BLOCK_ICONS: { type: BlockType; icon: LucideIcon }[] = [
   { type: 'p',         icon: AlignLeft },
   { type: 'h3',        icon: Heading3  },
   { type: 'h4',        icon: Heading4  },
   { type: 'callout',   icon: Info      },
   { type: 'code',      icon: Code2     },
   { type: 'math',      icon: Sigma     },
   { type: 'graph',     icon: BarChart3 },
   { type: 'list',      icon: List      },
   { type: 'checklist', icon: ListChecks },
   { type: 'table',     icon: Table     },
   { type: 'image',     icon: Image     },
   { type: 'container', icon: Columns2            },
   { type: 'hr',        icon: SeparatorHorizontal },
]

/** Keyed by BlockType, useful for O(1) icon lookups. */
export const BLOCK_ICONS_MAP: Record<BlockType, LucideIcon> = Object.fromEntries(
   BLOCK_ICONS.map(blockIcon => [blockIcon.type, blockIcon.icon])
) as Record<BlockType, LucideIcon>
