/**
 * mathSymbols.ts, the assisted-input catalog for the math block's symbol palette.
 *
 * PURE DATA, side-effect free. This module deliberately imports NOTHING that loads
 * Temml (lib/math.ts kicks off the raw-asset load on import) or lucide (lib/constants.ts):
 * the palette component renders the glyphs by feeding each entry's `latex` to the
 * renderer itself. Keeping the catalog import-clean means the serializers and any test
 * can pull it in without dragging in the Temml load or an icon bundle.
 *
 * The palette is PURE UI over the existing `latex` field of a math block. It makes NO
 * model or serialization change: inserting a snippet only edits the LaTeX source text,
 * exactly as if the user had typed it. The ```math fence is untouched.
 *
 * Every display `latex` in this catalog renders cleanly through Temml's `renderToString`
 * with `throwOnError` set, so a button never shows broken markup.
 */

// #############
// # CONSTANTS #
// #############

/**
 * Caret sentinel. A single Private-Use-Area character marks, inside an entry's `insert`
 * string, where the caret should land after the snippet is dropped into the source. It is
 * never a character a user would type, so it can be located and stripped unambiguously.
 * When a non-empty selection is active at insert time the selected text is placed at this
 * marker (wrap-selection behaviour); otherwise the caret simply lands there.
 */
export const MATH_CARET_MARKER = ''

// #########
// # TYPES #
// #########

/** The ordered category keys; each maps to an i18n label in the palette component. */
export type MathSymbolCategoryKey =
   | 'greek'
   | 'operators'
   | 'relations'
   | 'negatedRelations'
   | 'arrows'
   | 'bigOperators'
   | 'fractionsRoots'
   | 'accents'
   | 'matrices'
   | 'fonts'
   | 'symbolsMisc'

/** One palette entry. */
export interface MathSymbolEntry {
   /** Human label, used for the tooltip / aria-label and matched by the filter. */
   name:   string
   /**
    * The LaTeX rendered onto the button so it is scannable by sight. Always renderable
    * (never contains the caret marker), a clean glyph or a small representative template.
    */
   latex:  string
   /**
    * The string injected into the source. Often identical to `latex`; templated entries
    * differ by carrying a single MATH_CARET_MARKER placeholder (and empty argument slots).
    */
   insert: string
}

/** One ordered category: a key (for its i18n label) plus its entries. */
export interface MathSymbolCategory {
   key:     MathSymbolCategoryKey
   entries: MathSymbolEntry[]
}

/** The result of resolving an `insert` string against the current selection. */
export interface SnippetInsertion {
   /** The literal text to splice into the source (marker stripped, selection placed). */
   text:        string
   /** Where the caret should sit afterwards, as an offset into `text`. */
   caretOffset: number
}

// ###########
// # CATALOG #
// ###########

// A short local alias keeps the templated `insert` strings below readable.
const CARET = MATH_CARET_MARKER

