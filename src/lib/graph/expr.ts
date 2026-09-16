/*
 * A safe math-expression evaluator in one variable `x`. No eval, no new Function, no dynamic code
 * generation or property access driven by user input: the pipeline is tokenize -> parse
 * (precedence-climbing recursive descent) -> AST -> evaluate, and every function call resolves
 * through the fixed FUNCTION_TABLE allowlist, so there is no injection surface. Both entry points
 * are total: compileExpression returns null on an invalid expression, evaluate returns null on a
 * domain error (the graph renderer reads that as "draw a gap"). Compile once, evaluate per sample.
 *
 * Grammar:
 *   - Numbers with optional exponent (`1`, `2.5`, `1e-5`), the variable `x`, constants `pi`/`e`.
 *   - Functions (closed allowlist, always parenthesized): sin cos tan asin acos atan sinh cosh tanh
 *     exp ln log log2 sqrt abs floor ceil round sign, plus variadic min/max. `log` is base-10.
 *   - Operators `+ - * /`, right-associative `^`, unary `-`/`+`. Precedence tightest first:
 *     `^` > unary `-`/`+` > `* /` > `+ -`, so `-2^2 = -4` and `2^3^2 = 512`.
 *   - Implicit multiplication where a completed primary is followed by a token that starts a new
 *     one (`2x`, `2(x+1)`, `x pi`); unambiguous since `x` is the only bare identifier. A function
 *     without parens (`sinx`) is a parse error, not `sin(x)`.
 */

// #####################
// # 1. TOKENIZER      #
// #####################

/** One lexical token produced by {@link tokenize}. */
type Token =
   | { kind: 'number'; value: number }
   | { kind: 'ident'; name: string }
   | { kind: 'operator'; operator: '+' | '-' | '*' | '/' | '^' }
   | { kind: 'leftParen' }
   | { kind: 'rightParen' }
   | { kind: 'comma' }

/** A character that may START a bare identifier (`x`, `pi`, `sin`, `log2`, ...): ASCII letters only. */
function isIdentifierStartCharacter(character: string): boolean {
   return /[a-zA-Z]/.test(character)
}

/** A character that may CONTINUE an identifier: letters or digits, so `log2` lexes as one token. */
function isIdentifierContinuationCharacter(character: string): boolean {
   return /[a-zA-Z0-9]/.test(character)
}

function isDigitCharacter(character: string): boolean {
   return character >= '0' && character <= '9'
}

/**
 * Turn a source string into a flat token list. Returns `null` on any lexical error (an unknown
 * character, a malformed numeric literal), never throws.
 */
function tokenize(source: string): Token[] | null {
   const tokens: Token[] = []
   let position = 0
   const length = source.length

   while (position < length) {
      const character = source[position]

      if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
         position++
         continue
      }

      // Numbers: digits, one optional decimal point, one optional exponent.
      if (isDigitCharacter(character) || (character === '.' && isDigitCharacter(source[position + 1] ?? ''))) {
         const start = position
         while (position < length && isDigitCharacter(source[position])) position++
         if (source[position] === '.') {
            position++
            while (position < length && isDigitCharacter(source[position])) position++
         }
         if (source[position] === 'e' || source[position] === 'E') {
            const exponentStart = position
            position++
            if (source[position] === '+' || source[position] === '-') position++
            if (!isDigitCharacter(source[position] ?? '')) {
               // Not an exponent suffix (a bare trailing "e"): back out so it re-lexes as an identifier.
               position = exponentStart
            } else {
               while (position < length && isDigitCharacter(source[position])) position++
            }
         }
         const text = source.slice(start, position)
         const value = Number(text)
         if (!Number.isFinite(value)) return null
         tokens.push({ kind: 'number', value })
         continue
      }

      if (isIdentifierStartCharacter(character)) {
         const start = position
         while (position < length && isIdentifierContinuationCharacter(source[position])) position++
         const name = source.slice(start, position)
         tokens.push({ kind: 'ident', name })
         continue
      }

      if (character === '+' || character === '-' || character === '*' || character === '/' || character === '^') {
         tokens.push({ kind: 'operator', operator: character })
         position++
         continue
      }
      if (character === '(') {
         tokens.push({ kind: 'leftParen' })
         position++
         continue
      }
      if (character === ')') {
         tokens.push({ kind: 'rightParen' })
         position++
         continue
      }
      if (character === ',') {
         tokens.push({ kind: 'comma' })
         position++
         continue
      }

      return null // any other character is a lexical error
   }

   return tokens
}

