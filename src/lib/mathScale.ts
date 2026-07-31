/**
 * mathScale.ts, the math block's discrete display-size steps.
 *
 * A math block's `mathScale` is a font-size multiplier applied to the rendered MathML in the
 * editor preview, the read-only view, and the HTML export. The editor stepper walks these
 * discrete steps; the Mintdown serializer round-trips the value on the fence info string.
 *
 * Kept in its own tiny, side-effect-free module so the pure Markdown/Mintdown serializers can
 * share the step list + validation WITHOUT importing the UI-flavoured lib/constants.ts (which
 * pulls in lucide-react) or lib/math.ts (which eagerly kicks off the Temml asset load on import).
 */

/** Allowed discrete font-size multipliers for a math block, ascending. `1` is normal size. */
export const MATH_SCALE_STEPS = [0.75, 1, 1.25, 1.5, 2] as const

/** The default multiplier (normal size). An absent `mathScale` means this. */
export const DEFAULT_MATH_SCALE = 1

type MathScaleStep = (typeof MATH_SCALE_STEPS)[number]

/** True when `scale` is exactly one of the allowed discrete steps. */
export function isValidMathScale(scale: number): boolean {
   return (MATH_SCALE_STEPS as readonly number[]).includes(scale)
}

/**
 * Parse a `scale=<number>` token value into a valid step, or undefined. Returns undefined for a
 * missing token, a non-finite / non-positive number, or a value that is not one of the allowed
 * steps. Never throws, so junk on a fence info string is silently ignored (bare `math` default).
 */
export function parseMathScaleToken(raw: string | undefined): number | undefined {
   if (raw === undefined) return undefined
   const value = Number(raw)
   if (!Number.isFinite(value) || value <= 0) return undefined
   return isValidMathScale(value) ? value : undefined
}

/**
 * Step the scale one notch up (`direction` = 1) or down (`direction` = -1) through the discrete
 * steps, clamped at the ends. An unknown current value is treated as the default before stepping.
 */
export function stepMathScale(current: number, direction: 1 | -1): number {
   const currentIndex = MATH_SCALE_STEPS.indexOf(current as MathScaleStep)
   const baseIndex    = currentIndex === -1
      ? MATH_SCALE_STEPS.indexOf(DEFAULT_MATH_SCALE as MathScaleStep)
      : currentIndex
   const nextIndex = Math.min(MATH_SCALE_STEPS.length - 1, Math.max(0, baseIndex + direction))
   return MATH_SCALE_STEPS[nextIndex]
}
