import type { Language, TokenRule } from '../types'

// ###########################################################
// # MARKDOWN LANGUAGE, RULES FOR THE MARKDOWN EDITOR PANEL #
// ###########################################################
//
// Priority order: earlier rules win. The tokenizer adds the sticky flag; an `m` pattern's `^`
// matches only at a line start.

// #############
// # RULE LIST #
// #############

export const markdownRules: TokenRule[] = [

   // ==========================================================
   //  Block-level rules
   // ==========================================================

   // YAML front matter: key: value lines between --- fences, which distinguishes it from two HR lines.
   { type: 'fm',   pattern: /^---\n(?:\w+: [^\n]*\n)+---(?:\n|$)/m },

   // Fenced code block. The \n before the closing fence anchors it to its own line (a second ^ would
   // clash with the sticky + multiline flags).
   { type: 'code', pattern: /^```\w*\n[\s\S]*?\n```(?:\n|$)/m },

   { type: 'kw',   pattern: /^#{1,6} .+/m },
   { type: 'cmt',  pattern: /<!--[\s\S]*?-->/ },
   { type: 'type', pattern: /\[!(?:NOTE|WARNING|TIP|CAUTION|IMPORTANT)\] ?/ },
   { type: 'op',   pattern: /^> ?/m },

   // Standalone --- (HR). Front-matter fences are consumed by the higher-priority rule above.
   { type: 'op',   pattern: /^---$/m },

   { type: 'num',  pattern: /^\s*\d+\. /m },
   { type: 'op',   pattern: /^\s*[-*+] /m },
   { type: 'op',   pattern: /\|/ },

   // ================================================
   //  Inline rules
   // ================================================

   // Image, before the link rule.
   { type: 'fn',   pattern: /!\[[^\]]*\]\([^)]*\)/ },

   { type: 'fn',   pattern: /\[[^\]]*\]\([^)]*\)/ },
   { type: 'str',  pattern: /`[^`\n]+`/ },

   // Bold, before italic so ** is consumed first.
   { type: 'bold', pattern: /\*\*[^*\n]+\*\*/ },
   { type: 'bold', pattern: /__[^_\n]+__/ },

   // Italic; ** already consumed above.
   { type: 'em',   pattern: /\*[^*\n]+\*/ },

   { type: 'del',  pattern: /~~[^~\n]+~~/ },
]

// ###################
// # LANGUAGE EXPORT #
// ###################

export const markdown: Language = {
   name: 'markdown',
   rules: markdownRules,
}