// #####################
// # 2. AST            #
// #####################

type ExpressionNode =
   | { kind: 'number'; value: number }
   | { kind: 'variable' }
   | { kind: 'constant'; name: 'pi' | 'e' }
   | { kind: 'unary'; operator: '-' | '+'; operand: ExpressionNode }
   | { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '^'; left: ExpressionNode; right: ExpressionNode }
   | { kind: 'call'; name: string; args: ExpressionNode[] }

// #####################
// # 3. PARSER         #
// #####################

/** The fixed set of known function names (single-arg unless noted, checked at parse time). */
const SINGLE_ARGUMENT_FUNCTION_NAMES = new Set([
   'sin', 'cos', 'tan',
   'asin', 'acos', 'atan',
   'sinh', 'cosh', 'tanh',
   'exp', 'ln', 'log', 'log2',
   'sqrt', 'abs', 'floor', 'ceil', 'round', 'sign',
])
const VARIADIC_FUNCTION_NAMES = new Set(['min', 'max'])
const CONSTANT_NAMES = new Set(['pi', 'e'])

function isKnownFunctionName(name: string): boolean {
   return SINGLE_ARGUMENT_FUNCTION_NAMES.has(name) || VARIADIC_FUNCTION_NAMES.has(name)
}

/** Precedence-climbing recursive-descent parser, one function per grammar tier
 *  (parseExpression -> parseTerm -> parseUnary -> parsePower -> parsePrimary). Returns null on any
 *  syntax error, never throws. */
class Parser {
   private readonly tokens: Token[]
   private position = 0

   constructor(tokens: Token[]) {
      this.tokens = tokens
   }

   private peek(): Token | undefined {
      return this.tokens[this.position]
   }

   private advance(): Token | undefined {
      return this.tokens[this.position++]
   }

   /** True when the current token could begin a new primary expression (used for implicit *). */
   private startsPrimary(): boolean {
      const token = this.peek()
      if (!token) return false
      if (token.kind === 'number' || token.kind === 'leftParen') return true
      if (token.kind === 'ident') return true
      return false
   }

   // ====== tier 1: + - (lowest precedence, left-associative) ======
   parseExpression(): ExpressionNode | null {
      let left = this.parseTerm()
      if (left === null) return null
      for (;;) {
         const token = this.peek()
         if (token?.kind === 'operator' && (token.operator === '+' || token.operator === '-')) {
            this.advance()
            const right = this.parseTerm()
            if (right === null) return null
            left = { kind: 'binary', operator: token.operator, left, right }
         } else {
            return left
         }
      }
   }

   // ====== tier 2: * / (also where implicit multiplication is spliced in) ======
   private parseTerm(): ExpressionNode | null {
      let left = this.parseUnary()
      if (left === null) return null
      for (;;) {
         const token = this.peek()
         if (token?.kind === 'operator' && (token.operator === '*' || token.operator === '/')) {
            this.advance()
            const right = this.parseUnary()
            if (right === null) return null
            left = { kind: 'binary', operator: token.operator, left, right }
         } else if (this.startsPrimary()) {
            // Implicit multiplication: the next token starts a new primary (2x, 2(x+1)) with no
            // operator between, so splice in a synthetic '*'.
            const right = this.parseUnary()
            if (right === null) return null
            left = { kind: 'binary', operator: '*', left, right }
         } else {
            return left
         }
      }
   }

