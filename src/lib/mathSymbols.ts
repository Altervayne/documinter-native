/**
 * mathSymbols.ts, the assisted-input catalog for the math block's symbol palette.
 *
 * PURE DATA — side-effect free. This module deliberately imports NOTHING that loads
 * Temml (lib/math.ts kicks off the raw-asset load on import) or lucide (lib/constants.ts):
 * the palette component renders the glyphs by feeding each entry's `latex` to the
 * renderer itself. Keeping the catalog import-clean means the serializers and any test
 * can pull it in without dragging in the Temml load or an icon bundle.
 *
 * The palette is PURE UI over the existing `latex` field of a math block. It makes NO
 * model or serialization change: inserting a snippet only edits the LaTeX source text,
 * exactly as if the user had typed it. The ```math fence is untouched.
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
   | 'bigOperators'
   | 'fractionsRoots'
   | 'scripts'
   | 'matrices'
   | 'arrows'
   | 'accentsMisc'

/** One palette entry. */
export interface MathSymbolEntry {
   /** Human label, used for the tooltip / aria-label and matched by the filter. */
   name:   string
   /**
    * The LaTeX rendered onto the button so it is scannable by sight. Always renderable
    * (never contains the caret marker) — a clean glyph or a small representative template.
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
         { name: 'alpha',   latex: '\\alpha',   insert: '\\alpha'   },
         { name: 'beta',    latex: '\\beta',    insert: '\\beta'    },
         { name: 'gamma',   latex: '\\gamma',   insert: '\\gamma'   },
         { name: 'delta',   latex: '\\delta',   insert: '\\delta'   },
         { name: 'epsilon', latex: '\\epsilon', insert: '\\epsilon' },
         { name: 'theta',   latex: '\\theta',   insert: '\\theta'   },
         { name: 'lambda',  latex: '\\lambda',  insert: '\\lambda'  },
         { name: 'mu',      latex: '\\mu',      insert: '\\mu'      },
         { name: 'pi',      latex: '\\pi',      insert: '\\pi'      },
         { name: 'sigma',   latex: '\\sigma',   insert: '\\sigma'   },
         { name: 'phi',     latex: '\\phi',     insert: '\\phi'     },
         { name: 'omega',   latex: '\\omega',   insert: '\\omega'   },
         { name: 'Gamma (uppercase)', latex: '\\Gamma', insert: '\\Gamma' },
         { name: 'Delta (uppercase)', latex: '\\Delta', insert: '\\Delta' },
         { name: 'Theta (uppercase)', latex: '\\Theta', insert: '\\Theta' },
         { name: 'Lambda (uppercase)', latex: '\\Lambda', insert: '\\Lambda' },
         { name: 'Pi (uppercase)',    latex: '\\Pi',    insert: '\\Pi'    },
         { name: 'Sigma (uppercase)', latex: '\\Sigma', insert: '\\Sigma' },
         { name: 'Phi (uppercase)',   latex: '\\Phi',   insert: '\\Phi'   },
         { name: 'Omega (uppercase)', latex: '\\Omega', insert: '\\Omega' },
      ],
   },

   // =========================
   //  Operators and relations
   // =========================
   {
      key: 'operators',
      entries: [
         { name: 'times (multiply)',  latex: '\\times',    insert: '\\times'    },
         { name: 'divide',            latex: '\\div',      insert: '\\div'      },
         { name: 'plus-minus',        latex: '\\pm',       insert: '\\pm'       },
         { name: 'minus-plus',        latex: '\\mp',       insert: '\\mp'       },
         { name: 'less than or equal',    latex: '\\leq',    insert: '\\leq'    },
         { name: 'greater than or equal', latex: '\\geq',    insert: '\\geq'    },
         { name: 'not equal',         latex: '\\neq',      insert: '\\neq'      },
         { name: 'approximately',     latex: '\\approx',   insert: '\\approx'   },
         { name: 'equivalent',        latex: '\\equiv',    insert: '\\equiv'    },
         { name: 'proportional to',   latex: '\\propto',   insert: '\\propto'   },
         { name: 'element of',        latex: '\\in',       insert: '\\in'       },
         { name: 'not an element of', latex: '\\notin',    insert: '\\notin'    },
         { name: 'subset of',         latex: '\\subset',   insert: '\\subset'   },
         { name: 'subset of or equal', latex: '\\subseteq', insert: '\\subseteq' },
         { name: 'union',             latex: '\\cup',      insert: '\\cup'      },
         { name: 'intersection',      latex: '\\cap',      insert: '\\cap'      },
         { name: 'centered dot',      latex: '\\cdot',     insert: '\\cdot'     },
         { name: 'composition (ring)', latex: '\\circ',    insert: '\\circ'     },
      ],
   },

   // ===============
   //  Big operators
   // ===============
   // Clean glyph on the button, bound placeholders in the insert.
   {
      key: 'bigOperators',
      entries: [
         { name: 'summation',   latex: '\\sum',    insert: `\\sum_{${CARET}}^{}`    },
         { name: 'product',     latex: '\\prod',   insert: `\\prod_{${CARET}}^{}`   },
         { name: 'integral',    latex: '\\int',    insert: `\\int_{${CARET}}^{}`    },
         { name: 'double integral', latex: '\\iint', insert: `\\iint_{${CARET}}`    },
         { name: 'contour integral', latex: '\\oint', insert: `\\oint_{${CARET}}`   },
         { name: 'big union',   latex: '\\bigcup', insert: `\\bigcup_{${CARET}}^{}` },
         { name: 'big intersection', latex: '\\bigcap', insert: `\\bigcap_{${CARET}}^{}` },
      ],
   },

   // =====================
   //  Fractions and roots
   // =====================
   {
      key: 'fractionsRoots',
      entries: [
         { name: 'fraction',      latex: '\\frac{a}{b}',  insert: `\\frac{${CARET}}{}`  },
         { name: 'square root',   latex: '\\sqrt{x}',     insert: `\\sqrt{${CARET}}`    },
         { name: 'nth root',      latex: '\\sqrt[n]{x}',  insert: `\\sqrt[n]{${CARET}}` },
      ],
   },

   // =========
   //  Scripts
   // =========
   {
      key: 'scripts',
      entries: [
         { name: 'superscript',        latex: 'x^{n}',    insert: `x^{${CARET}}`      },
         { name: 'subscript',          latex: 'x_{i}',    insert: `x_{${CARET}}`      },
         { name: 'subscript and superscript', latex: 'x_{i}^{n}', insert: `x_{${CARET}}^{}` },
      ],
   },

   // =========================
   //  Matrices and delimiters
   // =========================
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
            name:   'cases',
            latex:  '\\begin{cases} a \\\\ b \\end{cases}',
            insert: `\\begin{cases} ${CARET} & \\\\ & \\end{cases}`,
         },
         { name: 'parentheses',     latex: '\\left( x \\right)',    insert: `\\left( ${CARET} \\right)`    },
         { name: 'square brackets', latex: '\\left[ x \\right]',    insert: `\\left[ ${CARET} \\right]`    },
         { name: 'curly braces',    latex: '\\left\\{ x \\right\\}', insert: `\\left\\{ ${CARET} \\right\\}` },
      ],
   },

   // ========
   //  Arrows
   // ========
   {
      key: 'arrows',
      entries: [
         { name: 'right arrow (to)',   latex: '\\to',             insert: '\\to'             },
         { name: 'left arrow',         latex: '\\leftarrow',      insert: '\\leftarrow'      },
         { name: 'left-right arrow',   latex: '\\leftrightarrow', insert: '\\leftrightarrow' },
         { name: 'implies (right)',    latex: '\\Rightarrow',     insert: '\\Rightarrow'     },
         { name: 'implied by (left)',  latex: '\\Leftarrow',      insert: '\\Leftarrow'      },
         { name: 'if and only if',     latex: '\\Leftrightarrow', insert: '\\Leftrightarrow' },
         { name: 'maps to',            latex: '\\mapsto',         insert: '\\mapsto'         },
      ],
   },

   // ===================
   //  Accents and misc.
   // ===================
   {
      key: 'accentsMisc',
      entries: [
         { name: 'hat',        latex: '\\hat{a}',  insert: `\\hat{${CARET}}`  },
         { name: 'bar',        latex: '\\bar{a}',  insert: `\\bar{${CARET}}`  },
         { name: 'vector',     latex: '\\vec{a}',  insert: `\\vec{${CARET}}`  },
         { name: 'dot',        latex: '\\dot{a}',  insert: `\\dot{${CARET}}`  },
         { name: 'infinity',   latex: '\\infty',   insert: '\\infty'   },
         { name: 'partial derivative', latex: '\\partial', insert: '\\partial' },
         { name: 'nabla (del)', latex: '\\nabla',  insert: '\\nabla'   },
         { name: 'real numbers',    latex: '\\mathbb{R}', insert: '\\mathbb{R}' },
         { name: 'integers',        latex: '\\mathbb{Z}', insert: '\\mathbb{Z}' },
         { name: 'natural numbers', latex: '\\mathbb{N}', insert: '\\mathbb{N}' },
         { name: 'complex numbers', latex: '\\mathbb{C}', insert: '\\mathbb{C}' },
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
 * Pure and deterministic — the whole caret contract lives here so it is unit-testable
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