export const MATH_SYMBOL_CATEGORIES: MathSymbolCategory[] = [
   // =======
   //  Greek
   // =======
   {
      key: 'greek',
      entries: [
         // Lowercase
         { name: 'alpha',   latex: '\\alpha',   insert: '\\alpha'   },
         { name: 'beta',    latex: '\\beta',    insert: '\\beta'    },
         { name: 'gamma',   latex: '\\gamma',   insert: '\\gamma'   },
         { name: 'delta',   latex: '\\delta',   insert: '\\delta'   },
         { name: 'epsilon', latex: '\\epsilon', insert: '\\epsilon' },
         { name: 'zeta',    latex: '\\zeta',    insert: '\\zeta'    },
         { name: 'eta',     latex: '\\eta',     insert: '\\eta'     },
         { name: 'theta',   latex: '\\theta',   insert: '\\theta'   },
         { name: 'iota',    latex: '\\iota',    insert: '\\iota'    },
         { name: 'kappa',   latex: '\\kappa',   insert: '\\kappa'   },
         { name: 'lambda',  latex: '\\lambda',  insert: '\\lambda'  },
         { name: 'mu',      latex: '\\mu',      insert: '\\mu'      },
         { name: 'nu',      latex: '\\nu',      insert: '\\nu'      },
         { name: 'xi',      latex: '\\xi',      insert: '\\xi'      },
         { name: 'omicron', latex: '\\omicron', insert: '\\omicron' },
         { name: 'pi',      latex: '\\pi',      insert: '\\pi'      },
         { name: 'rho',     latex: '\\rho',     insert: '\\rho'     },
         { name: 'sigma',   latex: '\\sigma',   insert: '\\sigma'   },
         { name: 'tau',     latex: '\\tau',     insert: '\\tau'     },
         { name: 'upsilon', latex: '\\upsilon', insert: '\\upsilon' },
         { name: 'phi',     latex: '\\phi',     insert: '\\phi'     },
         { name: 'chi',     latex: '\\chi',     insert: '\\chi'     },
         { name: 'psi',     latex: '\\psi',     insert: '\\psi'     },
         { name: 'omega',   latex: '\\omega',   insert: '\\omega'   },
         // Variant lowercase forms
         { name: 'varepsilon (variant)', latex: '\\varepsilon', insert: '\\varepsilon' },
         { name: 'vartheta (variant)',   latex: '\\vartheta',   insert: '\\vartheta'   },
         { name: 'varpi (variant)',      latex: '\\varpi',      insert: '\\varpi'      },
         { name: 'varrho (variant)',     latex: '\\varrho',     insert: '\\varrho'     },
         { name: 'varsigma (variant)',   latex: '\\varsigma',   insert: '\\varsigma'   },
         { name: 'varphi (variant)',     latex: '\\varphi',     insert: '\\varphi'     },
         // Uppercase (non-Latin forms only)
         { name: 'Gamma (uppercase)',   latex: '\\Gamma',   insert: '\\Gamma'   },
         { name: 'Delta (uppercase)',   latex: '\\Delta',   insert: '\\Delta'   },
         { name: 'Theta (uppercase)',   latex: '\\Theta',   insert: '\\Theta'   },
         { name: 'Lambda (uppercase)',  latex: '\\Lambda',  insert: '\\Lambda'  },
         { name: 'Xi (uppercase)',      latex: '\\Xi',      insert: '\\Xi'      },
         { name: 'Pi (uppercase)',      latex: '\\Pi',      insert: '\\Pi'      },
         { name: 'Sigma (uppercase)',   latex: '\\Sigma',   insert: '\\Sigma'   },
         { name: 'Phi (uppercase)',     latex: '\\Phi',     insert: '\\Phi'     },
         { name: 'Psi (uppercase)',     latex: '\\Psi',     insert: '\\Psi'     },
         { name: 'Omega (uppercase)',   latex: '\\Omega',   insert: '\\Omega'   },
         { name: 'Upsilon (uppercase)', latex: '\\Upsilon', insert: '\\Upsilon' },
      ],
   },

   // =================
   //  Binary operators
   // =================
   {
      key: 'operators',
      entries: [
         { name: 'times (multiply)',       latex: '\\times',   insert: '\\times'   },
         { name: 'divide',                 latex: '\\div',     insert: '\\div'     },
         { name: 'plus-minus',             latex: '\\pm',      insert: '\\pm'      },
         { name: 'minus-plus',             latex: '\\mp',      insert: '\\mp'      },
         { name: 'centered dot',           latex: '\\cdot',    insert: '\\cdot'    },
         { name: 'asterisk operator',      latex: '\\ast',     insert: '\\ast'     },
         { name: 'star operator',          latex: '\\star',    insert: '\\star'    },
         { name: 'composition (ring)',     latex: '\\circ',    insert: '\\circ'    },
         { name: 'bullet',                 latex: '\\bullet',  insert: '\\bullet'  },
         { name: 'direct sum',             latex: '\\oplus',   insert: '\\oplus'   },
         { name: 'circled minus',          latex: '\\ominus',  insert: '\\ominus'  },
         { name: 'tensor product',         latex: '\\otimes',  insert: '\\otimes'  },
         { name: 'circled slash',          latex: '\\oslash',  insert: '\\oslash'  },
         { name: 'circled dot',            latex: '\\odot',    insert: '\\odot'    },
         { name: 'dagger',                 latex: '\\dagger',  insert: '\\dagger'  },
         { name: 'double dagger',          latex: '\\ddagger', insert: '\\ddagger' },
         { name: 'amalgamation',           latex: '\\amalg',   insert: '\\amalg'   },
         { name: 'wreath product',         latex: '\\wr',      insert: '\\wr'      },
         { name: 'square cap',             latex: '\\sqcap',   insert: '\\sqcap'   },
         { name: 'square cup',             latex: '\\sqcup',   insert: '\\sqcup'   },
         { name: 'multiset union (uplus)', latex: '\\uplus',   insert: '\\uplus'   },
         { name: 'union',                  latex: '\\cup',     insert: '\\cup'     },
         { name: 'intersection',           latex: '\\cap',     insert: '\\cap'     },
         { name: 'logical or (vee)',       latex: '\\vee',     insert: '\\vee'     },
         { name: 'logical and (wedge)',    latex: '\\wedge',   insert: '\\wedge'   },
         { name: 'set minus',              latex: '\\setminus', insert: '\\setminus' },
         { name: 'boxed plus',             latex: '\\boxplus', insert: '\\boxplus' },
         { name: 'boxed times',            latex: '\\boxtimes', insert: '\\boxtimes' },
         { name: 'boxed dot',              latex: '\\boxdot',  insert: '\\boxdot'  },
         { name: 'left triangle',          latex: '\\triangleleft',  insert: '\\triangleleft'  },
         { name: 'right triangle',         latex: '\\triangleright', insert: '\\triangleright' },
         { name: 'up triangle',            latex: '\\bigtriangleup',   insert: '\\bigtriangleup'   },
         { name: 'down triangle',          latex: '\\bigtriangledown', insert: '\\bigtriangledown' },
      ],
   },

   // ===========
   //  Relations
   // ===========
   {
      key: 'relations',
      entries: [
         // Ordering
         { name: 'much less than',         latex: '\\ll',      insert: '\\ll'      },
         { name: 'much greater than',      latex: '\\gg',      insert: '\\gg'      },
         { name: 'less than or equal',     latex: '\\leq',     insert: '\\leq'     },
         { name: 'greater than or equal',  latex: '\\geq',     insert: '\\geq'     },
         { name: 'precedes',               latex: '\\prec',    insert: '\\prec'    },
         { name: 'succeeds',               latex: '\\succ',    insert: '\\succ'    },
         { name: 'precedes or equal',      latex: '\\preceq',  insert: '\\preceq'  },
         { name: 'succeeds or equal',      latex: '\\succeq',  insert: '\\succeq'  },
         { name: 'less than or similar',   latex: '\\lesssim', insert: '\\lesssim' },
         { name: 'greater than or similar', latex: '\\gtrsim', insert: '\\gtrsim'  },
         { name: 'less or greater',        latex: '\\lessgtr', insert: '\\lessgtr' },
         { name: 'greater or less',        latex: '\\gtrless', insert: '\\gtrless' },
         // Similarity and equality
         { name: 'similar to',             latex: '\\sim',     insert: '\\sim'     },
         { name: 'asymptotically equal',   latex: '\\simeq',   insert: '\\simeq'   },
         { name: 'congruent',              latex: '\\cong',    insert: '\\cong'    },
         { name: 'approximately equal',    latex: '\\approx',  insert: '\\approx'  },
         { name: 'asymptotic to',          latex: '\\asymp',   insert: '\\asymp'   },
         { name: 'equivalent (identical)', latex: '\\equiv',   insert: '\\equiv'   },
         { name: 'dot equal',              latex: '\\doteq',   insert: '\\doteq'   },
         { name: 'approximately equal to (approxeq)', latex: '\\approxeq', insert: '\\approxeq' },
         { name: 'defined as (triangle equal)', latex: '\\triangleq', insert: '\\triangleq' },
         { name: 'eqsim',                  latex: '\\eqsim',   insert: '\\eqsim'   },
         // Set and logic relations
         { name: 'element of',             latex: '\\in',        insert: '\\in'        },
         { name: 'contains as member',     latex: '\\ni',        insert: '\\ni'        },
         { name: 'subset of',              latex: '\\subset',    insert: '\\subset'    },
         { name: 'subset of or equal',     latex: '\\subseteq',  insert: '\\subseteq'  },
         { name: 'superset of',            latex: '\\supset',    insert: '\\supset'    },
         { name: 'superset of or equal',   latex: '\\supseteq',  insert: '\\supseteq'  },
         { name: 'square subset or equal', latex: '\\sqsubseteq', insert: '\\sqsubseteq' },
         { name: 'square superset or equal', latex: '\\sqsupseteq', insert: '\\sqsupseteq' },
         { name: 'parallel to',            latex: '\\parallel',  insert: '\\parallel'  },
         { name: 'perpendicular to',       latex: '\\perp',      insert: '\\perp'      },
         { name: 'divides (mid)',          latex: '\\mid',       insert: '\\mid'       },
         { name: 'proportional to',        latex: '\\propto',    insert: '\\propto'    },
         { name: 'models',                 latex: '\\models',    insert: '\\models'    },
         { name: 'proves (turnstile)',     latex: '\\vdash',     insert: '\\vdash'     },
         { name: 'reverse turnstile',      latex: '\\dashv',     insert: '\\dashv'     },
      ],
   },

   // ===================
   //  Negated relations
   // ===================
   {
      key: 'negatedRelations',
      entries: [
         { name: 'not equal',              latex: '\\neq',       insert: '\\neq'       },
         { name: 'not less than',          latex: '\\nless',     insert: '\\nless'     },
         { name: 'not greater than',       latex: '\\ngtr',      insert: '\\ngtr'      },
         { name: 'not less than or equal', latex: '\\nleq',      insert: '\\nleq'      },
         { name: 'not greater than or equal', latex: '\\ngeq',   insert: '\\ngeq'      },
         { name: 'not similar to',         latex: '\\nsim',      insert: '\\nsim'      },
         { name: 'not congruent',          latex: '\\ncong',     insert: '\\ncong'     },
         { name: 'not a subset of or equal', latex: '\\nsubseteq', insert: '\\nsubseteq' },
         { name: 'not a superset of or equal', latex: '\\nsupseteq', insert: '\\nsupseteq' },
         { name: 'not parallel to',        latex: '\\nparallel', insert: '\\nparallel' },
         { name: 'does not divide',        latex: '\\nmid',      insert: '\\nmid'      },
         { name: 'not an element of',      latex: '\\notin',     insert: '\\notin'     },
      ],
   },

   // ========
   //  Arrows
   // ========
   {
      key: 'arrows',
      entries: [
         { name: 'right arrow (to)',       latex: '\\to',                 insert: '\\to'                 },
         { name: 'left arrow (gets)',      latex: '\\gets',               insert: '\\gets'               },
         { name: 'left-right arrow',       latex: '\\leftrightarrow',     insert: '\\leftrightarrow'     },
         { name: 'implies (right double)', latex: '\\Rightarrow',         insert: '\\Rightarrow'         },
         { name: 'implied by (left double)', latex: '\\Leftarrow',        insert: '\\Leftarrow'          },
         { name: 'if and only if',         latex: '\\Leftrightarrow',     insert: '\\Leftrightarrow'     },
         { name: 'maps to',                latex: '\\mapsto',             insert: '\\mapsto'             },
         { name: 'long right arrow',       latex: '\\longrightarrow',     insert: '\\longrightarrow'     },
         { name: 'long left arrow',        latex: '\\longleftarrow',      insert: '\\longleftarrow'      },
         { name: 'long left-right arrow',  latex: '\\longleftrightarrow', insert: '\\longleftrightarrow' },
         { name: 'long implies',           latex: '\\Longrightarrow',     insert: '\\Longrightarrow'     },
         { name: 'hooked right arrow',     latex: '\\hookrightarrow',     insert: '\\hookrightarrow'     },
         { name: 'hooked left arrow',      latex: '\\hookleftarrow',      insert: '\\hookleftarrow'      },
         { name: 'right harpoon up',       latex: '\\rightharpoonup',     insert: '\\rightharpoonup'     },
         { name: 'left harpoon down',      latex: '\\leftharpoondown',    insert: '\\leftharpoondown'    },
         { name: 'northeast arrow',        latex: '\\nearrow',            insert: '\\nearrow'            },
         { name: 'southeast arrow',        latex: '\\searrow',            insert: '\\searrow'            },
         { name: 'southwest arrow',        latex: '\\swarrow',            insert: '\\swarrow'            },
         { name: 'northwest arrow',        latex: '\\nwarrow',            insert: '\\nwarrow'            },
         { name: 'up arrow',               latex: '\\uparrow',            insert: '\\uparrow'            },
         { name: 'down arrow',             latex: '\\downarrow',          insert: '\\downarrow'          },
         { name: 'up-down arrow',          latex: '\\updownarrow',        insert: '\\updownarrow'        },
         { name: 'rightwards paired arrows', latex: '\\rightrightarrows', insert: '\\rightrightarrows'   },
         { name: 'leftwards paired arrows',  latex: '\\leftleftarrows',   insert: '\\leftleftarrows'     },
         { name: 'right-left harpoons',    latex: '\\rightleftharpoons',  insert: '\\rightleftharpoons'  },
      ],
   },

   // ===============
   //  Big operators
   // ===============
   // Clean glyph on the button, bound placeholders in the insert.
   {
      key: 'bigOperators',
      entries: [
         { name: 'integral',             latex: '\\int',      insert: `\\int_{${CARET}}^{}`      },
         { name: 'double integral',      latex: '\\iint',     insert: `\\iint_{${CARET}}`        },
         { name: 'triple integral',      latex: '\\iiint',    insert: `\\iiint_{${CARET}}`       },
         { name: 'contour integral',     latex: '\\oint',     insert: `\\oint_{${CARET}}`        },
         { name: 'closed surface integral', latex: '\\oiint', insert: `\\oiint_{${CARET}}`       },
         { name: 'closed volume integral',  latex: '\\oiiint', insert: `\\oiiint_{${CARET}}`     },
         { name: 'summation',            latex: '\\sum',      insert: `\\sum_{${CARET}}^{}`      },
         { name: 'product',              latex: '\\prod',     insert: `\\prod_{${CARET}}^{}`     },
         { name: 'coproduct',            latex: '\\coprod',   insert: `\\coprod_{${CARET}}^{}`   },
         { name: 'big union',            latex: '\\bigcup',   insert: `\\bigcup_{${CARET}}^{}`   },
         { name: 'big intersection',     latex: '\\bigcap',   insert: `\\bigcap_{${CARET}}^{}`   },
         { name: 'big square cup',       latex: '\\bigsqcup', insert: `\\bigsqcup_{${CARET}}^{}` },
         { name: 'big direct sum',       latex: '\\bigoplus', insert: `\\bigoplus_{${CARET}}^{}` },
         { name: 'big tensor product',   latex: '\\bigotimes', insert: `\\bigotimes_{${CARET}}^{}` },
         { name: 'big circled dot',      latex: '\\bigodot',  insert: `\\bigodot_{${CARET}}^{}`  },
         { name: 'big vee (or)',         latex: '\\bigvee',   insert: `\\bigvee_{${CARET}}^{}`   },
         { name: 'big wedge (and)',      latex: '\\bigwedge', insert: `\\bigwedge_{${CARET}}^{}` },
         { name: 'big multiset union',   latex: '\\biguplus', insert: `\\biguplus_{${CARET}}^{}` },
      ],
   },

   // ==============================
   //  Fractions, roots and scripts
   // ==============================
   {
      key: 'fractionsRoots',
      entries: [
         { name: 'fraction',            latex: '\\frac{a}{b}',  insert: `\\frac{${CARET}}{}`  },
         { name: 'display fraction',    latex: '\\dfrac{a}{b}', insert: `\\dfrac{${CARET}}{}` },
         { name: 'text fraction',       latex: '\\tfrac{a}{b}', insert: `\\tfrac{${CARET}}{}` },
         { name: 'continued fraction',  latex: '\\cfrac{a}{b}', insert: `\\cfrac{${CARET}}{}` },
         { name: 'binomial coefficient', latex: '\\binom{n}{k}', insert: `\\binom{${CARET}}{}` },
         { name: 'square root',         latex: '\\sqrt{x}',     insert: `\\sqrt{${CARET}}`    },
         { name: 'nth root',            latex: '\\sqrt[n]{x}',  insert: `\\sqrt[n]{${CARET}}` },
         { name: 'superscript',         latex: 'x^{n}',         insert: `x^{${CARET}}`        },
         { name: 'subscript',           latex: 'x_{i}',         insert: `x_{${CARET}}`        },
         { name: 'subscript and superscript', latex: 'x_{i}^{n}', insert: `x_{${CARET}}^{}`  },
      ],
   },

   // =========================
   //  Accents and decorations
   // =========================
   {
      key: 'accents',
      entries: [
         // Wide over/under decorations
         { name: 'over right arrow',    latex: '\\overrightarrow{ab}',     insert: `\\overrightarrow{${CARET}}`     },
         { name: 'under right arrow',   latex: '\\underrightarrow{ab}',    insert: `\\underrightarrow{${CARET}}`    },
         { name: 'over left arrow',     latex: '\\overleftarrow{ab}',      insert: `\\overleftarrow{${CARET}}`      },
         { name: 'under left arrow',    latex: '\\underleftarrow{ab}',     insert: `\\underleftarrow{${CARET}}`     },
         { name: 'over left-right arrow', latex: '\\overleftrightarrow{ab}', insert: `\\overleftrightarrow{${CARET}}` },
         { name: 'wide hat',            latex: '\\widehat{ab}',            insert: `\\widehat{${CARET}}`            },
         { name: 'wide tilde',          latex: '\\widetilde{ab}',          insert: `\\widetilde{${CARET}}`          },
         { name: 'overline',            latex: '\\overline{ab}',           insert: `\\overline{${CARET}}`           },
         { name: 'underline',           latex: '\\underline{ab}',          insert: `\\underline{${CARET}}`          },
         { name: 'overbrace',           latex: '\\overbrace{abc}',         insert: `\\overbrace{${CARET}}`          },
         { name: 'underbrace',          latex: '\\underbrace{abc}',        insert: `\\underbrace{${CARET}}`         },
         { name: 'set above (overset)', latex: '\\overset{a}{b}',          insert: `\\overset{${CARET}}{}`          },
         { name: 'set below (underset)', latex: '\\underset{a}{b}',        insert: `\\underset{${CARET}}{}`         },
         { name: 'stack relation (stackrel)', latex: '\\stackrel{a}{=}',   insert: `\\stackrel{${CARET}}{}`         },
         // Simple accents
         { name: 'hat',                 latex: '\\hat{a}',      insert: `\\hat{${CARET}}`      },
         { name: 'bar',                 latex: '\\bar{a}',      insert: `\\bar{${CARET}}`      },
         { name: 'vector',              latex: '\\vec{a}',      insert: `\\vec{${CARET}}`      },
         { name: 'dot',                 latex: '\\dot{a}',      insert: `\\dot{${CARET}}`      },
         { name: 'double dot',          latex: '\\ddot{a}',     insert: `\\ddot{${CARET}}`     },
         { name: 'tilde',               latex: '\\tilde{a}',    insert: `\\tilde{${CARET}}`    },
         { name: 'acute accent',        latex: '\\acute{a}',    insert: `\\acute{${CARET}}`    },
         { name: 'grave accent',        latex: '\\grave{a}',    insert: `\\grave{${CARET}}`    },
         { name: 'check (caron)',       latex: '\\check{a}',    insert: `\\check{${CARET}}`    },
         { name: 'breve',               latex: '\\breve{a}',    insert: `\\breve{${CARET}}`    },
         { name: 'ring accent',         latex: '\\mathring{a}', insert: `\\mathring{${CARET}}` },
      ],
   },

   // ===================================
   //  Matrices, delimiters and cases
   // ===================================
   {
      key: 'matrices',
      entries: [
         {
            name:   'parenthesis matrix',
            // Compact glyph (smallmatrix) for the button; the insert is a full pmatrix template.
            latex:  '\\left(\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right)',
            insert: `\\begin{pmatrix} ${CARET} & \\\\ & \\end{pmatrix}`,
         },
         {
            name:   'bracket matrix',
            latex:  '\\left[\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right]',
            insert: `\\begin{bmatrix} ${CARET} & \\\\ & \\end{bmatrix}`,
         },
         {
            name:   'brace matrix',
            latex:  '\\left\\{\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right\\}',
            insert: `\\begin{Bmatrix} ${CARET} & \\\\ & \\end{Bmatrix}`,
         },
         {
            name:   'determinant matrix (single bars)',
            latex:  '\\left|\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right|',
            insert: `\\begin{vmatrix} ${CARET} & \\\\ & \\end{vmatrix}`,
         },
         {
            name:   'norm matrix (double bars)',
            latex:  '\\left\\|\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right\\|',
            insert: `\\begin{Vmatrix} ${CARET} & \\\\ & \\end{Vmatrix}`,
         },
         {
            name:   'plain matrix (no delimiters)',
            latex:  '\\begin{matrix} a & b \\\\ c & d \\end{matrix}',
            insert: `\\begin{matrix} ${CARET} & \\\\ & \\end{matrix}`,
         },
         {
            name:   'cases',
            latex:  '\\begin{cases} a \\\\ b \\end{cases}',
            insert: `\\begin{cases} ${CARET} & \\\\ & \\end{cases}`,
         },
         {
            name:   'aligned equations',
            latex:  '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
            insert: `\\begin{aligned} ${CARET} &= \\\\ &= \\end{aligned}`,
         },
         // Delimiter pairs
         { name: 'parentheses',     latex: '\\left( x \\right)',     insert: `\\left( ${CARET} \\right)`     },
         { name: 'square brackets', latex: '\\left[ x \\right]',     insert: `\\left[ ${CARET} \\right]`     },
         { name: 'curly braces',    latex: '\\left\\{ x \\right\\}',  insert: `\\left\\{ ${CARET} \\right\\}`  },
         { name: 'angle brackets',  latex: '\\langle x \\rangle',    insert: `\\langle ${CARET} \\rangle`    },
         { name: 'ceiling',         latex: '\\lceil x \\rceil',      insert: `\\lceil ${CARET} \\rceil`      },
         { name: 'floor',           latex: '\\lfloor x \\rfloor',    insert: `\\lfloor ${CARET} \\rfloor`    },
         { name: 'absolute value',  latex: '\\left| x \\right|',     insert: `\\left| ${CARET} \\right|`     },
         { name: 'norm (double bar)', latex: '\\left\\| x \\right\\|', insert: `\\left\\| ${CARET} \\right\\|` },
      ],
   },

   // =================
   //  Fonts and styles
   // =================
   // Templated style markers: a clean filled example on the button, an empty slot in the insert.
   {
      key: 'fonts',
      entries: [
         // Family samples show a 3-letter specimen (\mathbb{ABC}) so the button reveals the
         // typeface, not one arbitrary glyph; the insert stays an empty slot + caret marker.
         { name: 'blackboard bold',  latex: '\\mathbb{ABC}',      insert: `\\mathbb{${CARET}}`     },
         { name: 'roman (upright)',  latex: '\\mathrm{ABC}',      insert: `\\mathrm{${CARET}}`     },
         { name: 'calligraphic',     latex: '\\mathcal{ABC}',     insert: `\\mathcal{${CARET}}`    },
         { name: 'fraktur',          latex: '\\mathfrak{ABC}',    insert: `\\mathfrak{${CARET}}`   },
         { name: 'script',           latex: '\\mathscr{ABC}',     insert: `\\mathscr{${CARET}}`    },
         { name: 'bold',             latex: '\\mathbf{ABC}',      insert: `\\mathbf{${CARET}}`     },
         { name: 'sans-serif',       latex: '\\mathsf{ABC}',      insert: `\\mathsf{${CARET}}`     },
         { name: 'typewriter',       latex: '\\mathtt{ABC}',      insert: `\\mathtt{${CARET}}`     },
         { name: 'bold symbol',      latex: '\\boldsymbol{ABC}',  insert: `\\boldsymbol{${CARET}}` },
         { name: 'text (upright words)', latex: '\\text{abc}',    insert: `\\text{${CARET}}`       },
      ],
   },

   // ===================
   //  Symbols and misc.
   // ===================
   {
      key: 'symbolsMisc',
      entries: [
         { name: 'infinity',            latex: '\\infty',        insert: '\\infty'        },
         { name: 'partial derivative',  latex: '\\partial',      insert: '\\partial'      },
         { name: 'nabla (del)',         latex: '\\nabla',        insert: '\\nabla'        },
         { name: 'for all',             latex: '\\forall',       insert: '\\forall'       },
         { name: 'there exists',        latex: '\\exists',       insert: '\\exists'       },
         { name: 'there does not exist', latex: '\\nexists',     insert: '\\nexists'      },
         { name: 'logical not',         latex: '\\neg',          insert: '\\neg'          },
         { name: 'top (verum)',         latex: '\\top',          insert: '\\top'          },
         { name: 'bottom (falsum)',     latex: '\\bot',          insert: '\\bot'          },
         { name: 'empty set',           latex: '\\emptyset',     insert: '\\emptyset'     },
         { name: 'empty set (variant)', latex: '\\varnothing',   insert: '\\varnothing'   },
         { name: 'aleph',               latex: '\\aleph',        insert: '\\aleph'        },
         { name: 'reduced Planck constant', latex: '\\hbar',     insert: '\\hbar'         },
         { name: 'script small l',      latex: '\\ell',          insert: '\\ell'          },
         { name: 'real part',           latex: '\\Re',           insert: '\\Re'           },
         { name: 'imaginary part',      latex: '\\Im',           insert: '\\Im'           },
         { name: 'Weierstrass p',       latex: '\\wp',           insert: '\\wp'           },
         { name: 'angle',               latex: '\\angle',        insert: '\\angle'        },
         { name: 'measured angle',      latex: '\\measuredangle', insert: '\\measuredangle' },
         { name: 'triangle',            latex: '\\triangle',     insert: '\\triangle'     },
         { name: 'square',              latex: '\\square',       insert: '\\square'       },
         { name: 'prime',               latex: '\\prime',        insert: '\\prime'        },
         { name: 'degree',              latex: '\\degree',       insert: '\\degree'       },
         { name: 'horizontal ellipsis (ldots)', latex: '\\ldots', insert: '\\ldots'      },
         { name: 'centered ellipsis (cdots)',    latex: '\\cdots', insert: '\\cdots'      },
         { name: 'vertical ellipsis (vdots)',    latex: '\\vdots', insert: '\\vdots'      },
         { name: 'diagonal ellipsis (ddots)',    latex: '\\ddots', insert: '\\ddots'      },
         { name: 'colon (ratio)',       latex: '\\colon',        insert: '\\colon'        },
         // Ready-made blackboard number sets (distinct from the templated \mathbb{} font marker)
         { name: 'real numbers',        latex: '\\mathbb{R}',    insert: '\\mathbb{R}'    },
         { name: 'integers',            latex: '\\mathbb{Z}',    insert: '\\mathbb{Z}'    },
         { name: 'natural numbers',     latex: '\\mathbb{N}',    insert: '\\mathbb{N}'    },
         { name: 'complex numbers',     latex: '\\mathbb{C}',    insert: '\\mathbb{C}'    },
         { name: 'rational numbers',    latex: '\\mathbb{Q}',    insert: '\\mathbb{Q}'    },
      ],
   },
]

// ##########
// # CARET  #
// ##########

/**
 * Resolve an entry's `insert` string against the currently selected text and return the
 * literal text to splice in plus the resulting caret offset (relative to that text).
 *
 * Pure and deterministic, the whole caret contract lives here so it is unit-testable
 * without a DOM. Rules:
 *   - No marker: the snippet replaces the selection outright; the caret lands at its end.
 *   - Marker present: the selection (possibly empty) is placed at the marker; the caret
 *     lands just after that placed text. The marker itself is always stripped.
 */
export function buildSnippetInsertion(insert: string, selectedText: string): SnippetInsertion {
   const markerIndex = insert.indexOf(MATH_CARET_MARKER)
   if (markerIndex === -1) {
      return { text: insert, caretOffset: insert.length }
   }
   const before = insert.slice(0, markerIndex)
   const after  = insert.slice(markerIndex + MATH_CARET_MARKER.length)
   return {
      text:        before + selectedText + after,
      caretOffset: before.length + selectedText.length,
   }
}