   // ====== tier 3: unary - and + (binds looser than ^, so -2^2 = -(2^2)) ======
   private parseUnary(): ExpressionNode | null {
      const token = this.peek()
      if (token?.kind === 'operator' && (token.operator === '-' || token.operator === '+')) {
         this.advance()
         const operand = this.parseUnary()
         if (operand === null) return null
         return { kind: 'unary', operator: token.operator, operand }
      }
      return this.parsePower()
   }

   // ====== tier 4: ^ (right-associative: 2^3^2 = 2^(3^2)) ======
   private parsePower(): ExpressionNode | null {
      const base = this.parsePrimary()
      if (base === null) return null
      const token = this.peek()
      if (token?.kind === 'operator' && token.operator === '^') {
         this.advance()
         // Recurse into parseUnary so a signed exponent (2^-2) works and `^` right-associates.
         const exponent = this.parseUnary()
         if (exponent === null) return null
         return { kind: 'binary', operator: '^', left: base, right: exponent }
      }
      return base
   }

   // ====== tier 5: primaries, numbers, x, constants, function calls, parenthesized groups ======
   private parsePrimary(): ExpressionNode | null {
      const token = this.advance()
      if (!token) return null

      if (token.kind === 'number') {
         return { kind: 'number', value: token.value }
      }

      if (token.kind === 'leftParen') {
         const inner = this.parseExpression()
         if (inner === null) return null
         const closing = this.advance()
         if (closing?.kind !== 'rightParen') return null
         return inner
      }

      if (token.kind === 'ident') {
         const name = token.name

         // A function call always requires an explicit '(': "sinx" is a parse error, not "sin(x)".
         if (isKnownFunctionName(name)) {
            const openParen = this.peek()
            if (openParen?.kind !== 'leftParen') return null
            this.advance()
            const args = this.parseArgumentList()
            if (args === null) return null
            if (SINGLE_ARGUMENT_FUNCTION_NAMES.has(name) && args.length !== 1) return null
            if (VARIADIC_FUNCTION_NAMES.has(name) && args.length < 1) return null
            return { kind: 'call', name, args }
         }

         if (CONSTANT_NAMES.has(name)) {
            return { kind: 'constant', name: name as 'pi' | 'e' }
         }

         if (name === 'x') {
            return { kind: 'variable' }
         }

         // Any other bare identifier is unknown, a parse error, never a silent guess.
         return null
      }

      return null
   }

   /** Parses `(` already consumed ... `arg, arg, ...` `)`, returning the argument list. */
   private parseArgumentList(): ExpressionNode[] | null {
      const args: ExpressionNode[] = []
      if (this.peek()?.kind === 'rightParen') {
         this.advance()
         return args
      }
      for (;;) {
         const argument = this.parseExpression()
         if (argument === null) return null
         args.push(argument)
         const next = this.advance()
         if (next?.kind === 'rightParen') return args
         if (next?.kind !== 'comma') return null
      }
   }

   /** True once every token has been consumed (used to reject trailing garbage like "2 3"). */
   isAtEnd(): boolean {
      return this.position >= this.tokens.length
   }
}

// #####################
// # 4. COMPILE        #
// #####################

/** A parsed, ready-to-evaluate expression. Compile once, then {@link evaluate} per sample point. */
export interface CompiledExpression {
   readonly ast: ExpressionNode
   readonly source: string
}

/** Tokenize + parse `source` into a {@link CompiledExpression}. Returns null on any lexical or
 *  syntax error, never throws. */
export function compileExpression(source: string): CompiledExpression | null {
   const tokens = tokenize(source)
   if (tokens === null) return null
   if (tokens.length === 0) return null // empty input has nothing to plot

   const parser = new Parser(tokens)
   const ast = parser.parseExpression()
   if (ast === null) return null
   if (!parser.isAtEnd()) return null // trailing garbage after a complete expression

   return { ast, source }
}

// #####################
// # 5. EVALUATE       #
// #####################

/** The closed allowlist of callable functions: the only way the evaluator reaches a `Math.*` call.
 *  The parser has already validated every call name, so an AST `call` node always has an entry here. */
