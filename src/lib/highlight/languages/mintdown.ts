import type { Language, TokenRule } from '../types'
import { markdownRules } from './markdown'

// ######################################################################
// # MINTDOWN LANGUAGE — EXTENDS MARKDOWN WITH DOCUMINT-SPECIFIC SYNTAX #
// ######################################################################
//
// No Markdown rule is duplicated here. markdownRules is imported and spread
// between the Mintdown block rules (prepended) and inline rules (appended).
//
// Layout of the combined rules array:
//   [ ...mintdownBlockRules, ...markdownRules, ...mintdownInlineRules ]
//
// Prepended block rules (require m flag — ^ only matches at line start):
//   A — container opening line   {ratio  or  {shorthand:  or  {: at line start
//   B — container closing line   }  alone on its own line
//   C — anchor declaration       ^handle  at line start
//
// Appended inline rules (match anywhere):
//   D — Mintdown callout type tags  [info], [warning], [valid], [danger]  + shorthands
//   E — inline color/highlight opener  {color:#hex}  {highlight:#hex}
//   F — inline color/highlight closer  {/color}  {/highlight}
//
// Notes on ordering:
// - A/B/C are prepended so they have priority over any Markdown rule that might
//   partially match { or ^ characters.
// - D is appended after markdownRules. The Markdown link rule /\[[^\]]*\]\([^)]*\)/
//   requires ](url) and will NOT match bare [info] tags, so no conflict.
// - E/F target {color:...} braces; no Markdown rule matches bare { characters,
//   so appending these rules is safe.

// ####################################
// # MINTDOWN BLOCK RULES (PREPENDED) #
// ####################################

const mintdownBlockRules: TokenRule[] = [

   // A — Container opening line.
   // Matches {-3, {60|40:, {2: left | right}, {: etc.
   // \}? at the end captures the closing } for single-line containers ({2: l | r}).
   // Multi-line opening lines ({-3\n) also match because \}? is optional.
   { type: 'op',  pattern: /^\{[^}\n]*\}?$/m },

   // B — Container closing line — lone } on its own line (multi-line containers).
   { type: 'op',  pattern: /^\}$/m },

   // C — Anchor declaration — ^handle at start of line.
   // handle is a URL-safe slug: lowercase letters, digits, hyphens.
   { type: 'kw',  pattern: /^\^[\w-]+/m },
]

// ####################################
// # MINTDOWN INLINE RULES (APPENDED) #
// ####################################

const mintdownInlineRules: TokenRule[] = [

   // D — Mintdown callout type tag.
   // Full words: info, warning, valid, danger.
   // Shorthands: i, w, v, d.
   // Matches the bracketed tag and the optional trailing space.
   { type: 'type', pattern: /\[(?:info|warning|valid|danger|i|w|v|d)\] ?/ },

   // E — Inline color/highlight opener: {color:#rrggbb}  {highlight:#rrggbb}.
   // Hex values: 3, 6, or 8 hex digits.
   { type: 'str',  pattern: /\{(?:color|highlight):#[0-9a-fA-F]{3,8}\}/ },

   // F — Inline color/highlight closer: {/color}  {/highlight}.
   { type: 'op',   pattern: /\{\/(?:color|highlight)\}/ },
]

// ###################
// # LANGUAGE EXPORT #
// ###################

export const mintdown: Language = {
   name: 'mintdown',
   rules: [
      ...mintdownBlockRules,
      ...markdownRules,
      ...mintdownInlineRules,
   ],
}
