import type { Block } from '../types'

export function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  p:       '¶',
  h3:      'H3',
  h4:      'H4',
  callout: '!',
  code:    '<>',
  list:    '•',
  table:   '⊞',
}

export function blkPreview(b: Block): string {
  if (b.type === 'p' || b.type === 'h3' || b.type === 'h4')
    return (b.text ?? '').substring(0, 32)
  if (b.type === 'callout')
    return `[${b.style}] ${(b.text ?? '').substring(0, 20)}`
  if (b.type === 'code')
    return (b.code ?? '').substring(0, 32)
  if (b.type === 'list')
    return ((b.items ?? [''])[0] ?? '').substring(0, 32)
  if (b.type === 'table')
    return `${(b.headers ?? []).length} col × ${(b.rows ?? []).length} rows`
  return ''
}
