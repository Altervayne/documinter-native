import type { Language, TokenRule } from '../types'

// ###########################################################
// # MARKDOWN LANGUAGE, RULES FOR THE MARKDOWN EDITOR PANEL #
// ###########################################################
//
// These rules are also imported and extended by mintdown.ts.
// Export `markdownRules` as a separate constant so mintdown.ts can spread it
// without duplicating any pattern.
//
// Priority order: earlier rules win over later ones.
// All patterns have the `y` (sticky) flag added automatically by the tokenizer.
// Patterns with the `m` flag use `^` to match only at the start of a line.

// #############
// # RULE LIST #
// #############

export const markdownRules: TokenRule[] = [

   // ==========================================================
   //  Block-level rules (m flag, ^ only matches at line start)
   // ==========================================================

   // YAML front matter block.
   // Requires key: value lines (no blank lines) between the --- fences,
   // distinguishing it from two plain HR lines separated by content.
   { type: 'fm',   pattern: /^---\n(?:\w+: [^\n]*\n)+---(?:\n|$)/m },

   // Fenced code block, entire block including fence lines and language tag.
   // \n before closing ``` anchors the fence to its own line without a second
   // internal ^ anchor (avoids sticky + multiline ^ ambiguity).
   { type: 'code', pattern: /^```\w*\n[\s\S]*?\n```(?:\n|$)/m },

   // Headings, all ATX levels (# through ######), whole line.
   { type: 'kw',   pattern: /^#{1,6} .+/m },

   // HTML comments, block or inline, possibly multi-line.
   { type: 'cmt',  pattern: /<!--[\s\S]*?-->/ },

   // GFM alert callout type tag: [!NOTE], [!WARNING], [!TIP], [!CAUTION], [!IMPORTANT].
   // Matches the tag and the optional trailing space.
   { type: 'type', pattern: /\[!(?:NOTE|WARNING|TIP|CAUTION|IMPORTANT)\] ?/ },

   // Blockquote prefix > (with optional space).
   { type: 'op',   pattern: /^> ?/m },

   // Standalone --- line, HR or front-matter delimiter.
   // The front-matter rule above is higher priority, so front-matter --- lines
   // are already consumed before this rule is reached.
   { type: 'op',   pattern: /^---$/m },

   // Ordered list numbers: 1.  2.  etc. (with optional leading whitespace).
   { type: 'num',  pattern: /^\s*\d+\. /m },

   // Unordered list bullets: -  *  +  (with optional leading whitespace).
   { type: 'op',   pattern: /^\s*[-*+] /m },

   // Table pipes, matches each | individually in data rows and separator rows.
   { type: 'op',   pattern: /\|/ },

   // ================================================
   //  Inline rules (no ^, match anywhere in the text)
   // ================================================

   // Image  ![alt](url), must come before the link rule.
   { type: 'fn',   pattern: /!\[[^\]]*\]\([^)]*\)/ },

   // Link  [label](url) or [label](#anchor).
   { type: 'fn',   pattern: /\[[^\]]*\]\([^)]*\)/ },

   // Inline code  `code`  (single-backtick, no newlines).
   { type: 'str',  pattern: /`[^`\n]+`/ },

   // Bold  **text**, must come before the italic rule to consume ** first.
   { type: 'bold', pattern: /\*\*[^*\n]+\*\*/ },

   // Bold/underline  __text__, must come before the _italic_ rule.
   { type: 'bold', pattern: /__[^_\n]+__/ },

   // Italic  *text*  (single asterisk; ** already consumed above).
   { type: 'em',   pattern: /\*[^*\n]+\*/ },

   // Strikethrough  ~~text~~.
   { type: 'del',  pattern: /~~[^~\n]+~~/ },
]

// ###################
// # LANGUAGE EXPORT #
// ###################

export const markdown: Language = {
   name: 'markdown',
   rules: markdownRules,
}
