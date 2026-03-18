import type { InputHTMLAttributes } from 'react'

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
   flex?: number
}

export function TextInput({ flex, style, ...props }: TextInputProps) {
   return (
      <input
         {...props}
         style={{ flex, ...style }}
         className={[
            'bg-el border border-border rounded',
            'text-text font-sans text-[0.78rem]',
            'px-2.5 py-1.5 min-w-0 outline-none',
            'placeholder:text-muted',
            'focus:border-accent focus:ring-2 focus:ring-accent/15 transition-colors',
            props.className ?? '',
         ].join(' ')}
      />
   )
}
