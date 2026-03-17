import type { Language } from '../types'

// No highlighting — used as a pass-through.
// The tokenize() engine will escape HTML entities for any unmatched char.
export const plain: Language = {
  name: 'plain',
  rules: [],
}
