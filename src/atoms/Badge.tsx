interface BadgeProps { label: string; dim?: boolean }

export function Badge({ label, dim }: BadgeProps) {
   return (
      <span className={`font-mono text-xs font-semibold text-accent bg-accent/15 px-2 py-0.5 rounded shrink-0 transition-opacity ${dim ? 'opacity-40' : ''}`}>
         {label}
      </span>
   )
}
