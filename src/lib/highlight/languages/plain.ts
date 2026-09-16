import type { Language } from '../types'

// Pass-through: no rules, so tokenize() just HTML-escapes every character.
export const plain: Language = {
   name: 'plain',
   rules: [],
}
