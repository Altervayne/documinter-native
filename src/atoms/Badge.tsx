interface BadgeProps { label: string }

export function Badge({ label }: BadgeProps) {
   return (
      <span className="font-mono text-xs font-semibold text-accent bg-accent/15 px-2 py-0.5 rounded shrink-0">
         {label}
      </span>
   )
}
