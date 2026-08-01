import { describe, it, expect } from 'vitest'
import { compileExpression, evaluate, evaluateExpression } from './expr'

/** Convenience: compile + evaluate in one call, asserting the compile step itself succeeded. */
function evaluateAt(source: string, x: number): number | null {
   const compiled = compileExpression(source)
   expect(compiled).not.toBeNull()
   return evaluate(compiled!, x)
}

// ##################################
// # PRECEDENCE & ASSOCIATIVITY    #
// ##################################

describe('precedence and associativity', () => {
   it('multiplication binds tighter than addition: 2+3*4 == 14', () => {
      expect(evaluateAt('2+3*4', 0)).toBe(14)
   })

   it('parentheses override precedence: (2+3)*4 == 20', () => {
      expect(evaluateAt('(2+3)*4', 0)).toBe(20)
   })

   it('^ binds tighter than unary minus: -2^2 == -4, not (-2)^2', () => {
      expect(evaluateAt('-2^2', 0)).toBe(-4)
   })

   it('^ is right-associative: 2^3^2 == 2^(3^2) == 512', () => {
      expect(evaluateAt('2^3^2', 0)).toBe(512)
   })

   it('a negative exponent works: 2^-2 == 0.25', () => {
      expect(evaluateAt('2^-2', 0)).toBe(0.25)
   })

   it('chained unary minus: --2 == 2 and ---2 == -2', () => {
      expect(evaluateAt('--2', 0)).toBe(2)
      expect(evaluateAt('---2', 0)).toBe(-2)
   })

   it('unary plus is a no-op: +2 == 2', () => {
      expect(evaluateAt('+2', 0)).toBe(2)
   })

   it('division and multiplication share precedence, left-to-right: 8/2*2 == 8', () => {
      expect(evaluateAt('8/2*2', 0)).toBe(8)
   })

   it('subtraction is left-associative: 10-3-2 == 5', () => {
      expect(evaluateAt('10-3-2', 0)).toBe(5)
   })
})

// ##################################
// # IMPLICIT MULTIPLICATION       #
// ##################################

describe('implicit multiplication', () => {
   it('2x at x=3 == 6', () => {
      expect(evaluateAt('2x', 3)).toBe(6)
   })

   it('2(x+1) at x=3 == 8', () => {
      expect(evaluateAt('2(x+1)', 3)).toBe(8)
   })

   it('2sin(0) == 0', () => {
      expect(evaluateAt('2sin(0)', 0)).toBe(0)
   })

   it('(x+1)(x-1) at x=3 == 8', () => {
      expect(evaluateAt('(x+1)(x-1)', 3)).toBe(8)
   })

   it('x pi (variable then constant, separated by whitespace) at x=2', () => {
      const result = evaluateAt('x pi', 2)
      expect(result).toBeCloseTo(2 * Math.PI, 10)
   })

   it('a constant immediately followed by a variable: pi x at x=2', () => {
      const result = evaluateAt('pi x', 2)
      expect(result).toBeCloseTo(Math.PI * 2, 10)
   })

   it('still respects surrounding precedence: 2x^2 at x=3 == 2*(3^2) == 18', () => {
      expect(evaluateAt('2x^2', 3)).toBe(18)
   })

   it('a bare function name without parens is a parse error, not implicit sin(x)', () => {
      expect(compileExpression('sinx')).toBeNull()
   })
})

// ##################################
// # FUNCTIONS                     #
// ##################################

