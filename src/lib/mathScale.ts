/*
 * The math block's discrete display-size steps. `mathScale` is a font-size multiplier on the rendered
 * MathML (editor, read view, export). Kept in its own side-effect-free module so the pure Markdown
 * serializer can share the steps + validation without pulling in lib/constants.ts (lucide-react) or
 * lib/math.ts (eager Temml load).
 */

/** Allowed discrete font-size multipliers for a math block, ascending. `1` is normal size. */
export const MATH_SCALE_STEPS = [0.75, 1, 1.25, 1.5, 2] as const

/** Default multiplier; an absent mathScale means this. */
export const DEFAULT_MATH_SCALE = 1

type MathScaleStep = (typeof MATH_SCALE_STEPS)[number]

export function isValidMathScale(scale: number): boolean {
   return (MATH_SCALE_STEPS as readonly number[]).includes(scale)
}

/** Parse a `scale=` token into a valid step, or undefined (missing, non-finite, non-positive, or not
 *  a step). Never throws, so junk on a fence string is ignored. */
export function parseMathScaleToken(raw: string | undefined): number | undefined {
   if (raw === undefined) return undefined
   const value = Number(raw)
   if (!Number.isFinite(value) || value <= 0) return undefined
   return isValidMathScale(value) ? value : undefined
}

/** Step one notch up (+1) or down (-1) through the steps, clamped at the ends. An unknown current
 *  value starts from the default. */
export function stepMathScale(current: number, direction: 1 | -1): number {
   const currentIndex = MATH_SCALE_STEPS.indexOf(current as MathScaleStep)
   const baseIndex    = currentIndex === -1
      ? MATH_SCALE_STEPS.indexOf(DEFAULT_MATH_SCALE as MathScaleStep)
      : currentIndex
   const nextIndex = Math.min(MATH_SCALE_STEPS.length - 1, Math.max(0, baseIndex + direction))
   return MATH_SCALE_STEPS[nextIndex]
}
