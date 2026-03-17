/** Minimal className joiner — no dependency needed. */
export function clsx(...args: (string | boolean | null | undefined)[]): string {
  return args.filter(Boolean).join(' ')
}