describe('functions at known inputs', () => {
   it('sin(0) == 0', () => {
      expect(evaluateAt('sin(0)', 0)).toBeCloseTo(0, 10)
   })

   it('cos(0) == 1', () => {
      expect(evaluateAt('cos(0)', 0)).toBeCloseTo(1, 10)
   })

   it('tan(0) == 0', () => {
      expect(evaluateAt('tan(0)', 0)).toBeCloseTo(0, 10)
   })

   it('asin(1) == pi/2', () => {
      expect(evaluateAt('asin(1)', 0)).toBeCloseTo(Math.PI / 2, 10)
   })

   it('acos(1) == 0', () => {
      expect(evaluateAt('acos(1)', 0)).toBeCloseTo(0, 10)
   })

   it('atan(0) == 0', () => {
      expect(evaluateAt('atan(0)', 0)).toBeCloseTo(0, 10)
   })

   it('sinh(0) == 0', () => {
      expect(evaluateAt('sinh(0)', 0)).toBeCloseTo(0, 10)
   })

   it('cosh(0) == 1', () => {
      expect(evaluateAt('cosh(0)', 0)).toBeCloseTo(1, 10)
   })

   it('tanh(0) == 0', () => {
      expect(evaluateAt('tanh(0)', 0)).toBeCloseTo(0, 10)
   })

   it('exp(0) == 1', () => {
      expect(evaluateAt('exp(0)', 0)).toBeCloseTo(1, 10)
   })

   it('ln(e) ~= 1 (natural log)', () => {
      expect(evaluateAt('ln(e)', 0)).toBeCloseTo(1, 10)
   })

   it('log(100) == 2 (base-10 log)', () => {
      expect(evaluateAt('log(100)', 0)).toBeCloseTo(2, 10)
   })

   it('log2(8) == 3', () => {
      expect(evaluateAt('log2(8)', 0)).toBeCloseTo(3, 10)
   })

   it('sqrt(9) == 3', () => {
      expect(evaluateAt('sqrt(9)', 0)).toBe(3)
   })

   it('abs(-2) == 2', () => {
      expect(evaluateAt('abs(-2)', 0)).toBe(2)
   })

   it('floor(1.7) == 1', () => {
      expect(evaluateAt('floor(1.7)', 0)).toBe(1)
   })

   it('ceil(1.2) == 2', () => {
      expect(evaluateAt('ceil(1.2)', 0)).toBe(2)
   })

   it('round(1.5) == 2', () => {
      expect(evaluateAt('round(1.5)', 0)).toBe(2)
   })

   it('sign(-5) == -1, sign(0) == 0, sign(5) == 1', () => {
      expect(evaluateAt('sign(-5)', 0)).toBe(-1)
      expect(evaluateAt('sign(0)', 0)).toBe(0)
      expect(evaluateAt('sign(5)', 0)).toBe(1)
   })

   it('min is variadic: min(3,1,2) == 1', () => {
      expect(evaluateAt('min(3,1,2)', 0)).toBe(1)
   })

   it('max is variadic: max(3,1,2) == 3', () => {
      expect(evaluateAt('max(3,1,2)', 0)).toBe(3)
   })

   it('min/max accept two or many arguments', () => {
      expect(evaluateAt('min(4,2)', 0)).toBe(2)
      expect(evaluateAt('max(1,5,3,9,2)', 0)).toBe(9)
   })
})

// ##################################
// # CONSTANTS & VARIABLE           #
// ##################################

describe('constants and variable substitution', () => {
   it('pi evaluates to Math.PI', () => {
      expect(evaluateAt('pi', 0)).toBeCloseTo(Math.PI, 12)
   })

   it('e evaluates to Math.E', () => {
      expect(evaluateAt('e', 0)).toBeCloseTo(Math.E, 12)
   })

   it('x substitutes the given sample value', () => {
      expect(evaluateAt('x', 5)).toBe(5)
      expect(evaluateAt('x*x', 5)).toBe(25)
      expect(evaluateAt('x+1', -3)).toBe(-2)
   })
})

// ##################################
// # DOMAIN ERRORS -> null          #
// ##################################

describe('domain errors evaluate to null (a gap, never a throw)', () => {
   it('sqrt(-1) is null', () => {
      expect(evaluateAt('sqrt(-1)', 0)).toBeNull()
   })

   it('ln(0) is null', () => {
      expect(evaluateAt('ln(0)', 0)).toBeNull()
   })

   it('ln(-1) is null', () => {
      expect(evaluateAt('ln(-1)', 0)).toBeNull()
   })

   it('log(-5) is null', () => {
      expect(evaluateAt('log(-5)', 0)).toBeNull()
   })

   it('log(0) is null', () => {
      expect(evaluateAt('log(0)', 0)).toBeNull()
   })

   it('log2(0) is null', () => {
      expect(evaluateAt('log2(0)', 0)).toBeNull()
   })

   it('division by zero is null: 1/0', () => {
      expect(evaluateAt('1/0', 0)).toBeNull()
   })

   it('x/0 at any x is null', () => {
      expect(evaluateAt('x/0', 7)).toBeNull()
   })

   it('asin outside [-1, 1] is null', () => {
      expect(evaluateAt('asin(2)', 0)).toBeNull()
      expect(evaluateAt('asin(-2)', 0)).toBeNull()
   })

   it('acos outside [-1, 1] is null', () => {
      expect(evaluateAt('acos(2)', 0)).toBeNull()
      expect(evaluateAt('acos(-2)', 0)).toBeNull()
   })

   it('a domain error inside a larger expression propagates to null, not NaN', () => {
      expect(evaluateAt('1 + sqrt(-1)', 0)).toBeNull()
      expect(evaluateAt('sqrt(-1) * 2', 0)).toBeNull()
   })

   it('evaluate never throws even for a pathological sample', () => {
      expect(() => evaluateAt('ln(x)', -100)).not.toThrow()
      expect(evaluateAt('ln(x)', -100)).toBeNull()
   })
})

// ##################################
// # PARSE ERRORS -> null           #
// ##################################