const FUNCTION_TABLE: Record<string, (args: number[]) => number> = {
   sin: (args) => Math.sin(args[0]),
   cos: (args) => Math.cos(args[0]),
   tan: (args) => Math.tan(args[0]),
   asin: (args) => Math.asin(args[0]),
   acos: (args) => Math.acos(args[0]),
   atan: (args) => Math.atan(args[0]),
   sinh: (args) => Math.sinh(args[0]),
   cosh: (args) => Math.cosh(args[0]),
   tanh: (args) => Math.tanh(args[0]),
   exp: (args) => Math.exp(args[0]),
   ln: (args) => Math.log(args[0]),
   log: (args) => Math.log10(args[0]),
   log2: (args) => Math.log2(args[0]),
   sqrt: (args) => Math.sqrt(args[0]),
   abs: (args) => Math.abs(args[0]),
   floor: (args) => Math.floor(args[0]),
   ceil: (args) => Math.ceil(args[0]),
   round: (args) => Math.round(args[0]),
   sign: (args) => Math.sign(args[0]),
   min: (args) => Math.min(...args),
   max: (args) => Math.max(...args),
}

/** Domain-error guards for functions whose domain is narrower than "any finite number", checked
 *  before the call rather than relying on the post-call finite guard alone. */
function violatesDomain(name: string, args: number[]): boolean {
   const firstArgument = args[0]
   switch (name) {
      case 'sqrt':
         return firstArgument < 0
      case 'ln':
      case 'log':
      case 'log2':
         return firstArgument <= 0
      case 'asin':
      case 'acos':
         return firstArgument < -1 || firstArgument > 1
      default:
         return false
   }
}

/** Evaluate a compiled expression at `x`. Returns null on any domain error or non-finite result
 *  (the renderer's "gap" signal), never throws. */
export function evaluate(compiled: CompiledExpression, x: number): number | null {
   return evaluateNode(compiled.ast, x)
}

function evaluateNode(node: ExpressionNode, x: number): number | null {
   switch (node.kind) {
      case 'number':
         return Number.isFinite(node.value) ? node.value : null

      case 'variable':
         return Number.isFinite(x) ? x : null

      case 'constant':
         return node.name === 'pi' ? Math.PI : Math.E

      case 'unary': {
         const operand = evaluateNode(node.operand, x)
         if (operand === null) return null
         const result = node.operator === '-' ? -operand : operand
         return Number.isFinite(result) ? result : null
      }

      case 'binary': {
         const left = evaluateNode(node.left, x)
         if (left === null) return null
         const right = evaluateNode(node.right, x)
         if (right === null) return null

         let result: number
         switch (node.operator) {
            case '+':
               result = left + right
               break
            case '-':
               result = left - right
               break
            case '*':
               result = left * right
               break
            case '/':
               if (right === 0) return null // division by zero -> a gap, not Infinity/NaN
               result = left / right
               break
            case '^':
               result = Math.pow(left, right)
               break
         }
         return Number.isFinite(result) ? result : null
      }

      case 'call': {
         const args: number[] = []
         for (const argumentNode of node.args) {
            const argumentValue = evaluateNode(argumentNode, x)
            if (argumentValue === null) return null
            args.push(argumentValue)
         }
         if (violatesDomain(node.name, args)) return null
         const functionImplementation = FUNCTION_TABLE[node.name]
         if (!functionImplementation) return null // unreachable given parser validation; defensive
         const result = functionImplementation(args)
         return Number.isFinite(result) ? result : null
      }

      default: {
         // Exhaustiveness guard: every ExpressionNode kind is handled above.
         const exhaustiveCheck: never = node
         return exhaustiveCheck
      }
   }
}

// #########################
// # CONVENIENCE WRAPPER   #
// #########################

/** One-shot compile + evaluate. Prefer {@link compileExpression} + {@link evaluate} when sampling
 *  the same source at many `x` values so it parses once. Returns null on a compile or domain error. */
export function evaluateExpression(source: string, x: number): number | null {
   const compiled = compileExpression(source)
   if (compiled === null) return null
   return evaluate(compiled, x)
}
