import { describe, it, expect } from 'vitest'
import {
   MATRIX_BRACKETS,
   buildMatrixLatex,
   buildCasesLatex,
   buildAlignedLatex,
} from './mathStructures'
import type { MatrixBracket } from './mathStructures'

// The two-character LaTeX row break the emitters place between rows.
const ROW_BREAK = '\\\\'

describe('buildMatrixLatex', () => {
   // Each bracket key -> the environment name its output must open/close with.
   const ENVIRONMENT_BY_BRACKET: Record<MatrixBracket, string> = {
      paren:     'pmatrix',
      square:    'bmatrix',
      brace:     'Bmatrix',
      bar:       'vmatrix',
      doublebar: 'Vmatrix',
      none:      'matrix',
   }

   it('wraps in the correct environment for every bracket style', () => {
      for (const [bracket, environment] of Object.entries(ENVIRONMENT_BY_BRACKET)) {
         const latex = buildMatrixLatex([['a', 'b'], ['c', 'd']], bracket as MatrixBracket)
         expect(latex.startsWith(`\\begin{${environment}}`)).toBe(true)
         expect(latex.endsWith(`\\end{${environment}}`)).toBe(true)
      }
   })

   it('joins cells within a row by " & " and rows by a "\\\\" break', () => {
      const latex = buildMatrixLatex([['a', 'b'], ['c', 'd']], 'square')
      expect(latex).toContain('a & b')
      expect(latex).toContain('c & d')
      expect(latex).toContain(ROW_BREAK)
      // One row break between two rows.
      expect(latex.split(ROW_BREAK).length - 1).toBe(1)
   })

   it('produces the expected full output for a 2x2 bracket matrix', () => {
      const latex = buildMatrixLatex([['a', 'b'], ['c', 'd']], 'square')
      expect(latex).toBe('\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}')
   })

   it('handles a 1x1 matrix (no row break, single cell)', () => {
      const latex = buildMatrixLatex([['x']], 'paren')
      expect(latex).toBe('\\begin{pmatrix}\n  x\n\\end{pmatrix}')
      expect(latex).not.toContain(ROW_BREAK)
   })

   it('handles a 1xN row vector (cells joined, no row break)', () => {
      const latex = buildMatrixLatex([['a', 'b', 'c']], 'square')
      expect(latex).toBe('\\begin{bmatrix}\n  a & b & c\n\\end{bmatrix}')
      expect(latex).not.toContain(ROW_BREAK)
   })

   it('handles an Nx1 column vector (row breaks, no cell separator)', () => {
      const latex = buildMatrixLatex([['a'], ['b'], ['c']], 'paren')
      expect(latex).toBe('\\begin{pmatrix}\n  a \\\\\n  b \\\\\n  c\n\\end{pmatrix}')
      expect(latex).not.toContain('&')
      expect(latex.split(ROW_BREAK).length - 1).toBe(2)
   })

   it('emits empty cells as empty strings', () => {
      const latex = buildMatrixLatex([['', ''], ['', '']], 'none')
      expect(latex).toBe('\\begin{matrix}\n   &  \\\\\n   & \n\\end{matrix}')
   })

   it('uses the plain matrix environment for the "none" bracket', () => {
      const latex = buildMatrixLatex([['1']], 'none')
      expect(latex).toContain('\\begin{matrix}')
      expect(latex).not.toContain('pmatrix')
   })
})

describe('buildCasesLatex', () => {
   it('wraps rows in a cases environment with value & condition columns', () => {
      const latex = buildCasesLatex([
         { value: 'x',  condition: 'x \\geq 0' },
         { value: '-x', condition: 'x < 0' },
      ])
      expect(latex).toBe(
         '\\begin{cases}\n  x & x \\geq 0 \\\\\n  -x & x < 0\n\\end{cases}',
      )
   })

   it('keeps condition columns raw (no forced \\text{})', () => {
      const latex = buildCasesLatex([{ value: '1', condition: 'n = 0' }])
      expect(latex).not.toContain('\\text')
      expect(latex).toContain('1 & n = 0')
   })

   it('handles a single row (no row break)', () => {
      const latex = buildCasesLatex([{ value: 'a', condition: 'b' }])
      expect(latex).toBe('\\begin{cases}\n  a & b\n\\end{cases}')
      expect(latex).not.toContain(ROW_BREAK)
   })

   it('emits empty value / condition as empty', () => {
      const latex = buildCasesLatex([{ value: '', condition: '' }])
      expect(latex).toBe('\\begin{cases}\n   & \n\\end{cases}')
   })
})

describe('buildAlignedLatex', () => {
   it('aligns rows at "=" inside an aligned environment', () => {
      const latex = buildAlignedLatex([
         { left: 'x', right: '1' },
         { left: 'y', right: '2' },
      ])
      expect(latex).toBe(
         '\\begin{aligned}\n  x &= 1 \\\\\n  y &= 2\n\\end{aligned}',
      )
   })

   it('handles a single row (no row break)', () => {
      const latex = buildAlignedLatex([{ left: 'a', right: 'b' }])
      expect(latex).toBe('\\begin{aligned}\n  a &= b\n\\end{aligned}')
      expect(latex).not.toContain(ROW_BREAK)
   })

   it('wraps in a left brace when systemBrace is set', () => {
      const latex = buildAlignedLatex(
         [{ left: 'x', right: '1' }, { left: 'y', right: '2' }],
         { systemBrace: true },
      )
      expect(latex.startsWith('\\left\\{\\begin{aligned}')).toBe(true)
      expect(latex.endsWith('\\end{aligned}\\right.')).toBe(true)
      expect(latex).toContain('x &= 1')
      expect(latex).toContain('y &= 2')
   })

   it('omits the brace wrapper by default', () => {
      const latex = buildAlignedLatex([{ left: 'a', right: 'b' }])
      expect(latex).not.toContain('\\left\\{')
      expect(latex).not.toContain('\\right.')
   })

   it('treats an omitted options argument the same as no systemBrace', () => {
      const withoutOptions = buildAlignedLatex([{ left: 'a', right: 'b' }])
      const withEmptyOptions = buildAlignedLatex([{ left: 'a', right: 'b' }], {})
      expect(withoutOptions).toBe(withEmptyOptions)
   })
})

describe('MATRIX_BRACKETS descriptor list', () => {
   it('covers every bracket key exactly once with a non-empty glyph', () => {
      const keys = MATRIX_BRACKETS.map(descriptor => descriptor.key)
      expect(new Set(keys).size).toBe(keys.length)
      expect(new Set(keys)).toEqual(
         new Set<MatrixBracket>(['paren', 'square', 'brace', 'bar', 'doublebar', 'none']),
      )
      for (const descriptor of MATRIX_BRACKETS) {
         expect(descriptor.glyph.length).toBeGreaterThan(0)
      }
   })
})