describe('parse errors return null from compileExpression (never throw)', () => {
   it('a trailing operator: 2+', () => {
      expect(compileExpression('2+')).toBeNull()
   })

   it('an unbalanced opening paren: (x+1', () => {
      expect(compileExpression('(x+1')).toBeNull()
   })

   it('a trailing operator after the variable: x+', () => {
      expect(compileExpression('x+')).toBeNull()
   })

   it('a function name with no call parens: sin', () => {
      expect(compileExpression('sin')).toBeNull()
   })

   it('an unclosed function call: sin(', () => {
      expect(compileExpression('sin(')).toBeNull()
   })

   it('an unknown identifier used as a function: foo(x)', () => {
      expect(compileExpression('foo(x)')).toBeNull()
   })

   it('an unknown bare identifier: foo', () => {
      expect(compileExpression('foo')).toBeNull()
   })

   it('a doubled operator is not exponentiation: 2**3', () => {
      expect(compileExpression('2**3')).toBeNull()
   })

   it('an empty string', () => {
      expect(compileExpression('')).toBeNull()
   })

   it('whitespace-only input', () => {
      expect(compileExpression('   ')).toBeNull()
   })

   it('mismatched parens/operators: )(', () => {
      expect(compileExpression(')(')).toBeNull()
   })

   it('trailing garbage after a complete expression: 2)', () => {
      expect(compileExpression('2)')).toBeNull()
   })

   it('a single-argument function called with too many arguments: sin(1,2)', () => {
      expect(compileExpression('sin(1,2)')).toBeNull()
   })

   it('a variadic function called with zero arguments: min()', () => {
      expect(compileExpression('min()')).toBeNull()
   })

   it('an unrecognized character', () => {
      expect(compileExpression('2 $ 3')).toBeNull()
   })

   it('a dangling comma', () => {
      expect(compileExpression('min(1,)')).toBeNull()
   })

   it('an empty parenthesized group', () => {
      expect(compileExpression('()')).toBeNull()
   })
})

// ##################################
// # SAFETY                        #
// ##################################

describe('safety: no code execution surface', () => {
   it('does not reach into global/property lookups for an unknown identifier', () => {
      expect(compileExpression('constructor')).toBeNull()
      expect(compileExpression('window')).toBeNull()
      expect(compileExpression('process')).toBeNull()
      expect(compileExpression('__proto__')).toBeNull()
   })

   it('a constant or variable followed by parens is implicit multiplication, not a call: pi(1) == pi*1', () => {
      // pi/x are not in the function allowlist, so "(" right after one never triggers a call —
      // it falls through to the ordinary implicit-multiplication rule instead (ratified grammar).
      expect(evaluateAt('pi(1)', 0)).toBeCloseTo(Math.PI, 10)
      expect(evaluateAt('x(1)', 5)).toBe(5)
   })

   it('is case-sensitive: SIN(0) is not sin(0)', () => {
      expect(compileExpression('SIN(0)')).toBeNull()
   })
})

// ##################################
// # COMPILE-ONCE, EVALUATE-MANY    #
// ##################################

describe('compile once, evaluate many times', () => {
   it('a single compiled expression evaluates correctly across several x values', () => {
      const compiled = compileExpression('x^2 + 1')
      expect(compiled).not.toBeNull()
      expect(evaluate(compiled!, 0)).toBe(1)
      expect(evaluate(compiled!, 1)).toBe(2)
      expect(evaluate(compiled!, 2)).toBe(5)
      expect(evaluate(compiled!, -3)).toBe(10)
   })

   it('the same compiled object can mix ordinary and domain-error samples', () => {
      const compiled = compileExpression('sqrt(x)')
      expect(compiled).not.toBeNull()
      expect(evaluate(compiled!, 4)).toBe(2)
      expect(evaluate(compiled!, -1)).toBeNull()
      expect(evaluate(compiled!, 9)).toBe(3)
   })

   it('reuses the same CompiledExpression instance without re-parsing side effects', () => {
      const compiled = compileExpression('sin(x)')
      expect(compiled).not.toBeNull()
      const first = evaluate(compiled!, 0)
      const second = evaluate(compiled!, 0)
      expect(first).toBe(second)
   })
})

// ##################################
// # evaluateExpression convenience #
// ##################################

describe('evaluateExpression convenience wrapper', () => {
   it('compiles and evaluates in one call', () => {
      expect(evaluateExpression('2*x+1', 3)).toBe(7)
   })

   it('returns null for a compile error', () => {
      expect(evaluateExpression('2+', 3)).toBeNull()
   })

   it('returns null for a domain error', () => {
      expect(evaluateExpression('sqrt(x)', -1)).toBeNull()
   })
})

// ##################################
// # NUMBER LITERALS                #
// ##################################

describe('numeric literal forms', () => {
   it('parses a plain integer', () => {
      expect(evaluateAt('42', 0)).toBe(42)
   })

   it('parses a decimal', () => {
      expect(evaluateAt('2.5', 0)).toBe(2.5)
   })

   it('parses a leading-dot decimal', () => {
      expect(evaluateAt('.5', 0)).toBe(0.5)
   })

   it('parses a positive exponent', () => {
      expect(evaluateAt('2.5e3', 0)).toBe(2500)
   })

   it('parses an uppercase-E exponent', () => {
      expect(evaluateAt('2.5E3', 0)).toBe(2500)
   })

   it('parses a negative exponent', () => {
      expect(evaluateAt('1e-5', 0)).toBeCloseTo(0.00001, 12)
   })
})
