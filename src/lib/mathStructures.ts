/**
 * mathStructures.ts, pure LaTeX emitters for the math block's structured-construct builders.
 *
 * PURE DATA / PURE FUNCTIONS — side-effect free, imports NOTHING (no Temml, no React).
 * Each function turns a structured description (a grid, a list of rows) into readable,
 * multi-line LaTeX source. That source lands verbatim in the math block's LaTeX textarea,
 * so human-legibility of the output is a feature: a user can keep hand-editing it afterwards.
 *
 * The builder UI (molecules/MathBuilderModal.tsx) collects the structured input; this module
 * is the single place the `&` / `\\` grammar is generated, and the only place under unit test.
 */

// #########
// # TYPES #
// #########

/** Which structured construct a builder builds (drives the modal + palette wiring). */
export type MathBuilderKind = 'matrix' | 'cases' | 'aligned'

/**
 * The named bracket styles a matrix can wear. Each maps to a LaTeX matrix environment
 * (see MATRIX_ENVIRONMENTS): the delimiters are baked into the environment, so the emitter
 * never hand-writes `\left…\right…`.
 */
export type MatrixBracket =
   | 'paren'      // ( )   pmatrix
   | 'square'     // [ ]   bmatrix
   | 'brace'      // { }   Bmatrix
   | 'bar'        // | |   vmatrix   (determinant)
   | 'doublebar'  // ‖ ‖   Vmatrix   (norm)
   | 'none'       //       matrix    (no delimiters)

/** One row of a piecewise / cases construct: a value and the condition it holds under. */
export interface CasesRow {
   /** The value expression (raw LaTeX), left column. */
   value:     string
   /** The condition expression (raw LaTeX), right column. Often math like `x > 0`. */
   condition: string
}

/** One row of an aligned system: the two sides of an equation, aligned at `=`. */
export interface AlignedRow {
   /** Left-hand side (raw LaTeX). */
   left:  string
   /** Right-hand side (raw LaTeX). */
   right: string
}

/** Options for {@link buildAlignedLatex}. */
export interface AlignedOptions {
   /** When true, wrap the aligned block in a left brace, forming a braced system of equations. */
   systemBrace?: boolean
}

/** A bracket descriptor for the builder UI: the key plus a short display glyph. */
export interface MatrixBracketDescriptor {
   key:   MatrixBracket
   /** A compact glyph pair for the selector button, e.g. `[ ]`. */
   glyph: string
}

// #############
// # CONSTANTS #
// #############

/**
 * Bracket -> LaTeX matrix environment. The environment carries its own delimiters, so a
 * matrix is emitted as `\begin{<env>} … \end{<env>}` with nothing else wrapping it.
 */
const MATRIX_ENVIRONMENTS: Record<MatrixBracket, string> = {
   paren:     'pmatrix',
   square:    'bmatrix',
   brace:     'Bmatrix',
   bar:       'vmatrix',
   doublebar: 'Vmatrix',
   none:      'matrix',
}

/**
 * Ordered bracket descriptors for the builder's bracket selector. Kept here (next to the
 * environment map) so the UI and the emitter never drift apart on which brackets exist.
 */
export const MATRIX_BRACKETS: MatrixBracketDescriptor[] = [
   { key: 'paren',     glyph: '( )' },
   { key: 'square',    glyph: '[ ]' },
   { key: 'brace',     glyph: '{ }' },
   { key: 'bar',       glyph: '| |' },
   { key: 'doublebar', glyph: '‖ ‖' },
   { key: 'none',      glyph: '–' },
]

// A literal LaTeX row break: the two-character sequence `\\`. Rows of every construct are
// joined by this followed by a newline, so the emitted source reads one row per line.
const ROW_BREAK = ' \\\\\n'

// #############
// # EMITTERS  #
// #############

/**
 * Build the LaTeX for a matrix from a 2D grid of raw-LaTeX cells and a bracket style.
 * Cells within a row are joined by ` & `, rows by a `\\` break, and the whole thing is
 * wrapped in the environment the bracket maps to. Empty cells are emitted as-is (empty).
 *
 * Example (grid `[['a','b'],['c','d']]`, bracket `'square'`):
 *   \begin{bmatrix}
 *     a & b \\
 *     c & d
 *   \end{bmatrix}
 */
export function buildMatrixLatex(grid: string[][], bracket: MatrixBracket): string {
   const environment = MATRIX_ENVIRONMENTS[bracket]
   const body = grid
      .map(row => '  ' + row.join(' & '))
      .join(ROW_BREAK)
   return `\\begin{${environment}}\n${body}\n\\end{${environment}}`
}

/**
 * Build the LaTeX for a `cases` (piecewise) construct. Each row contributes
 * `value & condition`; both columns stay raw LaTeX (no forced `\text{}`, since conditions
 * are usually math like `x > 0`).
 *
 * Example (rows `[{value:'x',condition:'x \\geq 0'},{value:'-x',condition:'x < 0'}]`):
 *   \begin{cases}
 *     x & x \geq 0 \\
 *     -x & x < 0
 *   \end{cases}
 */
export function buildCasesLatex(rows: CasesRow[]): string {
   const body = rows
      .map(row => `  ${row.value} & ${row.condition}`)
      .join(ROW_BREAK)
   return `\\begin{cases}\n${body}\n\\end{cases}`
}

/**
 * Build the LaTeX for a system of equations aligned at `=`. Each row contributes
 * `left &= right` inside an `aligned` environment. When `systemBrace` is set, the aligned
 * block is wrapped in a left brace (and a null right delimiter), forming a braced system.
 *
 * Example (rows `[{left:'x',right:'1'},{left:'y',right:'2'}]`, no brace):
 *   \begin{aligned}
 *     x &= 1 \\
 *     y &= 2
 *   \end{aligned}
 *
 * With `systemBrace` the same body is wrapped as `\left\{\begin{aligned} … \end{aligned}\right.`.
 */
export function buildAlignedLatex(rows: AlignedRow[], options: AlignedOptions = {}): string {
   const body = rows
      .map(row => `  ${row.left} &= ${row.right}`)
      .join(ROW_BREAK)
   const aligned = `\\begin{aligned}\n${body}\n\\end{aligned}`
   if (options.systemBrace) {
      return `\\left\\{${aligned}\\right.`
   }
   return aligned
}
