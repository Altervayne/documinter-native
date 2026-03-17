import type { ButtonHTMLAttributes } from 'react'
import { clsx } from '../lib/clsx'

type Variant = 'default' | 'primary' | 'ghost' | 'danger'
type Size    = 'sm' | 'md' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'default', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg border font-sans cursor-pointer whitespace-nowrap transition-colors',
        size === 'md'   && 'gap-1.5 px-3 py-1.5 text-sm font-medium',
        size === 'sm'   && 'gap-1.5 px-2.5 py-1 text-xs font-medium',
        size === 'icon' && 'p-1.5',
        variant === 'default' && 'bg-el border-border text-text hover:bg-white/5',
        variant === 'primary' && 'bg-accent border-accent text-[#100800] font-semibold hover:brightness-110',
        variant === 'ghost'   && 'bg-transparent border-transparent text-muted hover:text-text hover:bg-white/6',
        variant === 'danger'  && 'bg-transparent border-transparent text-red hover:bg-red/10 hover:border-red/20',
        className,
      )}
    >
      {children}
    </button>
  )
}
