/*
 * Pure LaTeX emitters for the math block's structured builders (matrix, cases, aligned). No imports,
 * no side effects. Each turns a structured description into readable, multi-line LaTeX that lands
 * verbatim in the block's LaTeX textarea, so the output stays hand-editable afterwards.
 */

// #########
// # TYPES #
// #########

export type MathBuilderKind = 'matrix' | 'cases' | 'aligned'

/** Named bracket styles; each maps to a LaTeX matrix environment (MATRIX_ENVIRONMENTS) whose
 *  delimiters are baked in, so the emitter never writes \left...\right. */
export type MatrixBracket =
   | 'paren'
   | 'square'
   | 'brace'
   | 'bar'
   | 'doublebar'
   | 'none'

/** One row of a cases (piecewise) construct: a value and its condition, both raw LaTeX. */
export interface CasesRow {
   value:     string
   condition: string
}

/** One row of an aligned system: the two sides of an equation, both raw LaTeX, aligned at =. */
export interface AlignedRow {
   left:  string
   right: string
}

export interface AlignedOptions {
   /** Wrap the aligned block in a left brace, forming a braced system of equations. */
   systemBrace?: boolean
}

/** A bracket descriptor for the builder UI: the key plus a short display glyph. */
export interface MatrixBracketDescriptor {
   key:   MatrixBracket
   glyph: string
}

// #############
// # CONSTANTS #
// #############

/** Bracket -> LaTeX matrix environment; the environment carries its own delimiters. */
const MATRIX_ENVIRONMENTS: Record<MatrixBracket, string> = {
   paren:     'pmatrix',
   square:    'bmatrix',
   brace:     'Bmatrix',
   bar:       'vmatrix',
   doublebar: 'Vmatrix',
   none:      'matrix',
}

/** Ordered bracket descriptors for the builder's selector, kept beside the environment map so the
 *  two stay in sync on which brackets exist. */
export const MATRIX_BRACKETS: MatrixBracketDescriptor[] = [
   { key: 'paren',     glyph: '( )' },
   { key: 'square',    glyph: '[ ]' },
   { key: 'brace',     glyph: '{ }' },
   { key: 'bar',       glyph: '| |' },
   { key: 'doublebar', glyph: '‖ ‖' },
   { key: 'none',      glyph: '-' },
]

// Literal LaTeX row break (\\) plus a newline, so the emitted source reads one row per line.
const ROW_BREAK = ' \\\\\n'

// #############
// # EMITTERS  #
// #############

/** Matrix LaTeX from a grid of raw-LaTeX cells: cells joined by ` & `, rows by \\, wrapped in the
 *  bracket's environment. Empty cells are emitted as-is. */
export function buildMatrixLatex(grid: string[][], bracket: MatrixBracket): string {
   const environment = MATRIX_ENVIRONMENTS[bracket]
   const body = grid
      .map(row => '  ' + row.join(' & '))
      .join(ROW_BREAK)
   return `\\begin{${environment}}\n${body}\n\\end{${environment}}`
}

/** cases (piecewise) LaTeX: each row is `value & condition`, both raw LaTeX (no forced \text, since
 *  conditions are usually math like `x > 0`). */
export function buildCasesLatex(rows: CasesRow[]): string {
   const body = rows
      .map(row => `  ${row.value} & ${row.condition}`)
      .join(ROW_BREAK)
   return `\\begin{cases}\n${body}\n\\end{cases}`
}

/** Aligned system LaTeX: each row is `left &= right` in an aligned environment. systemBrace wraps the
 *  block in a left brace (null right delimiter), forming a braced system. */
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
